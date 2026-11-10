import { afterEach, expect, it, vi } from 'vitest';
import { LOCAL_PREFERENCES_CHANNEL } from '@caselite/contracts';
import {
  createCaseLitePreloadApi,
  IPC_COMMAND_TIMEOUT_MS,
} from '../../apps/desktop/src/preload/caselite-api';
afterEach(() => vi.useRealTimers());
it('keeps a timed-out preference command unknown and never retries it', async () => {
  vi.useFakeTimers();
  const invoke = vi.fn(() => new Promise(() => {}));
  const request = { protocol_version: 1 as const, operation: 'read' as const };
  const pending = createCaseLitePreloadApi(invoke).preferences(request);
  await vi.advanceTimersByTimeAsync(IPC_COMMAND_TIMEOUT_MS + 1);
  expect(await pending).toMatchObject({ ok: false, code: 'RESULT_UNKNOWN' });
  expect(invoke).toHaveBeenCalledExactlyOnceWith(LOCAL_PREFERENCES_CHANNEL, request);
});
it('sanitizes malformed or rejected IPC without exposing raw details', async () => {
  const request = { protocol_version: 1 as const, operation: 'read' as const };
  for (const invoke of [
    async () => ({ private_path: '/synthetic/private' }),
    async () => {
      throw new Error('private-detail');
    },
  ]) {
    const response = await createCaseLitePreloadApi(invoke).preferences(request);
    expect(response).toMatchObject({ ok: false, code: 'RESULT_UNKNOWN' });
    expect(JSON.stringify(response)).not.toContain('private');
  }
});

it('sanitizes malformed statistics responses and preserves an unchanged legacy read response', async () => {
  const preferences = {
    name: '合成律师',
    email: '',
    avatar: 'initials' as const,
    show_word_count: false,
    version: 1,
  };
  let response: unknown = { ok: true, preferences, receipt: null };
  const invoke = vi.fn(async () => response);
  const api = createCaseLitePreloadApi(invoke);
  const read = { protocol_version: 1 as const, operation: 'read' as const };
  expect(await api.preferences(read)).toEqual(response);
  response = {
    ok: true,
    preferences: {
      ...preferences,
      statistics_cards: { tasks: { enabled: true, position: 'left' } },
    },
    receipt: null,
  };
  expect(await api.preferences(read)).toMatchObject({ ok: false, code: 'RESULT_UNKNOWN' });
  expect(invoke).toHaveBeenCalledTimes(2);
});

it('validates favorite locations without inventing a document favorite flag or changing old responses', async () => {
  const folder = '020ce80d-93bc-45cd-bd2b-24592f64213f';
  const task = '9501230c-9e53-4af7-b2b4-98b402807848';
  const preferences = {
    name: '合成律师',
    email: '',
    avatar: 'initials',
    show_word_count: false,
    version: 2,
    favorite_navigation: {
      folders: [{ id: folder, name: '诉讼案件' }],
      references: [{ kind: 'task', id: task, folder_id: folder }],
      document_folders: [],
    },
  };
  let response: unknown = { ok: true, preferences, receipt: null };
  const api = createCaseLitePreloadApi(async () => response);
  const request = { protocol_version: 1 as const, operation: 'read' as const };
  expect(await api.preferences(request)).toEqual(response);
  for (const favorite_navigation of [
    {
      ...preferences.favorite_navigation,
      references: [{ kind: 'document', id: task, folder_id: folder }],
    },
    {
      ...preferences.favorite_navigation,
      references: [{ kind: 'task', id: task, folder_id: 'c05affba-3d70-4e4f-8bb4-5ce1a9321b01' }],
    },
    {
      ...preferences.favorite_navigation,
      references: [
        preferences.favorite_navigation.references[0],
        preferences.favorite_navigation.references[0],
      ],
    },
    {
      ...preferences.favorite_navigation,
      document_folders: [{ id: task, folder_id: folder, favorite: true }],
    },
  ]) {
    response = { ok: true, preferences: { ...preferences, favorite_navigation }, receipt: null };
    expect(await api.preferences(request)).toMatchObject({ ok: false, code: 'RESULT_UNKNOWN' });
  }
});
