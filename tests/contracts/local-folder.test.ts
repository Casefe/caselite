import { afterEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  folderRequestSchema,
  folderResponseSchema,
  materialSchema,
  personalMaterialSchema,
  personalMaterialHeaderSchema,
  FOLDER_CHANNEL,
} from '@caselite/contracts';
import {
  createCaseLitePreloadApi,
  IPC_COMMAND_TIMEOUT_MS,
} from '../../apps/desktop/src/preload/caselite-api';
afterEach(() => vi.useRealTimers());
it('keeps raw paths, persisted window grants and task ownership out of public folder DTOs', () => {
  const scope = { kind: 'workspace' },
    request = { protocol_version: 1, operation: 'restore_default', scope, view_generation: 1 };
  for (const extra of [
    { path: '/private/data' },
    { workspace_id: 'forged' },
    { session: 'old' },
    { epoch: 0 },
  ])
    expect(folderRequestSchema.safeParse({ ...request, ...extra }).success).toBe(false);
  expect(
    folderRequestSchema.safeParse({
      protocol_version: 1,
      operation: 'bind_project',
      project_id: randomUUID(),
      request_id: randomUUID(),
      expected_revision: 0,
      relative_directory: '../other',
    }).success,
  ).toBe(false);
  expect(
    folderResponseSchema.safeParse({ ok: true, state: 'ready', private_path: '/secret' }).success,
  ).toBe(false);
});
it('rejects personal sources as legacy Material and enforces strict personal identity', () => {
  const source = {
    id: randomUUID(),
    owner_kind: 'personal',
    asset_version_id: randomUUID(),
    name: 'test.pdf',
    kind: 'pdf',
    sha256: 'a'.repeat(64),
    bytes: 20,
    page_count: 1,
    derivation_id: randomUUID(),
    status: 'ready',
    pages: [
      { page: 1, text: '', origin: 'pdf_text', blocks: [], width: 1, height: 1, rotation: 0 },
    ],
  };
  expect(personalMaterialSchema.safeParse(source).success).toBe(true);
  expect(materialSchema.safeParse(source).success).toBe(false);
  expect(personalMaterialSchema.safeParse({ ...source, task_id: randomUUID() }).success).toBe(
    false,
  );
});
it('validates requests before IPC and rejects malformed host responses without exposing paths', async () => {
  const invoke = vi.fn(async () => ({ ok: true, state: 'ready', path: '/secret' }));
  const api = createCaseLitePreloadApi(invoke);
  const invalid = await api.folder!({
    protocol_version: 1,
    operation: 'configuration',
    scope: { kind: 'workspace' },
    path: '/secret',
  } as never);
  expect(invalid).toMatchObject({ ok: false, code: 'INVALID_REQUEST' });
  expect(invoke).not.toHaveBeenCalled();
  const result = await api.folder!({
    protocol_version: 1,
    operation: 'configuration',
    scope: { kind: 'workspace' },
  });
  expect(result).toMatchObject({ ok: false, code: 'RESULT_UNKNOWN' });
  expect(JSON.stringify(result)).not.toContain('/secret');
  expect(invoke.mock.calls[0][0]).toBe(FOLDER_CHANNEL);
});
it('times out with the original request id and never retries an unknown write', async () => {
  vi.useFakeTimers();
  const invoke = vi.fn(() => new Promise(() => {})),
    id = randomUUID();
  const result = createCaseLitePreloadApi(invoke).folder!({
    protocol_version: 1,
    operation: 'choose_default',
    request_id: id,
    expected_revision: 0,
  });
  await vi.advanceTimersByTimeAsync(IPC_COMMAND_TIMEOUT_MS);
  expect(await result).toMatchObject({ ok: false, code: 'RESULT_UNKNOWN', request_id: id });
  expect(invoke).toHaveBeenCalledTimes(1);
});
it('permits same-key durable resume without restoring an external root', () => {
  expect(
    folderRequestSchema.safeParse({
      protocol_version: 1,
      operation: 'resume_capture',
      scope: { kind: 'workspace' },
      request_id: randomUUID(),
      view_generation: 2,
    }).success,
  ).toBe(true);
});

it('keeps saved listing headers distinct from full opened source bodies', () => {
  const header = {
    id: randomUUID(),
    owner_kind: 'personal',
    asset_version_id: randomUUID(),
    name: 'fixed.pdf',
    kind: 'pdf',
    sha256: 'a'.repeat(64),
    bytes: 50,
    page_count: 1,
    derivation_id: randomUUID(),
    status: 'ready',
  };
  expect(personalMaterialHeaderSchema.safeParse(header).success).toBe(true);
  expect(personalMaterialSchema.safeParse(header).success).toBe(false);
  const response = {
    ok: true,
    state: 'listed',
    saved: [{ mapping_id: randomUUID(), source: header, relative_label: 'fixed.pdf' }],
  };
  expect(folderResponseSchema.safeParse(response).success).toBe(true);
  expect(personalMaterialHeaderSchema.safeParse({ ...header, pages: [] }).success).toBe(false);
  expect(
    folderResponseSchema.safeParse({
      ...response,
      saved: [{ ...response.saved[0], source: { ...header, pages: [] } }],
    }).success,
  ).toBe(false);
});
