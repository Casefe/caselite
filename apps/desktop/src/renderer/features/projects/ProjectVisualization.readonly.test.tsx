// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { useEffect } from 'react';
import { readFileSync } from 'node:fs';
import { ReactFlowProvider, useStoreApi } from '@xyflow/react';
import type { Matter, Task } from '../../../preload/caselite-api';
import ProjectVisualization from './ProjectVisualization';

type FlowStore = ReturnType<typeof useStoreApi>;

const project: Matter = {
  id: '11111111-1111-4111-8111-111111111111',
  title: '只读关系图合成项目',
  status: 'planned',
  version: 1,
  archived_at: null,
  body_id: '22222222-2222-4222-8222-222222222222',
  body_revision: 0,
  editor_schema: 1,
  updated_at: '2026-11-12',
  task_count: 1,
};
const tasks = [{ id: 'task-a', title: '当前任务', matter_id: project.id }] as Task[];
const documents = [
  {
    id: 'doc-a',
    title: '当前文档',
    task_id: 'task-a',
    matter_id: project.id,
  },
];

const nodeIds = [`project:${project.id}`, 'task:task-a', 'document:doc-a'];
const expectedEdgeEndpoints = [
  {
    id: `project:${project.id}:task:task-a`,
    source: `project:${project.id}`,
    target: 'task:task-a',
    sourceHandle: null,
    targetHandle: null,
  },
  {
    id: 'task:task-a:document:doc-a',
    source: 'task:task-a',
    target: 'document:doc-a',
    sourceHandle: null,
    targetHandle: null,
  },
];
const expectedHandles = nodeIds.flatMap((nodeId) => [
  { nodeId, handleId: 'left', type: 'target', position: 'left' },
  { nodeId, handleId: 'right', type: 'source', position: 'right' },
  { nodeId, handleId: 'top', type: 'target', position: 'top' },
  { nodeId, handleId: 'bottom', type: 'source', position: 'bottom' },
]);

let style: HTMLStyleElement;
const runtimeDescriptors: {
  target: object;
  key: string;
  descriptor: PropertyDescriptor | undefined;
}[] = [];
let originalBoundingRect: PropertyDescriptor | undefined;
let originalOffsetWidth: PropertyDescriptor | undefined;
let originalOffsetHeight: PropertyDescriptor | undefined;
let originalElementFromPoint: PropertyDescriptor | undefined;
let hitElement: Element | null = null;

function setRuntimeProperty(key: string, value: unknown) {
  const targets = Array.from(new Set<object>([globalThis, window]));
  targets.forEach((target) => {
    runtimeDescriptors.push({
      target,
      key,
      descriptor: Object.getOwnPropertyDescriptor(target, key),
    });
    Object.defineProperty(target, key, { configurable: true, writable: true, value });
  });
}

beforeAll(() => {
  style = document.createElement('style');
  style.textContent = readFileSync('node_modules/@xyflow/react/dist/style.css', 'utf8');
  document.head.append(style);

  class ResizeObserverStub {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element) {
      queueMicrotask(() => {
        this.callback(
          [
            {
              target,
              contentRect: { width: 900, height: 600 },
            } as ResizeObserverEntry,
          ],
          this as unknown as ResizeObserver,
        );
      });
    }
    unobserve() {}
    disconnect() {}
  }
  class DOMMatrixReadOnlyStub {
    a = 1;
    b = 0;
    c = 0;
    d = 1;
    e = 0;
    f = 0;
    m22 = 1;
  }
  setRuntimeProperty('ResizeObserver', ResizeObserverStub);
  setRuntimeProperty('DOMMatrixReadOnly', DOMMatrixReadOnlyStub);

  // jsdom 没有原生布局；固定 900×600 尺寸只供真实库测量，不作为业务几何断言。
  originalBoundingRect = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'getBoundingClientRect',
  );
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 900,
      bottom: 600,
      width: 900,
      height: 600,
      toJSON: () => undefined,
    }),
  });
  originalOffsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
  originalOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get: () => 180,
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get: () => 100,
  });
  originalElementFromPoint = Object.getOwnPropertyDescriptor(document, 'elementFromPoint');
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    value: () => hitElement,
  });
});

afterEach(() => {
  cleanup();
  hitElement = null;
});

afterAll(() => {
  style.remove();
  if (originalBoundingRect) {
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalBoundingRect);
  } else {
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).getBoundingClientRect;
  }
  if (originalOffsetWidth) {
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', originalOffsetWidth);
  } else {
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetWidth;
  }
  if (originalOffsetHeight) {
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', originalOffsetHeight);
  } else {
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetHeight;
  }
  if (originalElementFromPoint) {
    Object.defineProperty(document, 'elementFromPoint', originalElementFromPoint);
  } else {
    delete (document as unknown as Record<string, unknown>).elementFromPoint;
  }
  runtimeDescriptors.reverse().forEach(({ target, key, descriptor }) => {
    if (descriptor) Object.defineProperty(target, key, descriptor);
    else delete (target as Record<string, unknown>)[key];
  });
});

function StoreObserver({ onReady }: { onReady(store: FlowStore): void }) {
  const store = useStoreApi();
  useEffect(() => onReady(store), [onReady, store]);
  return null;
}

async function mountVisualization() {
  let store: FlowStore | undefined;
  const readStore = (value: FlowStore) => {
    store = value;
  };
  render(
    <ReactFlowProvider>
      <ProjectVisualization
        project={project}
        tasks={tasks}
        documents={documents}
        readError={false}
        onOpen={() => undefined}
        onInspect={() => undefined}
        sidebarCollapsed={false}
        onToggleSidebar={() => undefined}
      />
      <StoreObserver onReady={readStore} />
    </ReactFlowProvider>,
  );
  await waitFor(() => expect(document.querySelectorAll('.react-flow__handle')).toHaveLength(12));
  if (!store) throw new Error('ReactFlowProvider did not expose its store');
  await waitFor(() =>
    expect(
      Array.from(store!.getState().nodeLookup.values()).every(
        (node) => node.internals.handleBounds !== undefined,
      ),
    ).toBe(true),
  );
  return store;
}

function readHandles() {
  return Array.from(document.querySelectorAll<HTMLElement>('.react-flow__handle')).map(
    (handle) => ({
      nodeId: handle.dataset.nodeid!,
      handleId: handle.dataset.handleid!,
      type: handle.classList.contains('source') ? 'source' : 'target',
      position: handle.dataset.handlepos!,
    }),
  );
}

function readEdges(store: FlowStore) {
  return store.getState().edges.map(({ id, source, target, sourceHandle, targetHandle }) => ({
    id,
    source,
    target,
    sourceHandle: sourceHandle ?? null,
    targetHandle: targetHandle ?? null,
  }));
}

describe('项目可视化关系图只读端点', () => {
  it('保留精确的节点、边和十二个端点，同时关闭全部连接标志与命中', async () => {
    const store = await mountVisualization();
    expect(store.getState().nodes.map((node) => node.id)).toEqual(nodeIds);
    expect(store.getState().nodesConnectable).toBe(false);
    expect(readEdges(store)).toEqual(expectedEdgeEndpoints);
    expect(readHandles()).toEqual(expectedHandles);

    for (const handle of document.querySelectorAll<HTMLElement>('.react-flow__handle')) {
      expect(handle.classList.contains('connectable')).toBe(false);
      expect(handle.classList.contains('connectionindicator')).toBe(false);
      expect(handle.classList.contains('connectablestart')).toBe(false);
      expect(handle.classList.contains('connectableend')).toBe(false);
      expect(getComputedStyle(handle).pointerEvents).toBe('none');
    }
  });

  it('即使事件直达精确 source 端点，也不启动连接或改变既有边', async () => {
    const store = await mountVisualization();
    let connectStarts = 0;
    let connectEnds = 0;
    let connects = 0;
    await act(async () => {
      store.setState({
        onConnectStart: () => {
          connectStarts += 1;
        },
        onConnectEnd: () => {
          connectEnds += 1;
        },
        onConnect: () => {
          connects += 1;
        },
      });
    });

    const sourceHandle = document.querySelector<HTMLElement>(
      '[data-nodeid="task:task-a"][data-handleid="right"]',
    );
    expect(sourceHandle).toBeTruthy();
    expect(sourceHandle?.classList.contains('source')).toBe(true);
    hitElement = sourceHandle;

    const beforeEdges = readEdges(store);
    const inProgressChanges: boolean[] = [];
    let lastInProgress = store.getState().connection.inProgress;
    const unsubscribe = store.subscribe((state) => {
      if (state.connection.inProgress !== lastInProgress) {
        lastInProgress = state.connection.inProgress;
        inProgressChanges.push(lastInProgress);
      }
    });

    try {
      expect(store.getState().connection.inProgress).toBe(false);
      await act(async () => {
        sourceHandle!.dispatchEvent(
          new MouseEvent('mousedown', {
            bubbles: true,
            button: 0,
            clientX: 100,
            clientY: 100,
          }),
        );
        document.dispatchEvent(
          new MouseEvent('mousemove', {
            bubbles: true,
            buttons: 1,
            clientX: 140,
            clientY: 100,
          }),
        );
      });
      expect(connectStarts).toBe(0);
      expect(store.getState().connection.inProgress).toBe(false);

      await act(async () => {
        document.dispatchEvent(
          new MouseEvent('mouseup', {
            bubbles: true,
            button: 0,
            clientX: 140,
            clientY: 100,
          }),
        );
      });
      expect(connectEnds).toBe(0);
      expect(connects).toBe(0);
      expect(inProgressChanges).not.toContain(true);
      expect(store.getState().connection.inProgress).toBe(false);
      expect(readEdges(store)).toEqual(beforeEdges);
      expect(beforeEdges).toEqual(expectedEdgeEndpoints);
    } finally {
      unsubscribe();
    }
  });
});
