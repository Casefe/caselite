import {
  createAnchorResponseSchema,
  createMatterResponseSchema,
  type ApplicationError,
  type CommandFailure,
  type CreateAnchorRequest,
  type CreateAnchorResult,
  type CreateMatterRequest,
  type CreateMatterResult,
} from '@caselite/contracts';

export type Operation = 'create-anchor' | 'create-matter';

export type AuthorizationPort = {
  canAct(input: { actorId: string; workspaceId: string; operation: Operation }): Promise<boolean>;
};

export type SpikeApplicationDependencies = {
  authorization: AuthorizationPort;
  createId(): string;
  now(): string;
};

export type SpikeApplication = {
  createMatter(request: CreateMatterRequest): Promise<CreateMatterResult>;
  createAnchor(request: CreateAnchorRequest): Promise<CreateAnchorResult>;
};

const notPersistedWarning =
  'DEV-1578 IPC Spike only: this result is held in memory and has not been saved to SQLite.';

function failure(
  requestId: string,
  code: ApplicationError['code'],
  message: string,
  recoveryAction: ApplicationError['recovery_action'],
): CommandFailure {
  return {
    ok: false,
    error: {
      code,
      message,
      retryable: false,
      recovery_action: recoveryAction,
      correlation_id: requestId,
    },
  };
}

export function createSpikeApplication(
  dependencies: SpikeApplicationDependencies,
): SpikeApplication {
  const results = new Map<
    string,
    { operation: Operation; fingerprint: string; result: CreateMatterResult | CreateAnchorResult }
  >();

  function fingerprint(request: CreateMatterRequest | CreateAnchorRequest): string {
    // A retry may have a new request ID. Its actor, scope and business data
    // must still match the original command associated with this key.
    return JSON.stringify(
      Object.entries(request)
        .filter(([key]) => key !== 'request_id' && key !== 'idempotency_key')
        .sort(([first], [second]) => first.localeCompare(second)),
    );
  }

  function replay(
    request: CreateMatterRequest | CreateAnchorRequest,
    operation: Operation,
  ): CreateMatterResult | CreateAnchorResult | undefined {
    const previous = results.get(request.idempotency_key);
    if (!previous) return undefined;
    if (previous.operation !== operation || previous.fingerprint !== fingerprint(request)) {
      return failure(
        request.request_id,
        'CONFLICT',
        '此重复请求编号已用于其他内容。',
        'refresh_and_retry',
      );
    }
    return previous.result;
  }

  async function authorized(
    request: CreateMatterRequest | CreateAnchorRequest,
    operation: Operation,
  ): Promise<CommandFailure | undefined> {
    const allowed = await dependencies.authorization.canAct({
      actorId: request.actor_id,
      workspaceId: request.workspace_id,
      operation,
    });

    return allowed
      ? undefined
      : failure(
          request.request_id,
          'FORBIDDEN',
          '当前身份无权在该工作区执行此操作。',
          'request_access',
        );
  }

  return {
    async createMatter(request) {
      const rejected = await authorized(request, 'create-matter');
      if (rejected) return rejected;

      if (request.expected_version !== 0) {
        return failure(
          request.request_id,
          'CONFLICT',
          '创建事项时 expected_version 必须为 0。',
          'refresh_and_retry',
        );
      }

      const existing = replay(request, 'create-matter');
      if (existing) return existing as CreateMatterResult;

      const entityId = dependencies.createId();
      const eventId = dependencies.createId();
      const result = createMatterResponseSchema.parse({
        entity_kind: 'matter',
        entity_id: entityId,
        new_version: 1,
        domain_events: [
          {
            event_id: eventId,
            event_type: 'matter.created',
            schema_version: 1,
            aggregate_type: 'matter',
            aggregate_id: entityId,
            workspace_id: request.workspace_id,
            occurred_at: dependencies.now(),
            payload: { matter_id: entityId },
          },
        ],
        local_save_status: 'not-persisted',
        warnings: [notPersistedWarning],
      });
      const success: CreateMatterResult = { ok: true, value: result };
      results.set(request.idempotency_key, {
        operation: 'create-matter',
        fingerprint: fingerprint(request),
        result: success,
      });
      return success;
    },

    async createAnchor(request) {
      const rejected = await authorized(request, 'create-anchor');
      if (rejected) return rejected;

      if (request.expected_version !== 0) {
        return failure(
          request.request_id,
          'CONFLICT',
          '创建锚点时 expected_version 必须为 0。',
          'refresh_and_retry',
        );
      }

      const existing = replay(request, 'create-anchor');
      if (existing) return existing as CreateAnchorResult;

      const entityId = dependencies.createId();
      const eventId = dependencies.createId();
      const result = createAnchorResponseSchema.parse({
        entity_kind: 'anchor',
        entity_id: entityId,
        new_version: 1,
        domain_events: [
          {
            event_id: eventId,
            event_type: 'anchor.created',
            schema_version: 1,
            aggregate_type: 'anchor',
            aggregate_id: entityId,
            workspace_id: request.workspace_id,
            occurred_at: dependencies.now(),
            payload: {
              matter_id: request.matter_id,
              source_version_id: request.payload.source_version_id,
            },
          },
        ],
        local_save_status: 'not-persisted',
        warnings: [notPersistedWarning],
      });
      const success: CreateAnchorResult = { ok: true, value: result };
      results.set(request.idempotency_key, {
        operation: 'create-anchor',
        fingerprint: fingerprint(request),
        result: success,
      });
      return success;
    },
  };
}
