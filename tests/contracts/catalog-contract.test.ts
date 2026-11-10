import { describe, expect, it, vi } from 'vitest';
import { catalogRequestSchema, CATALOG_CHANNEL } from '../../packages/contracts/src/catalog';
import { createCaseLitePreloadApi } from '../../apps/desktop/src/preload/caselite-api';
import { createCatalogApplication } from '../../packages/application/src/catalog-application';
describe('catalog boundary', () => {
  it('accepts optional bounded initial project bodies without adding defaults to legacy requests', () => {
    for (const operation of ['create_project', 'promote_task'] as const) {
      const request = {
        protocol_version: 1,
        operation,
        request_id: crypto.randomUUID(),
        idempotency_key: crypto.randomUUID(),
        title: '初始概述',
        ...(operation === 'promote_task'
          ? { task_id: crypto.randomUUID(), expected_version: 1 }
          : {}),
      };
      expect(catalogRequestSchema.parse(request)).toEqual(request);
      expect(catalogRequestSchema.safeParse({ ...request, state: [1, 2] }).success).toBe(true);
      for (const state of [[], [-1], [256], [1.5], '概述', Array(2_000_001).fill(0)])
        expect(catalogRequestSchema.safeParse({ ...request, state }).success).toBe(false);
    }
  });
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

it('preserves legacy request bytes while validating bounded project attributes for every consumer', () => {
  const attributes = {
    project_type: 'litigation',
    assignee: null,
    priority: 2,
    start_date: '2024-02-29',
    target_date: '2024-03-01',
    tags: ['合成'],
  };
  for (const operation of ['create_project', 'promote_task', 'update_project'] as const) {
    const request = {
      protocol_version: 1,
      request_id: crypto.randomUUID(),
      idempotency_key: crypto.randomUUID(),
      operation,
      ...(operation === 'promote_task'
        ? { task_id: crypto.randomUUID(), expected_version: 1 }
        : operation === 'update_project'
          ? { id: crypto.randomUUID(), expected_version: 1 }
          : {}),
      title: '合成',
      ...(operation === 'update_project' ? { status: 'active', expected_body_revision: 0 } : {}),
    };
    expect(JSON.stringify(catalogRequestSchema.parse(request))).toBe(JSON.stringify(request));
    expect(catalogRequestSchema.safeParse({ ...request, attributes }).success).toBe(true);
    for (const bad of [
      { priority: 5 },
      { priority: -1 },
      { priority: 1.5 },
      { project_type: 'criminal' },
      { assignee: '' },
      { assignee: 'x'.repeat(81) },
      { start_date: '2023-02-29' },
      { start_date: '0000-01-01' },
      { start_date: '2024-02-30' },
      { target_date: '2024-01-01' },
      { start_date: '2024-13-01' },
      { tags: [''] },
      { tags: ['x'.repeat(41)] },
      { tags: Array(21).fill('x') },
      { court: 'unknown' },
    ])
      expect(
        catalogRequestSchema.safeParse({ ...request, attributes: { ...attributes, ...bad } })
          .success,
        JSON.stringify(bad),
      ).toBe(false);
    expect(
      catalogRequestSchema.safeParse({
        ...request,
        attributes: {
          ...attributes,
          start_date: null,
          target_date: null,
          assignee: null,
          tags: [],
        },
      }).success,
    ).toBe(true);
  }
});
