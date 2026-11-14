// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useProjectOriginals } from './useProjectOriginals';

afterEach(() => vi.restoreAllMocks());
it('discards a late project A result after project B is selected', async () => {
  let resolveA!: (value: unknown) => void;
  const material = vi.fn((request: { project_id: string }) =>
    request.project_id === 'A'
      ? new Promise((resolve) => {
          resolveA = resolve;
        })
      : Promise.resolve({ ok: true, materials: [{ id: 'b', name: 'b.pdf' }] }),
  );
  window.caselite = { material } as unknown as Window['caselite'];
  const { result } = renderHook(() => useProjectOriginals());
  act(() => {
    void result.current.load('A');
    void result.current.load('B');
  });
  await waitFor(() => expect(result.current.materials[0]?.id).toBe('b'));
  await act(async () => {
    resolveA({ ok: true, materials: [{ id: 'a', name: 'a.pdf' }] });
  });
  expect(result.current.projectId).toBe('B');
  expect(result.current.materials.map((item) => item.id)).toEqual(['b']);
});

it('clears previously visible original names when a source loses scope', async () => {
  const material = vi.fn(async (request: { operation: string }) =>
    request.operation === 'list_project'
      ? { ok: true, materials: [{ id: 'a', name: 'a.pdf' }] }
      : { ok: false, code: 'SCOPE', message: '项目范围已失效' },
  );
  window.caselite = { material } as unknown as Window['caselite'];
  const { result } = renderHook(() => useProjectOriginals());
  await act(async () => {
    await result.current.load('A');
  });
  const source = result.current.materials[0];
  await act(async () => {
    await result.current.load('A', source);
  });
  expect(result.current.materials).toEqual([]);
  expect(result.current.selected).toBeNull();
  expect(result.current.error).toBe('项目范围已失效');
});
