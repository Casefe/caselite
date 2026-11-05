import {
  TASK_CHANNEL,
  taskResponseSchema,
  type TaskRequest,
  type TaskResponse,
} from '@caselite/contracts';
import {
  createAnchorResultSchema,
  createMatterResultSchema,
  offlineProbeResultSchema,
  IPC_CHANNELS,
  type CommandFailure,
  type CreateAnchorRequest,
  type CreateAnchorResult,
  type CreateMatterRequest,
  type CreateMatterResult,
  type OfflineProbeRequest,
  type OfflineProbeResult,
} from '@caselite/contracts';

export type IpcInvoke = (channel: string, payload: unknown) => Promise<unknown>;

export const IPC_COMMAND_TIMEOUT_MS = 15_000;

function internalFailure(): CommandFailure {
  return {
    ok: false,
    error: {
      code: 'INTERNAL',
      message: '操作暂时无法完成。',
      retryable: false,
      recovery_action: 'contact_support',
      correlation_id: crypto.randomUUID(),
    },
  };
}

function timeoutFailure(): CommandFailure {
  return {
    ok: false,
    error: {
      code: 'IPC_TIMEOUT',
      message: '等待桌面处理超时，操作结果尚不确定。请先确认状态，不要直接发起新请求。',
      retryable: false,
      recovery_action: 'check_status',
      correlation_id: crypto.randomUUID(),
    },
  };
}

async function invokeBusinessCommand(
  invoke: IpcInvoke,
  channel: string,
  request: CreateMatterRequest | CreateAnchorRequest | TaskRequest,
): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      invoke(channel, request),
      new Promise<CommandFailure>((resolve) => {
        timer = setTimeout(() => resolve(timeoutFailure()), IPC_COMMAND_TIMEOUT_MS);
      }),
    ]);
  } catch {
    return internalFailure();
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export type CaseLitePreloadApi = {
  task(request: TaskRequest): Promise<TaskResponse>;
  createAnchor(request: CreateAnchorRequest): Promise<CreateAnchorResult>;
  createMatter(request: CreateMatterRequest): Promise<CreateMatterResult>;
  offlineProbe(request: OfflineProbeRequest): Promise<OfflineProbeResult>;
};

export function createCaseLitePreloadApi(invoke: IpcInvoke): CaseLitePreloadApi {
  return {
    async task(request) {
      const result = taskResponseSchema.safeParse(
        await invokeBusinessCommand(invoke, TASK_CHANNEL, request),
      );
      return result.success
        ? result.data
        : {
            ok: false,
            code: 'RESULT_UNKNOWN',
            message: '无法确认操作结果，请保留输入并核对原提交。',
          };
    },
    async createAnchor(request) {
      const result = createAnchorResultSchema.safeParse(
        await invokeBusinessCommand(invoke, IPC_CHANNELS.createAnchor, request),
      );
      return result.success ? result.data : internalFailure();
    },
    async createMatter(request) {
      const result = createMatterResultSchema.safeParse(
        await invokeBusinessCommand(invoke, IPC_CHANNELS.createMatter, request),
      );
      return result.success ? result.data : internalFailure();
    },
    async offlineProbe(request) {
      return offlineProbeResultSchema.parse(await invoke(IPC_CHANNELS.offlineProbe, request));
    },
  };
}

export type { Task, TaskRequest, TaskResponse } from '@caselite/contracts';
