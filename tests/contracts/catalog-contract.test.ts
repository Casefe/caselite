import { describe, expect, it, vi } from 'vitest';
import { catalogRequestSchema, CATALOG_CHANNEL } from '../../packages/contracts/src/catalog';
import { createCaseLitePreloadApi } from '../../apps/desktop/src/preload/caselite-api';
import { createCatalogApplication } from '../../packages/application/src/catalog-application';
describe('catalog boundary', () => {
  it('validates promotion identity and version without accepting workspace or path overrides', () => {
    const valid = {
      operation: 'promote_task',
      protocol_version: 1,
      request_id: crypto.randomUUID(),
      idempotency_key: crypto.randomUUID(),
      task_id: crypto.randomUUID(),
      expected_version: 1,
      title: '从任务创建',
    };
    expect(catalogRequestSchema.safeParse(valid).success).toBe(true);
    for (const extra of [
      { workspace: 'other' },
      { path: '/private/file' },
      { expected_version: 0 },
      { task_id: 'not-an-id' },
      { title: '  ' },
    ])
      expect(catalogRequestSchema.safeParse({ ...valid, ...extra }).success).toBe(false);
  });
  it('rejects unapproved fields, paths and legacy envelopes before accessing the store', () => {
    const execute = vi.fn();
    const app = createCatalogApplication({ execute });
    for (const input of [
      { operation: 'list', protocol_version: 0 },
      { operation: 'list', protocol_version: 1, workspace: 'other' },
      { operation: 'create_project', protocol_version: 1, title: 'A', path: '/private/file' },
    ])
      expect(app.execute(input)).toMatchObject({ ok: false, code: 'INVALID_REQUEST' });
    expect(execute).not.toHaveBeenCalled();
    expect(
      catalogRequestSchema.safeParse({
        operation: 'query_sql',
        protocol_version: 1,
        sql: 'SELECT *',
      }).success,
    ).toBe(false);
  });
  it('uses one fixed preload channel and rejects malformed receipts', async () => {
    const invoke = vi.fn(async () => ({
      ok: true,
      projects: [],
      documents: [],
      state: null,
      target_id: null,
      receipt: null,
    }));
    const api = createCaseLitePreloadApi(invoke);
    const request = { operation: 'list' as const, protocol_version: 1 as const };
    expect((await api.catalog(request)).ok).toBe(true);
    expect(invoke).toHaveBeenCalledWith(CATALOG_CHANNEL, request);
    invoke.mockResolvedValueOnce({ ok: true } as never);
    expect(await api.catalog(request)).toMatchObject({ ok: false, code: 'RESULT_UNKNOWN' });
  });
});
