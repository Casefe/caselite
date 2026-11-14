import { createHash } from 'node:crypto';
import {
  agentRequestSchema,
  taskRequestSchema,
  type AgentResponse,
  type TaskRequest,
  type TaskResponse,
} from '@caselite/contracts';

export type RecoverySaveTarget = { taskId: string; documentId: string; bodyId: string };
export type RecoveryCopyTarget = {
  owner: string;
  scope: string;
  runId: string;
  outputSha256: string;
};
export type RecoveryAgentTarget = { owner: string; scope: string };

type TaskPort = { execute(request: TaskRequest): TaskResponse };
type TaskApplication = {
  execute(input: unknown, signal?: AbortSignal): TaskResponse | Promise<TaskResponse>;
};
type AgentApplication = {
  execute(input: unknown, owner: string): Promise<AgentResponse>;
  release(owner?: string): void;
};
type Save = Extract<TaskRequest, { operation: 'save' }>;
type Held = { owner?: string; release(reason: string): void };

export function recoveryDigest(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function saveIdentity(request: Save) {
  return {
    protocolVersion: request.protocol_version,
    requestId: request.request_id,
    idempotencyKey: request.idempotency_key,
    taskId: request.task_id,
    documentId: request.document_id,
    bodyId: request.body_id,
    expectedRevision: request.expected_revision,
    editorSchema: request.editor_schema,
    stateSha256: recoveryDigest(Uint8Array.from(request.state)),
    requestSha256: recoveryDigest(JSON.stringify(request)),
  };
}

function matchesSave(request: Save, target: RecoverySaveTarget) {
  return (
    request.task_id === target.taskId &&
    request.document_id === target.documentId &&
    request.body_id === target.bodyId
  );
}

function taskResult(result: TaskResponse) {
  return result.ok
    ? {
        ok: true,
        receipt: result.receipt,
        tasks: result.tasks.map((task) => ({
          taskId: task.id,
          documentId: task.document_id,
          bodyId: task.body_id,
          revision: task.body_revision,
          editorSchema: task.editor_schema,
        })),
      }
    : { ok: false, code: result.code };
}

// 仅由经过临时目录校验的 demo 创建；闭包只记录合成请求的身份和摘要。
export function createEditorRecoveryFixture() {
  let saveArm: { target: RecoverySaveTarget; mode: 'fail' | 'hold' } | undefined;
  let copyArm: RecoveryCopyTarget | undefined;
  let agentArm: RecoveryAgentTarget | undefined;
  let copyContext: Omit<RecoveryCopyTarget, 'outputSha256'> | undefined;
  let copyBusy = false;
  let disposed = false;
  let releaseEpoch = 0;
  const ownerReleaseEpochs = new Map<string, number>();
  const held = new Set<Held>();
  const events: Array<Record<string, unknown>> = [];
  const record = (type: string, detail: Record<string, unknown> = {}) => {
    events.push({ type, ...detail });
  };
  const violation = (reason: string) => record('violation', { reason });
  const ensureActive = () => {
    if (disposed) throw new Error('Recovery fixture is disposed');
  };
  const hold = <T>(result: T, kind: string, signal?: AbortSignal, owner?: string): Promise<T> => {
    if (held.size || signal?.aborted || disposed) {
      if (held.size) violation('concurrent-held-response');
      record('hold-skipped', { kind, aborted: Boolean(signal?.aborted), owner });
      return Promise.resolve(result);
    }
    return new Promise((resolve) => {
      let settled = false;
      const onAbort = () => entry.release('aborted');
      const entry: Held = {
        owner,
        release(reason) {
          if (settled) return;
          settled = true;
          signal?.removeEventListener('abort', onAbort);
          held.delete(entry);
          record('released', { kind, reason, owner });
          resolve(result);
        },
      };
      held.add(entry);
      signal?.addEventListener('abort', onAbort, { once: true });
      record('held', { kind, owner });
      if (signal?.aborted) entry.release('aborted');
    });
  };
  const releaseHeld = () => {
    for (const entry of [...held]) entry.release('manual');
  };

  return {
    armSave(target: RecoverySaveTarget, mode: 'fail' | 'hold') {
      ensureActive();
      if (saveArm || held.size) throw new Error('Recovery save already armed or held');
      saveArm = { target: { ...target }, mode };
      record('save-armed', { mode, ...target });
    },
    wrapTaskPort(port: TaskPort): TaskPort {
      return {
        execute(request) {
          if (request.operation === 'save') {
            const identity = saveIdentity(request);
            record('save-port-arrival', identity);
            if (saveArm?.mode === 'fail') {
              if (matchesSave(request, saveArm.target)) {
                saveArm = undefined;
                record('save-port-failed', identity);
                throw new Error('Synthetic save port failure');
              }
              saveArm = undefined;
              violation('unexpected-save-port-target');
            }
            record('save-port-delegate', identity);
          }
          return port.execute(request);
        },
      };
    },
    wrapTaskApplication(application: TaskApplication): TaskApplication {
      return {
        async execute(input, signal) {
          const parsed = taskRequestSchema.safeParse(input);
          const request = parsed.success ? parsed.data : undefined;
          let shouldHold = false;
          if (request?.operation === 'save') {
            record('save-arrival', saveIdentity(request));
            if (saveArm?.mode === 'hold') {
              shouldHold = matchesSave(request, saveArm.target);
              saveArm = undefined;
              if (!shouldHold) violation('unexpected-save-ack-target');
            }
          } else if (request?.operation === 'status') {
            record('status-arrival', { idempotencyKey: request.idempotency_key });
          }
          const result = await application.execute(input, signal);
          if (request?.operation === 'save' || request?.operation === 'status')
            record('task-result', {
              operation: request.operation,
              ...(request.operation === 'status'
                ? { idempotencyKey: request.idempotency_key }
                : {}),
              ...taskResult(result),
            });
          return shouldHold && result.ok ? hold(result, 'save', signal) : result;
        },
      };
    },
    armCopy(target: RecoveryCopyTarget) {
      ensureActive();
      if (copyArm || copyBusy) throw new Error('Recovery copy already armed or active');
      copyArm = { ...target };
      record('copy-armed', { owner: target.owner, scope: target.scope, runId: target.runId });
    },
    wrapCopyOutput(copy: (text: string) => void | Promise<void>) {
      return (text: string) => {
        if (copyArm) {
          const match =
            copyContext?.owner === copyArm.owner &&
            copyContext.scope === copyArm.scope &&
            copyContext.runId === copyArm.runId &&
            recoveryDigest(text) === copyArm.outputSha256;
          if (match) {
            const target = copyArm;
            copyArm = undefined;
            record('copy-failed', {
              owner: target.owner,
              scope: target.scope,
              runId: target.runId,
            });
            throw new Error('Synthetic copy failure');
          }
          copyArm = undefined;
          violation('unexpected-copy-output');
        }
        record('copy-output-delegate', { outputSha256: recoveryDigest(text) });
        return copy(text);
      };
    },
    armAgent(target: RecoveryAgentTarget) {
      ensureActive();
      if (agentArm || held.size) throw new Error('Recovery agent already armed or held');
      agentArm = { ...target };
      record('agent-armed', target);
    },
    wrapAgentApplication(application: AgentApplication): AgentApplication {
      return {
        async execute(input, owner) {
          const parsed = agentRequestSchema.safeParse(input);
          const request = parsed.success ? parsed.data : undefined;
          if (request?.operation === 'copy_output')
            record('copy-arrival', { owner, scope: request.scope, runId: request.run_id });
          if (request?.operation === 'copy_output' && (copyArm || copyBusy)) {
            if (copyBusy) {
              copyArm = undefined;
              violation('concurrent-copy');
              return application.execute(input, owner);
            }
            if (
              copyArm &&
              (owner !== copyArm.owner ||
                request.scope !== copyArm.scope ||
                request.run_id !== copyArm.runId)
            ) {
              copyArm = undefined;
              violation('unexpected-copy-target');
            }
            copyBusy = true;
            copyContext = { owner, scope: request.scope, runId: request.run_id };
            try {
              return await application.execute(input, owner);
            } finally {
              copyContext = undefined;
              copyBusy = false;
            }
          }
          let shouldHold = false;
          const originalReleaseEpoch = releaseEpoch;
          const originalOwnerEpoch = ownerReleaseEpochs.get(owner) ?? 0;
          if (request?.operation === 'start') {
            record('agent-start-arrival', {
              owner,
              scope: request.scope,
              runId: request.run_id,
              requestSha256: recoveryDigest(JSON.stringify(request)),
            });
            if (agentArm) {
              shouldHold = owner === agentArm.owner && request.scope === agentArm.scope;
              agentArm = undefined;
              if (!shouldHold) violation('unexpected-agent-start-target');
            }
          }
          const result = await application.execute(input, owner);
          // 原 start 在途时也可能撤权；不能在 await 后重新挂起已失效 owner 的回执。
          if (
            shouldHold &&
            result.ok &&
            (originalReleaseEpoch !== releaseEpoch ||
              originalOwnerEpoch !== (ownerReleaseEpochs.get(owner) ?? 0))
          ) {
            record('hold-skipped', { kind: 'agent', reason: 'owner-released', owner });
            return result;
          }
          return shouldHold && result.ok ? hold(result, 'agent', undefined, owner) : result;
        },
        release(owner) {
          if (!owner) releaseEpoch++;
          else ownerReleaseEpochs.set(owner, (ownerReleaseEpochs.get(owner) ?? 0) + 1);
          try {
            application.release(owner);
          } finally {
            if (!owner || copyArm?.owner === owner) copyArm = undefined;
            if (!owner || agentArm?.owner === owner) agentArm = undefined;
            for (const entry of [...held])
              if (!owner || entry.owner === owner) entry.release('owner-released');
            record('agent-owner-released', { owner });
          }
        },
      };
    },
    noteStreamStart() {
      record('synthetic-stream-start');
    },
    releaseHeld,
    dispose() {
      if (disposed) return;
      disposed = true;
      saveArm = undefined;
      copyArm = undefined;
      agentArm = undefined;
      copyContext = undefined;
      for (const entry of [...held]) entry.release('disposed');
      record('disposed');
    },
    snapshot() {
      return { disposed, held: held.size, events: events.map((event) => ({ ...event })) };
    },
  };
}
