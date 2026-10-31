import { randomUUID } from 'node:crypto';

import {
  createAnchorRequestSchema,
  createAnchorResultSchema,
  createMatterRequestSchema,
  createMatterResultSchema,
  offlineProbeRequestSchema,
  offlineProbeResultSchema,
  IPC_CHANNELS,
  IPC_PROTOCOL_VERSION,
  type ApplicationError,
  type CommandFailure,
} from '@caselite/contracts';
import type { SpikeApplication, createOfflineProbeApplication } from '@caselite/application';

type IpcEventLike = {
  sender?: unknown;
  senderFrame: {
    url: string;
  } | null;
};

type TrustedWindowLike = {
  isDestroyed(): boolean;
  webContents: {
    mainFrame: unknown;
  };
};

// A file URL may be normalized differently when the app moves to a path with
// Unicode or spaces. Trust only the live app window's main frame by identity.
export function isTrustedDesktopSender(
  event: IpcEventLike,
  windows: readonly TrustedWindowLike[],
): boolean {
  return (
    event.senderFrame !== null &&
    windows.some(
      (window) =>
        !window.isDestroyed() &&
        event.sender === window.webContents &&
        event.senderFrame === window.webContents.mainFrame,
    )
  );
}

type IpcMainLike = {
  handle(channel: string, listener: (event: IpcEventLike, payload: unknown) => unknown): void;
};

type RuntimeSchema = {
  safeParse(input: unknown):
    | { success: true; data: unknown }
    | {
        success: false;
        error: {
          issues: Array<{
            path: Array<string | number | symbol>;
            message: string;
          }>;
        };
      };
};

export type RegisterApplicationIpcDependencies = {
  application: SpikeApplication;
  offlineProbe?: ReturnType<typeof createOfflineProbeApplication>;
  ipcMain: IpcMainLike;
  isTrustedSender(event: IpcEventLike): boolean;
};

function error(
  correlationId: string,
  code: ApplicationError['code'],
  message: string,
  recoveryAction: ApplicationError['recovery_action'],
  fieldErrors?: ApplicationError['field_errors'],
): CommandFailure {
  return {
    ok: false,
    error: {
      code,
      message,
      field_errors: fieldErrors,
      retryable: false,
      recovery_action: recoveryAction,
      correlation_id: correlationId,
    },
  };
}

function hasUnsupportedProtocol(payload: unknown): boolean {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    'protocol_version' in payload &&
    (payload as { protocol_version?: unknown }).protocol_version !== IPC_PROTOCOL_VERSION
  );
}

function parseCommand(
  schema: RuntimeSchema,
  payload: unknown,
  correlationId: string,
): unknown | CommandFailure {
  if (hasUnsupportedProtocol(payload)) {
    return error(
      correlationId,
      'PROTOCOL_UNSUPPORTED',
      '此客户端协议版本不受支持。',
      'upgrade_client',
    );
  }

  const parsed = schema.safeParse(payload);
  if (parsed.success) return parsed.data;

  return error(
    correlationId,
    'INVALID_REQUEST',
    '请求格式无效。',
    'correct_input',
    parsed.error.issues.map((issue) => ({
      path: issue.path.map(String).join('.') || 'request',
      message: issue.message,
    })),
  );
}

function isFailure(value: unknown): value is CommandFailure {
  return typeof value === 'object' && value !== null && 'ok' in value && value.ok === false;
}

export function registerApplicationIpc({
  application,
  offlineProbe,
  ipcMain,
  isTrustedSender,
}: RegisterApplicationIpcDependencies): void {
  ipcMain.handle(IPC_CHANNELS.createMatter, async (event, payload) => {
    const correlationId = randomUUID();
    if (!isTrustedSender(event)) {
      return error(correlationId, 'FORBIDDEN', '此页面无权调用桌面业务接口。', 'request_access');
    }

    const request = parseCommand(createMatterRequestSchema, payload, correlationId);
    if (isFailure(request)) return request;

    return createMatterResultSchema.parse(
      await application.createMatter(createMatterRequestSchema.parse(request)),
    );
  });

  ipcMain.handle(IPC_CHANNELS.createAnchor, async (event, payload) => {
    const correlationId = randomUUID();
    if (!isTrustedSender(event)) {
      return error(correlationId, 'FORBIDDEN', '此页面无权调用桌面业务接口。', 'request_access');
    }

    const request = parseCommand(createAnchorRequestSchema, payload, correlationId);
    if (isFailure(request)) return request;

    return createAnchorResultSchema.parse(
      await application.createAnchor(createAnchorRequestSchema.parse(request)),
    );
  });

  // This channel exists only while the fixed DEV-1566 packaged probe runs.
  if (offlineProbe) {
    ipcMain.handle(IPC_CHANNELS.offlineProbe, (event, payload) => {
      const correlationId = randomUUID();
      if (!isTrustedSender(event)) {
        return error(correlationId, 'FORBIDDEN', '此页面无权调用桌面测试接口。', 'request_access');
      }
      const request = parseCommand(offlineProbeRequestSchema, payload, correlationId);
      if (isFailure(request)) return request;
      return offlineProbeResultSchema.parse(
        offlineProbe.run(offlineProbeRequestSchema.parse(request)),
      );
    });
  }
}
