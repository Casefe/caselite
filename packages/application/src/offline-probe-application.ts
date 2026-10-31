import {
  offlineProbeResultSchema,
  type OfflineProbeRequest,
  type OfflineProbeResult,
} from '@caselite/contracts';

export type OfflineProbePort = {
  write(): void;
  read(): string | null;
  migrationCount(): number;
};

export function createOfflineProbeApplication(port: OfflineProbePort) {
  return {
    run(request: OfflineProbeRequest): OfflineProbeResult {
      try {
        if (request.action === 'write') port.write();
        return offlineProbeResultSchema.parse({
          ok: true,
          value: {
            record_id: request.record_id,
            stored_value: port.read(),
            migration_count: port.migrationCount(),
          },
        });
      } catch {
        return offlineProbeResultSchema.parse({
          ok: false,
          error: {
            code: 'INTERNAL',
            message: '临时测试数据库不可用；请检查测试环境。',
            retryable: false,
            recovery_action: 'contact_support',
            correlation_id: crypto.randomUUID(),
          },
        });
      }
    },
  };
}
