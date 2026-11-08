import {
  CONTACTS_CHANNEL,
  contactsResponseSchema,
  type ContactsRequest,
  type ContactsResponse,
} from '@caselite/contracts';
import {
  FINANCE_CHANNEL,
  financeResponseSchema,
  type FinanceRequest,
  type FinanceResponse,
} from '@caselite/contracts';
import {
  REMINDER_CHANNEL,
  reminderResponseSchema,
  type ReminderRequest,
  type ReminderResponse,
} from '@caselite/contracts';
import {
  MATERIAL_CHANNEL,
  MATERIAL_PICK_CHANNEL,
  MATERIAL_DROP_CHANNEL,
  materialResponseSchema,
  type MaterialScope,
  type MaterialRequest,
  type MaterialResponse,
} from '@caselite/contracts';
import {
  APPEARANCE_CHANNEL,
  appearanceResponseSchema,
  type AppearanceRequest,
  type AppearanceResponse,
  CATALOG_CHANNEL,
  catalogResponseSchema,
  type CatalogRequest,
  type CatalogResponse,
  AGENT_CHANNEL,
  agentResponseSchema,
  type AgentRequest,
  type AgentResponse,
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
  request:
    | CreateMatterRequest
    | CreateAnchorRequest
    | TaskRequest
    | AgentRequest
    | CatalogRequest
    | AppearanceRequest
    | MaterialRequest
    | ReminderRequest
    | FinanceRequest
    | ContactsRequest,
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
  reminder(request: ReminderRequest): Promise<ReminderResponse>;
  material(request: MaterialRequest): Promise<MaterialResponse>;
  pickPdf(scope: MaterialScope): Promise<MaterialResponse>;
  dropPdf(file: File, scope: MaterialScope): Promise<MaterialResponse>;
  appearance(request: AppearanceRequest): Promise<AppearanceResponse>;
  finance(request: FinanceRequest): Promise<FinanceResponse>;
  contacts(request: ContactsRequest): Promise<ContactsResponse>;
  catalog(request: CatalogRequest): Promise<CatalogResponse>;
  agent(request: AgentRequest): Promise<AgentResponse>;
  task(request: TaskRequest): Promise<TaskResponse>;
  createAnchor(request: CreateAnchorRequest): Promise<CreateAnchorResult>;
  createMatter(request: CreateMatterRequest): Promise<CreateMatterResult>;
  offlineProbe(request: OfflineProbeRequest): Promise<OfflineProbeResult>;
};

export function createCaseLitePreloadApi(
  invoke: IpcInvoke,
  droppedPath?: (file: File) => string,
): CaseLitePreloadApi {
  const materialResult = async (call: Promise<unknown>): Promise<MaterialResponse> => {
    try {
      const result = materialResponseSchema.safeParse(await call);
      if (result.success) return result.data;
    } catch {
      /* 保留原暂存身份，不能把未知回执当失败重建。 */
    }
    return {
      ok: false,
      code: 'RESULT_UNKNOWN',
      message: '无法确认材料操作结果，请保留当前文件并重新读取。',
    };
  };
  return {
    async reminder(request) {
      const result = reminderResponseSchema.safeParse(
        await invokeBusinessCommand(invoke, REMINDER_CHANNEL, request),
      );
      return result.success
        ? result.data
        : {
            ok: false,
            code: 'RESULT_UNKNOWN',
            message: '无法确认提醒结果，请保留原提交身份并核对。',
          };
    },
    // 本地准备可能包含 OCR，使用受控 Worker 的处理预算；15秒业务回执只用于短操作和付费Run。
    // cancel_prepare 可中止本地准备，准备本身永不调用外部模型。
    material: (request) =>
      materialResult(
        (request.operation === 'preview' && request.automatic) ||
          request.operation === 'save_original' ||
          request.operation === 'save_project_original'
          ? invoke(MATERIAL_CHANNEL, request)
          : invokeBusinessCommand(invoke, MATERIAL_CHANNEL, request),
      ),
    pickPdf: (scope) => materialResult(invoke(MATERIAL_PICK_CHANNEL, { scope })),
    async dropPdf(file, scope) {
      const path = droppedPath?.(file);
      if (!path)
        return { ok: false, code: 'INVALID_FILE', message: '请拖入本机磁盘上的 PDF 或 DOCX。' };
      return materialResult(invoke(MATERIAL_DROP_CHANNEL, { scope, path }));
    },
    async appearance(request) {
      const result = appearanceResponseSchema.safeParse(
        await invokeBusinessCommand(invoke, APPEARANCE_CHANNEL, request),
      );
      return result.success
        ? result.data
        : { ok: false, message: '无法确认本机主题设置，请重新读取后重试。' };
    },
    async contacts(request) {
      const result = contactsResponseSchema.safeParse(
        await invokeBusinessCommand(invoke, CONTACTS_CHANNEL, request),
      );
      return result.success
        ? result.data
        : { ok: false, code: 'RESULT_UNKNOWN', message: '无法确认联系人结果，请核对原提交。' };
    },
    async finance(request) {
      const result = financeResponseSchema.safeParse(
        await invokeBusinessCommand(invoke, FINANCE_CHANNEL, request),
      );
      return result.success
        ? result.data
        : {
            ok: false,
            code: 'RESULT_UNKNOWN',
            message: '无法确认财务结果，请保留原提交并核对。',
          };
    },
    async catalog(request) {
      const r = catalogResponseSchema.safeParse(
        await invokeBusinessCommand(invoke, CATALOG_CHANNEL, request),
      );
      return r.success
        ? r.data
        : { ok: false, code: 'RESULT_UNKNOWN', message: '无法确认本地结果，请保留原提交并核对。' };
    },
    async agent(request) {
      const result = agentResponseSchema.safeParse(
        await invokeBusinessCommand(invoke, AGENT_CHANNEL, request),
      );
      return result.success
        ? result.data
        : {
            ok: false,
            code: 'RESULT_UNKNOWN',
            message: '无法确认运行状态，请保留输入并刷新状态；不要重复发送。',
          };
    },
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

export type { Task, TaskRequest, TaskResponse, TaskListQuery } from '@caselite/contracts';
export type {
  AgentRun,
  AgentRequest,
  AgentResponse,
  AgentModel,
  AgentProvider,
  ReviewRange,
  ReviewSaved,
} from '@caselite/contracts';

export type { CatalogRequest, CatalogResponse, CatalogDocument, Matter } from '@caselite/contracts';
export type {
  ActivityEvent,
  ActivityScope,
  DiscussionScope,
  DiscussionEntry,
} from '@caselite/contracts';
export type { Theme, AppearanceRequest, AppearanceResponse } from '@caselite/contracts';

export type {
  Material,
  MaterialScope,
  MaterialResponse,
  MaterialRequest,
  MaterialPreview,
  TextPage,
} from '@caselite/contracts';

export type { Reminder, ReminderRequest, ReminderResponse } from '@caselite/contracts';

export type { FinanceRequest, FinanceResponse } from '@caselite/contracts';

export type { Contact, ContactsRequest } from '@caselite/contracts';
export type { DeliverySnapshot } from '@caselite/contracts';
export type { DeliveryExport, DeliveryExportFormat } from '@caselite/contracts';
