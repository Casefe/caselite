import { describe, expect, it, vi } from 'vitest';
import { createTaskApplication } from '@caselite/application';
import type { AgentResponse, TaskRequest, TaskResponse } from '@caselite/contracts';
import { createEditorRecoveryFixture, recoveryDigest } from './editor-recovery-fixture';

const taskId = '00000000-0000-4000-8000-000000000001';
const documentId = '00000000-0000-4000-8000-000000000002';
const bodyId = '00000000-0000-4000-8000-000000000003';
const requestId = '00000000-0000-4000-8000-000000000004';
const key = '00000000-0000-4000-8000-000000000005';
const runId = '00000000-0000-4000-8000-000000000006';
const target = { taskId, documentId, bodyId };
const save: Extract<TaskRequest, { operation: 'save' }> = {
  protocol_version: 1,
  operation: 'save',
  request_id: requestId,
  idempotency_key: key,
  task_id: taskId,
  document_id: documentId,
  body_id: bodyId,
  expected_revision: 2,
  editor_schema: 1,
  state: [1, 2, 3],
};
const status: TaskRequest = { protocol_version: 1, operation: 'status', idempotency_key: key };
const saved: TaskResponse = { ok: true, tasks: [], state: null, receipt: key };
const missing: TaskResponse = { ok: false, code: 'NOT_FOUND', message: 'missing' };
const agentOk = { ok: true } as AgentResponse;
const agentError = { ok: false, code: 'COPY_FAILED', message: 'copy failed' } as AgentResponse;
const copyRequest = { protocol_version: 1, operation: 'copy_output', scope: 'home', run_id: runId };
const startRequest = {
  protocol_version: 1,
  operation: 'start',
  scope: 'home',
  run_id: runId,
  prompt: 'synthetic',
  confirmed: true,
};
const readRequest = { protocol_version: 1, operation: 'read', scope: 'home' };

function events(fixture: ReturnType<typeof createEditorRecoveryFixture>, type: string) {
  return fixture.snapshot().events.filter((event) => event.type === type);
}

describe('isolated editor recovery fixture', () => {
  it('passes ordinary requests and this binding through without injecting a failure', async () => {
    const fixture = createEditorRecoveryFixture();
    const port = {
      count: 0,
      execute(request: TaskRequest): TaskResponse {
        this.count++;
        return request.operation === 'status' ? missing : saved;
      },
    };
    const app = fixture.wrapTaskApplication(createTaskApplication(fixture.wrapTaskPort(port)));
    expect(await app.execute(save)).toEqual(saved);
    expect(await app.execute(status)).toEqual(missing);
    expect(port.count).toBe(2);
    expect(events(fixture, 'save-port-delegate')).toHaveLength(1);
    expect(events(fixture, 'violation')).toHaveLength(0);
  });

  it('maps one pre-write exception through the real task application and retries original bytes', async () => {
    const fixture = createEditorRecoveryFixture();
    const calls: TaskRequest[] = [];
    const port = {
      execute(request: TaskRequest): TaskResponse {
        calls.push(request);
        return request.operation === 'status' ? missing : saved;
      },
    };
    const app = fixture.wrapTaskApplication(createTaskApplication(fixture.wrapTaskPort(port)));
    fixture.armSave(target, 'fail');
    expect(await app.execute(save)).toMatchObject({ ok: false, code: 'WRITE_FAILED' });
    expect(calls).toHaveLength(0);
    expect(await app.execute(status)).toEqual(missing);
    expect(await app.execute(save)).toEqual(saved);
    expect(calls).toEqual([status, save]);
    expect(events(fixture, 'save-port-failed')).toHaveLength(1);
    expect(events(fixture, 'save-port-delegate')).toHaveLength(1);
    const arrivals = events(fixture, 'save-arrival');
    expect(arrivals).toHaveLength(2);
    expect(arrivals[0]).toEqual(arrivals[1]);
    expect(arrivals[0]).toMatchObject({
      requestId,
      idempotencyKey: key,
      stateSha256: recoveryDigest(Uint8Array.from(save.state)),
    });
    expect(JSON.stringify(fixture.snapshot())).not.toContain('[1,2,3]');
  });

  it('disarms an unexpected save without failing or redirecting the other object', async () => {
    const fixture = createEditorRecoveryFixture();
    const execute = vi.fn(() => saved);
    const app = fixture.wrapTaskApplication(
      createTaskApplication(fixture.wrapTaskPort({ execute })),
    );
    fixture.armSave(target, 'fail');
    const other = { ...save, task_id: '00000000-0000-4000-8000-000000000009' };
    expect(await app.execute(other)).toEqual(saved);
    expect(await app.execute(save)).toEqual(saved);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(events(fixture, 'violation')).toMatchObject([{ reason: 'unexpected-save-port-target' }]);
  });

  it('holds only the committed response while status runs and releases the same response', async () => {
    const fixture = createEditorRecoveryFixture();
    const execute = vi.fn((request: TaskRequest): TaskResponse =>
      request.operation === 'status' ? saved : saved,
    );
    const app = fixture.wrapTaskApplication(
      createTaskApplication(fixture.wrapTaskPort({ execute })),
    );
    fixture.armSave(target, 'hold');
    const pending = Promise.resolve(app.execute(save));
    await Promise.resolve();
    expect(fixture.snapshot().held).toBe(1);
    expect(await app.execute(status)).toEqual(saved);
    expect(events(fixture, 'status-arrival')).toMatchObject([{ idempotencyKey: key }]);
    expect(events(fixture, 'task-result')).toMatchObject([
      { operation: 'save', receipt: key },
      { operation: 'status', idempotencyKey: key, receipt: key },
    ]);
    fixture.releaseHeld();
    expect(await pending).toBe(saved);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(events(fixture, 'released')).toMatchObject([{ kind: 'save', reason: 'manual' }]);
  });

  it('releases a held original response on abort or disposal without repeating the write', async () => {
    const fixture = createEditorRecoveryFixture();
    const execute = vi.fn(() => saved);
    const app = fixture.wrapTaskApplication(
      createTaskApplication(fixture.wrapTaskPort({ execute })),
    );
    const controller = new AbortController();
    fixture.armSave(target, 'hold');
    const pending = Promise.resolve(app.execute(save, controller.signal));
    await Promise.resolve();
    controller.abort();
    expect(await pending).toBe(saved);
    expect(events(fixture, 'released')).toMatchObject([{ reason: 'aborted' }]);
    fixture.armSave(target, 'hold');
    const second = Promise.resolve(app.execute(save));
    await Promise.resolve();
    fixture.dispose();
    expect(await second).toBe(saved);
    expect(fixture.snapshot()).toMatchObject({ disposed: true, held: 0 });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('injects only the matching owner, scope, run and output copy, then delegates the retry', async () => {
    const fixture = createEditorRecoveryFixture();
    const copied = vi.fn();
    const copyOutput = fixture.wrapCopyOutput(copied);
    const original = {
      async execute(input: unknown, owner: string): Promise<AgentResponse> {
        const request = input as typeof copyRequest;
        if (owner !== '1' || request.scope !== 'home' || request.run_id !== runId)
          return { ok: false, code: 'NOT_FOUND', message: 'not found' } as AgentResponse;
        try {
          await copyOutput('synthetic result');
          return agentOk;
        } catch {
          return agentError;
        }
      },
      release: vi.fn(),
    };
    const app = fixture.wrapAgentApplication(original);
    fixture.armCopy({
      owner: '1',
      scope: 'home',
      runId,
      outputSha256: recoveryDigest('synthetic result'),
    });
    expect(await app.execute(copyRequest, '1')).toEqual(agentError);
    expect(copied).not.toHaveBeenCalled();
    expect(await app.execute(copyRequest, '1')).toBe(agentOk);
    expect(copied).toHaveBeenCalledExactlyOnceWith('synthetic result');
    expect(events(fixture, 'copy-arrival')).toHaveLength(2);
    expect(events(fixture, 'copy-failed')).toHaveLength(1);
    expect(events(fixture, 'copy-output-delegate')).toHaveLength(1);
  });

  it('disarms on concurrent or wrong-target copy while forwarding original calls', async () => {
    const fixture = createEditorRecoveryFixture();
    const copied = vi.fn();
    const copyOutput = fixture.wrapCopyOutput(copied);
    const app = fixture.wrapAgentApplication({
      async execute(): Promise<AgentResponse> {
        await Promise.resolve();
        await copyOutput('synthetic result');
        return agentOk;
      },
      release() {},
    });
    fixture.armCopy({
      owner: '1',
      scope: 'home',
      runId,
      outputSha256: recoveryDigest('synthetic result'),
    });
    const first = app.execute(copyRequest, '1');
    const second = app.execute(copyRequest, '1');
    expect(await Promise.all([first, second])).toEqual([agentOk, agentOk]);
    expect(copied).toHaveBeenCalledTimes(2);
    expect(events(fixture, 'violation')).toMatchObject([{ reason: 'concurrent-copy' }]);
    expect(events(fixture, 'copy-failed')).toHaveLength(0);
  });

  it('delegates a concurrent copy immediately rather than queueing it past release', async () => {
    const fixture = createEditorRecoveryFixture();
    let finish!: () => void;
    const pendingPort = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const execute = vi.fn(async () => {
      await pendingPort;
      return agentOk;
    });
    const release = vi.fn();
    const app = fixture.wrapAgentApplication({ execute, release });
    fixture.armCopy({
      owner: '1',
      scope: 'home',
      runId,
      outputSha256: recoveryDigest('synthetic result'),
    });
    const first = app.execute(copyRequest, '1');
    const second = app.execute(copyRequest, '1');
    expect(execute).toHaveBeenCalledTimes(2);
    app.release('1');
    expect(release).toHaveBeenCalledExactlyOnceWith('1');
    finish();
    expect(await Promise.all([first, second])).toEqual([agentOk, agentOk]);
    expect(events(fixture, 'violation')).toMatchObject([{ reason: 'concurrent-copy' }]);
  });

  it('keeps read and owner release live while an original start acknowledgement is held', async () => {
    const fixture = createEditorRecoveryFixture();
    const release = vi.fn();
    const execute = vi.fn(async () => agentOk);
    const app = fixture.wrapAgentApplication({ execute, release });
    fixture.armAgent({ owner: '1', scope: 'home' });
    const pending = app.execute(startRequest, '1');
    await Promise.resolve();
    expect(fixture.snapshot().held).toBe(1);
    expect(await app.execute(readRequest, '1')).toBe(agentOk);
    app.release('1');
    expect(release).toHaveBeenCalledExactlyOnceWith('1');
    expect(await pending).toBe(agentOk);
    expect(events(fixture, 'agent-start-arrival')).toMatchObject([
      {
        owner: '1',
        scope: 'home',
        runId,
        requestSha256: recoveryDigest(JSON.stringify(startRequest)),
      },
    ]);
    expect(events(fixture, 'released')).toMatchObject([
      { kind: 'agent', reason: 'owner-released' },
    ]);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it.each(['owner', 'all', 'empty'] as const)(
    'does not create a new hold after %s release during the original start',
    async (scope) => {
      const fixture = createEditorRecoveryFixture();
      let complete!: (result: AgentResponse) => void;
      const original = new Promise<AgentResponse>((resolve) => {
        complete = resolve;
      });
      const execute = vi.fn(() => original);
      const release = vi.fn();
      const app = fixture.wrapAgentApplication({ execute, release });
      fixture.armAgent({ owner: '1', scope: 'home' });
      const pending = app.execute(startRequest, '1');
      const releasedOwner = scope === 'owner' ? '1' : scope === 'empty' ? '' : undefined;
      app.release(releasedOwner);
      complete(agentOk);
      await Promise.resolve();
      try {
        expect(fixture.snapshot().held).toBe(0);
        expect(await pending).toBe(agentOk);
        expect(execute).toHaveBeenCalledExactlyOnceWith(startRequest, '1');
        expect(release).toHaveBeenCalledExactlyOnceWith(releasedOwner);
        expect(events(fixture, 'hold-skipped')).toMatchObject([
          { kind: 'agent', reason: 'owner-released', owner: '1' },
        ]);
      } finally {
        fixture.dispose();
        await pending;
      }
    },
  );

  it('does not revoke another owner pending acknowledgement or block read/cancel', async () => {
    const fixture = createEditorRecoveryFixture();
    let complete!: (result: AgentResponse) => void;
    const original = new Promise<AgentResponse>((resolve) => {
      complete = resolve;
    });
    const execute = vi.fn((input: unknown) =>
      (input as { operation: string }).operation === 'start' ? original : Promise.resolve(agentOk),
    );
    const release = vi.fn();
    const app = fixture.wrapAgentApplication({ execute, release });
    fixture.armAgent({ owner: '1', scope: 'home' });
    const pending = app.execute(startRequest, '1');
    app.release('2');
    expect(await app.execute(readRequest, '1')).toBe(agentOk);
    expect(
      await app.execute(
        { protocol_version: 1, operation: 'cancel', scope: 'home', run_id: runId },
        '1',
      ),
    ).toBe(agentOk);
    complete(agentOk);
    await Promise.resolve();
    expect(fixture.snapshot().held).toBe(1);
    app.release('1');
    expect(await pending).toBe(agentOk);
    expect(release.mock.calls).toEqual([['2'], ['1']]);
    expect(events(fixture, 'hold-skipped')).toHaveLength(0);
    expect(execute).toHaveBeenCalledTimes(3);
  });
});
