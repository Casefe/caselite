import { beforeEach, expect, it, vi } from 'vitest';
import {
  skillPreviewInputSchema,
  skillPreviewResultSchema,
  SKILLS_PREVIEW_CHANNEL,
} from '@caselite/contracts';
import { createCaseLitePreloadApi } from '../../preload/caselite-api';
const state = vi.hoisted(() => ({
  trusted: true,
  handlers: new Map<string, (event: unknown, input: unknown) => unknown>(),
}));
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, input: unknown) => unknown) =>
      state.handlers.set(channel, handler),
  },
}));
vi.mock('./window-capabilities', () => ({ isTrustedBusinessSender: () => state.trusted }));
import { registerSkillsPreviewIpc } from './register-skills-preview-ipc';
const input = () => ({
  files: [
    {
      path: 'skill/SKILL.md',
      kind: 'file' as const,
      bytes: new TextEncoder().encode('---\nname: demo\ndescription: synthetic\n---\nDo nothing'),
    },
  ],
});
beforeEach(() => {
  state.trusted = true;
  state.handlers.clear();
  registerSkillsPreviewIpc();
});
it('runs the real Preload → trusted IPC → Application preview without persistence', async () => {
  const original = input();
  const bytes = original.files[0].bytes.slice();
  const api = createCaseLitePreloadApi(async (channel, request) =>
    state.handlers.get(channel)!({}, request),
  );
  expect(await api.previewSkills!(original)).toMatchObject({
    status: 'preview',
    candidates: [{ kind: 'method', reviewRequired: true }],
  });
  expect(original.files[0].bytes).toEqual(bytes);
  expect(await api.previewSkills!(original)).toMatchObject({ status: 'preview' });
});
it('rejects untrusted sender and malformed/authority-bearing payloads', () => {
  const handler = state.handlers.get(SKILLS_PREVIEW_CHANNEL)!;
  state.trusted = false;
  expect(handler({}, input())).toEqual({ status: 'rejected', code: 'FORBIDDEN' });
  state.trusted = true;
  for (const value of [
    { ...input(), path: '/secret' },
    { files: [{ ...input().files[0], bytes: [1] }] },
    { ...input(), execute: true },
  ])
    expect(handler({}, value)).toEqual({ status: 'rejected', code: 'INVALID_INPUT' });
  expect(handler({}, { files: [{ ...input().files[0], path: '../SKILL.md' }] })).toEqual({
    status: 'rejected',
    code: 'UNSAFE_PATH',
  });
  expect(handler({}, { files: [], cancelled: true })).toEqual({ status: 'cancelled' });
});
it('validates response shape, budgets, timeout and transport failure at Preload', async () => {
  const invoke = vi.fn(async () => ({ status: 'preview', files: [] }));
  const api = createCaseLitePreloadApi(invoke);
  expect(await api.previewSkills!(input())).toEqual({ status: 'rejected', code: 'INVALID_RESULT' });
  expect(
    await api.previewSkills!({
      ...input(),
      files: Array.from({ length: 501 }, () => input().files[0]),
    }),
  ).toEqual({ status: 'rejected', code: 'INVALID_INPUT' });
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(
    skillPreviewInputSchema.safeParse({
      files: Array.from({ length: 7 }, (_, n) => ({
        path: `${n}`,
        kind: 'file',
        bytes: new Uint8Array(5 * 1024 * 1024),
      })),
    }).success,
  ).toBe(false);
  expect(
    skillPreviewResultSchema.safeParse({ status: 'rejected', code: 'x', secrets: 'x' }).success,
  ).toBe(false);
  const unavailable = createCaseLitePreloadApi(async () => {
    throw new Error('private details');
  });
  expect(await unavailable.previewSkills!(input())).toEqual({
    status: 'rejected',
    code: 'PREVIEW_UNAVAILABLE',
  });
  vi.useFakeTimers();
  try {
    const pending = createCaseLitePreloadApi(() => new Promise(() => {})).previewSkills!(input());
    await vi.advanceTimersByTimeAsync(15001);
    expect(await pending).toEqual({ status: 'rejected', code: 'PREVIEW_TIMEOUT' });
  } finally {
    vi.useRealTimers();
  }
});
