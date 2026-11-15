import type { CatalogRequest, CatalogResponse } from '../../../preload/caselite-api';
// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  defaultProjectVisualizationConfig,
  type ProjectGraph,
  type ProjectVisualizationConfig,
} from './project-visualization-view-model';
import { useProjectVisualizationView } from './useProjectVisualizationView';
const project = '11111111-1111-4111-8111-111111111111';
const task = '11111111-1111-4111-8111-111111111112';
function graph(id = project): ProjectGraph {
  return {
    project_id: id,
    depth: 2,
    node_limit: 200,
    read_only: false,
    truncated: false,
    fingerprint: 'a'.repeat(64),
    nodes: [
      {
        kind: 'project',
        id,
        title: '合成项目',
        status: 'planned',
        version: 1,
        project_type: 'general',
        professional_type: null,
        professional_fields: [],
      },
      { kind: 'task', id: task, title: '任务', version: 1 },
    ],
    edges: [
      { kind: 'project_task', from: { kind: 'project', id }, to: { kind: 'task', id: task } },
    ],
  };
}
let source: ProjectGraph;
let saved: ProjectVisualizationConfig;
let revision: number;
function reply(receipt?: { key: string; revision: number }): CatalogResponse {
  return {
    ok: true,
    projects: [],
    documents: [],
    state: null,
    target_id: source.project_id,
    receipt: receipt?.key ?? null,
    project_graph: source,
    project_visualization_view: {
      project_id: source.project_id,
      view_id: 'current',
      format_version: 1,
      revision,
      config: saved,
      saved_source_fingerprint: revision ? source.fingerprint : null,
      current_source_fingerprint: source.fingerprint,
      scope_pruned: false,
      read_only: source.read_only,
    },
    ...(receipt
      ? {
          visualization_receipt: {
            operation: 'save_project_visualization_view' as const,
            project_id: source.project_id,
            view_id: 'current' as const,
            idempotency_key: receipt.key,
            committed_revision: receipt.revision,
          },
        }
      : {}),
  };
}
function install(handler?: (request: CatalogRequest) => Promise<CatalogResponse>) {
  const catalog = vi.fn(
    handler ??
      (async (request) => {
        if (request.operation === 'save_project_visualization_view') {
          saved = request.config;
          revision++;
          return reply({ key: request.idempotency_key, revision });
        }
        return reply();
      }),
  );
  window.caselite = { catalog } as unknown as Window['caselite'];
  return catalog;
}
beforeEach(() => {
  source = graph();
  saved = structuredClone(defaultProjectVisualizationConfig);
  revision = 0;
});
afterEach(cleanup);
it('loads one bounded graph/view snapshot without writes or initial dirtiness; explicit save reopens the same configuration', async () => {
  const catalog = install();
  const hook = renderHook(() => useProjectVisualizationView(project, 'v1'));
  await waitFor(() => expect(hook.result.current.graph).toBeTruthy());
  expect(hook.result.current.dirty).toBe(false);
  expect(catalog.mock.calls.map(([r]) => r.operation)).toEqual(['read_project_visualization_view']);
  act(() =>
    hook.result.current.edit(
      { selected: { kind: 'task', id: task }, viewport: { x: 20, y: 30, zoom: 1.2 } },
      true,
    ),
  );
  expect(hook.result.current.dirty).toBe(false);
  act(() =>
    hook.result.current.edit({
      custom_labels: [{ node: { kind: 'task', id: task }, text: '显示标签' }],
    }),
  );
  expect(hook.result.current.dirty).toBe(true);
  await act(async () => {
    expect(await hook.result.current.save()).toBe(true);
  });
  expect(hook.result.current.dirty).toBe(false);
  expect(revision).toBe(1);
  hook.unmount();
  const reopened = renderHook(() => useProjectVisualizationView(project, 'v1'));
  await waitFor(() => expect(reopened.result.current.committed?.revision).toBe(1));
  expect(reopened.result.current.draft.custom_labels[0].text).toBe('显示标签');
});
it('uses original project/view/key for unknown status and original payload for retry; an old acknowledgement never restores old configuration', async () => {
  let attempt = 0;
  let original:
    Extract<CatalogRequest, { operation: 'save_project_visualization_view' }> | undefined;
  const catalog = install(async (request) => {
    if (request.operation === 'save_project_visualization_view') {
      original ??= request;
      attempt++;
      if (attempt === 1) throw new Error('lost acknowledgement');
      expect(request).toEqual(original);
      saved = { ...request.config, representation: 'list', labels: 'full' };
      revision = 3;
      return reply({ key: request.idempotency_key, revision: 1 });
    }
    if (request.operation === 'project_visualization_view_status')
      return { ok: false, code: 'NOT_FOUND', message: 'not yet' };
    return reply();
  });
  const hook = renderHook(() => useProjectVisualizationView(project, '1'));
  await waitFor(() => expect(hook.result.current.graph).toBeTruthy());
  act(() => hook.result.current.edit({ labels: 'compact' }));
  await act(async () => {
    await hook.result.current.save();
  });
  expect(hook.result.current.phase).toBe('unknown');
  expect(await hook.result.current.retry()).toBe(false);
  expect(
    catalog.mock.calls.filter(([r]) => r.operation === 'save_project_visualization_view'),
  ).toHaveLength(1);
  act(() => hook.result.current.edit({ labels: 'full' }));
  expect(hook.result.current.draft.labels).toBe('compact');
  await act(async () => {
    await hook.result.current.check();
  });
  expect(
    catalog.mock.calls.findLast(
      ([request]) => request.operation === 'project_visualization_view_status',
    )?.[0],
  ).toMatchObject({
    operation: 'project_visualization_view_status',
    project_id: project,
    view_id: 'current',
    idempotency_key: original!.idempotency_key,
  });
  await act(async () => {
    await hook.result.current.retry();
  });
  expect(hook.result.current.committed?.revision).toBe(3);
  expect(hook.result.current.draft.labels).toBe('full');
  expect(hook.result.current.draft.representation).toBe('list');
  expect(catalog.mock.calls.some(([r]) => r.operation === 'status')).toBe(false);
});
it('drops cross-project and out-of-order reads, preserves local expression on source hints and rejects mismatched response fingerprints', async () => {
  const resolvers: ((value: CatalogResponse) => void)[] = [];
  const catalog = install(() => new Promise((resolve) => resolvers.push(resolve)));
  const hook = renderHook(({ id, hint }) => useProjectVisualizationView(id, hint), {
    initialProps: { id: project, hint: '1' },
  });
  await waitFor(() => expect(resolvers).toHaveLength(1));
  await act(async () => {
    resolvers[0](reply());
  });
  act(() =>
    hook.result.current.edit({
      positions: [{ node: { kind: 'task', id: task }, x: 17, y: 23 }],
      custom_labels: [{ node: { kind: 'task', id: task }, text: '保留标签' }],
    }),
  );
  hook.rerender({ id: project, hint: '2' });
  await waitFor(() => expect(resolvers).toHaveLength(2));
  source = {
    ...source,
    fingerprint: 'b'.repeat(64),
    nodes: source.nodes.map((n) =>
      n.kind === 'task' ? { ...n, title: '任务改名', version: 2 } : n,
    ),
  };
  await act(async () => {
    resolvers[1](reply());
  });
  expect(hook.result.current.draft.custom_labels[0].text).toBe('保留标签');
  expect(hook.result.current.draft.positions[0].x).toBe(17);
  expect(hook.result.current.sourceChanged).toBe(true);
  hook.rerender({ id: project, hint: '3' });
  await waitFor(() => expect(resolvers).toHaveLength(3));
  const next = '22222222-2222-4222-8222-222222222222';
  hook.rerender({ id: next, hint: '4' });
  await waitFor(() => expect(resolvers).toHaveLength(4));
  await act(async () => {
    resolvers[2](reply());
  });
  expect(hook.result.current.graph).toBeNull();
  source = graph(next);
  await act(async () => {
    resolvers[3](reply());
  });
  expect(hook.result.current.graph?.project_id).toBe(next);
  hook.rerender({ id: next, hint: '5' });
  await waitFor(() => expect(resolvers).toHaveLength(5));
  const wrong = reply();
  if (wrong.ok) wrong.project_visualization_view!.current_source_fingerprint = 'c'.repeat(64);
  await act(async () => {
    resolvers[4](wrong);
  });
  expect(hook.result.current.graph).toBeNull();
  expect(hook.result.current.phase).toBe('failed');
  expect(catalog.mock.calls.every(([r]) => r.operation === 'read_project_visualization_view')).toBe(
    true,
  );
});
it('retains drafts on known failures and does not silently overwrite a concurrent saved view', async () => {
  install(async (request) =>
    request.operation === 'save_project_visualization_view'
      ? { ok: false, code: 'CONFLICT', message: '来源冲突' }
      : reply(),
  );
  const hook = renderHook(({ hint }) => useProjectVisualizationView(project, hint), {
    initialProps: { hint: '1' },
  });
  await waitFor(() => expect(hook.result.current.graph).toBeTruthy());
  act(() => hook.result.current.edit({ labels: 'compact' }));
  await act(async () => {
    await hook.result.current.save();
  });
  expect(hook.result.current.draft.labels).toBe('compact');
  expect(hook.result.current.dirty).toBe(true);
  revision = 2;
  saved = { ...saved, representation: 'list' };
  hook.rerender({ hint: '2' });
  await waitFor(() => expect(hook.result.current.externalChanged).toBe(true));
  expect(hook.result.current.draft.labels).toBe('compact');
  expect(await hook.result.current.save()).toBe(false);
  act(() => hook.result.current.discard());
  expect(hook.result.current.committed?.revision).toBe(2);
  expect(hook.result.current.draft.representation).toBe('list');
});

it('removes an inaccessible graph after a scoped rejection while allowing explicit local draft abandonment', async () => {
  install(async (request) =>
    request.operation === 'save_project_visualization_view'
      ? { ok: false, code: 'NOT_FOUND', message: '项目不可访问' }
      : reply(),
  );
  const hook = renderHook(() => useProjectVisualizationView(project, '1'));
  await waitFor(() => expect(hook.result.current.graph).toBeTruthy());
  act(() => hook.result.current.edit({ labels: 'compact' }));
  await act(async () => {
    await hook.result.current.save();
  });
  expect(hook.result.current.graph).toBeNull();
  expect(hook.result.current.dirty).toBe(true);
  expect(hook.result.current.locked).toBe(false);
  act(() => hook.result.current.discard());
  expect(hook.result.current.dirty).toBe(false);
  expect(hook.result.current.graph).toBeNull();
});

it('distinguishes a missing receipt from lost scope with a narrow read before enabling retry', async () => {
  let readable = true;
  const catalog = install(async (request) => {
    if (request.operation === 'save_project_visualization_view') {
      readable = false;
      throw new Error('synthetic lost ack and scope');
    }
    if (request.operation === 'project_visualization_view_status' || !readable)
      return { ok: false, code: 'NOT_FOUND', message: 'not found' };
    return reply();
  });
  const hook = renderHook(() => useProjectVisualizationView(project, '1'));
  await waitFor(() => expect(hook.result.current.graph).toBeTruthy());
  act(() =>
    hook.result.current.edit({
      custom_labels: [{ node: { kind: 'task', id: task }, text: '不得回泄的旧标签' }],
    }),
  );
  await act(async () => {
    await hook.result.current.save();
  });
  await act(async () => {
    await hook.result.current.check();
  });
  expect(hook.result.current.graph).toBeNull();
  expect(hook.result.current.canRetry).toBe(false);
  expect(hook.result.current.phase).toBe('failed');
  expect(hook.result.current.error).toContain('项目范围已不可用');
  expect(await hook.result.current.retry()).toBe(false);
  expect(
    catalog.mock.calls.filter(
      ([request]) => request.operation === 'read_project_visualization_view',
    ),
  ).toHaveLength(2);
  expect(
    catalog.mock.calls.filter(
      ([request]) => request.operation === 'save_project_visualization_view',
    ),
  ).toHaveLength(1);
  expect(hook.result.current.hasUnresolved).toBe(true);
  expect(hook.result.current.locked).toBe(true);
  act(() => hook.result.current.discard());
  expect(hook.result.current.hasUnresolved).toBe(true);
  expect(hook.result.current.dirty).toBe(true);
  act(() => hook.result.current.abandon());
  expect(hook.result.current.hasUnresolved).toBe(false);
  expect(hook.result.current.locked).toBe(false);
  expect(hook.result.current.phase).toBe('abandoned');
  expect(hook.result.current.dirty).toBe(false);
  expect(hook.result.current.graph).toBeNull();
});
