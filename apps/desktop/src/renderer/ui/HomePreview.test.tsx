// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type {
  AgentRequest,
  AgentResponse,
  AgentRun,
  Material,
  MaterialResponse,
} from '../../preload/caselite-api';
import AgentHome from './AgentHome';
import AgentPanel from './AgentPanel';
import { HomePreview } from './HomePreview';
import type { RichDraft } from '../editors/RichEditor';
import { FourColumnWorkspace } from './FourColumnWorkspace';
import { PageNavigationProvider } from '../shared/navigation/PageNavigation';

const geometry = vi.hoisted(() => ({ layouts: [] as Record<string, number>[] }));
const readerActions = vi.hoisted(() => ({ close: undefined as (() => void) | undefined }));
vi.mock('react-resizable-panels', async () => {
  const React = await import('react');
  return {
    Group: ({ children, groupRef }: { children: ReactNode; groupRef: React.Ref<unknown> }) => {
      React.useImperativeHandle(groupRef, () => ({
        setLayout: (value: Record<string, number>) => geometry.layouts.push(value),
      }));
      return <div data-testid="home-panels">{children}</div>;
    },
    Panel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    Separator: () => null,
  };
});
vi.mock('./PdfReader', () => ({
  default: function Reader({ name, onClose }: { name: string; onClose(): void }) {
    const [page, setPage] = useState(1);
    readerActions.close = onClose;
    return (
      <section aria-label="合成PDF阅读器">
        <strong>{name}</strong>
        <span>测试页码 {page}</span>
        <button onClick={() => setPage(page + 1)}>合成下一页</button>
        <button onClick={onClose}>收起阅读</button>
      </section>
    );
  },
}));
vi.mock('./DocxDraftPreview', () => ({ DocxDraftPreview: () => <p>既有DOCX草稿预览</p> }));
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  geometry.layouts = [];
  readerActions.close = undefined;
});

const source: Material = {
  id: 'preview-source',
  task_id: 'origin-task',
  asset_version_id: 'preview-version',
  name: '合成原件.pdf',
  sha256: '0'.repeat(64),
  bytes: 100,
  page_count: 1,
  derivation_id: null,
  status: 'ready',
  pages: [{ page: 1, text: '固定原件正文', origin: 'pdf_text' }],
};
const run = (id: string, patch: Partial<AgentRun> = {}): AgentRun => ({
  id,
  scope: 'origin-task',
  prompt: `历史问题-${id}`,
  output: `实际回答-${id}`,
  model: 'gpt-4.1-mini',
  provider: 'openai',
  status: 'succeeded',
  sequence: 1,
  message: '已完成',
  usage: null,
  attachments: [{ source_id: source.id, task_id: source.task_id, name: source.name, pages: [1] }],
  ...patch,
});
function fixture(
  records: AgentRun[],
  materialRead?: (request: { scope: string; source_id?: string }) => Promise<MaterialResponse>,
) {
  const profile = (runs: AgentRun[] = []): AgentResponse => ({
    ok: true,
    configured: true,
    providers: { openai: true, deepseek: false },
    model: 'gpt-4.1-mini',
    runs,
  });
  const agent = vi.fn(async (request: AgentRequest): Promise<AgentResponse> => {
    if (request.operation === 'history') return profile(records);
    if (request.operation === 'read')
      return profile(records.filter((item) => item.scope === request.scope));
    return profile();
  });
  const material = vi.fn(async (request): Promise<MaterialResponse> =>
    request.operation === 'read'
      ? materialRead
        ? materialRead(request)
        : { ok: true, materials: [source], data: new Uint8Array([1, 2]) }
      : { ok: true, materials: [], staged: null },
  );
  window.caselite = {
    agent,
    material,
    catalog: vi.fn(async () => ({
      ok: true,
      projects: [],
      documents: [],
      state: null,
      target_id: null,
      receipt: null,
    })),
  } as unknown as Window['caselite'];
  return { agent, material, profile };
}

it('shows the same default Word paragraphs that the homepage submits for preview', async () => {
  const docx: Material = {
    ...source,
    id: 'home-default-word',
    task_id: 'home',
    name: '首页合成合同.docx',
    page_count: 2,
    pages: [1, 2].map((page) => ({ page, text: `第${page}段`, origin: 'docx_text' })),
  };
  const { agent, material } = fixture([]);
  let imported = false;
  material.mockImplementation(async (request) => {
    if (request.operation === 'commit') imported = true;
    return {
      ok: true,
      materials: imported ? [docx] : [],
      ...(request.operation === 'read' ? { data: new Uint8Array([1]) } : {}),
    };
  });
  window.caselite.pickPdf = vi.fn(async () => ({
    ok: true,
    materials: [],
    staged: { token: docx.id, name: docx.name, bytes: docx.bytes },
  }));
  render(<Home />);
  fireEvent.change(await screen.findByLabelText('Agent 工作目标'), {
    target: { value: '审查合同' },
  });
  fireEvent.click(screen.getByRole('button', { name: '添加文件与材料' }));
  fireEvent.click(screen.getByRole('menuitem', { name: '文件' }));
  fireEvent.click(
    await screen.findByRole('button', { name: /首页合成合同.docx.*全部 2 个可读取段落/ }),
  );
  const reader = await screen.findByLabelText('Word 固定原件');
  expect(
    within(reader)
      .getAllByRole('checkbox')
      .every((input) => (input as HTMLInputElement).checked),
  ).toBe(true);
  expect(material.mock.calls.some(([request]) => request.operation === 'preview')).toBe(false);
  expect(agent.mock.calls.some(([request]) => request.operation === 'start')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '发送', exact: true }));
  await waitFor(() =>
    expect(
      material.mock.calls.some(
        ([request]) =>
          request.operation === 'preview' &&
          JSON.stringify(request.selected) ===
            JSON.stringify([{ source_id: docx.id, pages: [1, 2] }]),
      ),
    ).toBe(true),
  );
  expect(agent.mock.calls.some(([request]) => request.operation === 'start')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '移除附件 首页合成合同.docx' }));
});

it.each([
  ['finance', 'home'],
  ['task', 'eecceecc-eec0-4ecc-8ecc-eecceecceecc'],
])('keeps Word selection explicit in the %s agent panel', async (_name, scope) => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  const docx: Material = {
    ...source,
    id: `word-${scope}`,
    task_id: scope,
    name: '非首页合成合同.docx',
    page_count: 1,
    pages: [{ page: 1, text: '合成正文', origin: 'docx_text' }],
  };
  const { agent, material } = fixture([]);
  let imported = false;
  material.mockImplementation(async (request) => {
    if (request.operation === 'commit') imported = true;
    return {
      ok: true,
      materials: imported ? [docx] : [],
      ...(request.operation === 'read' ? { data: new Uint8Array([1]) } : {}),
    };
  });
  window.caselite.pickPdf = vi.fn(async () => ({
    ok: true,
    materials: [],
    staged: { token: docx.id, name: docx.name, bytes: docx.bytes },
  }));
  render(<AgentPanel scope={scope} variant="compact" />);
  fireEvent.change(
    await screen.findByLabelText(scope === 'home' ? 'Agent 工作目标' : 'AI 工作要求'),
    { target: { value: '审查合同' } },
  );
  fireEvent.click(screen.getByRole('button', { name: '添加文件与材料' }));
  fireEvent.click(screen.getByRole('menuitem', { name: '文件' }));
  fireEvent.click(
    await screen.findByRole('button', { name: /非首页合成合同.docx.*打开并选择段落/ }),
  );
  const reader = await screen.findByLabelText('Word 固定原件');
  expect((within(reader).getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '发送', exact: true }));
  expect(await screen.findByText('请先打开 Word 附件并选择本轮使用的段落。')).toBeTruthy();
  expect(material.mock.calls.some(([request]) => request.operation === 'preview')).toBe(false);
  expect(agent.mock.calls.some(([request]) => request.operation === 'start')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '移除附件 非首页合成合同.docx' }));
});
function Home({ onInspectorChange = () => {} }: { onInspectorChange?(open: boolean): void }) {
  const [open, setOpen] = useState(true);
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  );
  const [directory, setDirectory] = useState<HTMLDivElement | null>(null);
  const [prompt, setPrompt] = useState<RichDraft>({ text: '', state: null });
  return (
    <QueryClientProvider client={client}>
      <PageNavigationProvider
        value={{
          initial: null,
          register: () => () => {},
          report() {},
          beforeChange() {},
          inspector: {
            open,
            setOpen: (action) => {
              setOpen((current) => {
                const value = typeof action === 'function' ? action(current) : action;
                onInspectorChange(value);
                return value;
              });
            },
            pageKey: 'home',
            initialize() {},
          },
        }}
      >
        <FourColumnWorkspace.Provider
          value={{
            directory,
            directoryOpen: true,
            toggleDirectory() {},
            registerActions() {},
            actions: {},
          }}
        >
          <div ref={setDirectory} />
          <button onClick={() => setOpen((value) => !value)}>全局预览开关</button>
          <AgentHome
            prompt={prompt}
            onPrompt={setPrompt}
            tasks={[]}
            onOpen={() => {}}
            onNavigate={() => {}}
          />
        </FourColumnWorkspace.Provider>
      </PageNavigationProvider>
    </QueryClientProvider>
  );
}
async function selectRecord(record: AgentRun) {
  fireEvent.click(await screen.findByRole('button', { name: record.prompt, exact: true }));
  return screen.findByLabelText('只读运行记录');
}
const readCount = (material: ReturnType<typeof fixture>['material']) =>
  material.mock.calls.filter(([request]) => request.operation === 'read').length;

it('keeps empty home closed under the global toggle and has no five-tab placeholders', async () => {
  fixture([]);
  render(<Home />);
  await screen.findByText('暂无运行中的智能体');
  const preview = screen.getByLabelText('首页预览');
  expect(preview.hidden).toBe(true);
  expect(geometry.layouts.at(-1)?.['home-auxiliary']).toBe(0);
  fireEvent.click(screen.getByRole('button', { name: '全局预览开关' }));
  expect(preview.hidden).toBe(true);
  expect(geometry.layouts.at(-1)?.['home-auxiliary']).toBe(0);
  expect(screen.queryByRole('navigation', { name: '预览内容' })).toBeNull();
  for (const text of ['对话信息', '本轮材料', '当前没有可确认的已保存成果。', '重要日程'])
    expect(screen.queryByText(text)).toBeNull();
  expect(screen.getAllByLabelText('智能体')).toHaveLength(1);
  expect(screen.getByLabelText('对话运行状态').hidden).toBe(true);
});

it('opens the original scoped attachment, preserves its reader through collapse/reopen, closes it and retains the live draft', async () => {
  const record = run('pdf');
  const { agent, material } = fixture([record]);
  render(<Home />);
  const draft = (await screen.findByLabelText('Agent 工作目标')) as HTMLTextAreaElement;
  fireEvent.change(draft, { target: { value: '保留未发送要求' } });
  const history = await selectRecord(record);
  const attachment = within(history).getByRole('button', { name: /合成原件.pdf/ });
  attachment.focus();
  fireEvent.click(attachment);
  const reader = await screen.findByLabelText('合成PDF阅读器');
  const preview = screen.getByLabelText('首页预览');
  expect(preview.hidden).toBe(false);
  expect(preview.contains(reader)).toBe(true);
  expect(material).toHaveBeenCalledWith({
    protocol_version: 1,
    operation: 'read',
    scope: 'origin-task',
    source_id: source.id,
  });
  expect(screen.queryByRole('dialog', { name: '材料原件' })).toBeNull();
  fireEvent.click(within(reader).getByRole('button', { name: '合成下一页' }));
  fireEvent.click(screen.getByRole('button', { name: '收起预览' }));
  expect(preview.hidden).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '全局预览开关' }));
  expect(preview.hidden).toBe(false);
  expect(screen.getByLabelText('合成PDF阅读器')).toBe(reader);
  expect(within(reader).getByText('测试页码 2')).toBeTruthy();
  expect(readCount(material)).toBe(1);
  fireEvent.click(screen.getByRole('button', { name: '关闭预览' }));
  expect(preview.hidden).toBe(true);
  expect(screen.queryByLabelText('合成PDF阅读器')).toBeNull();
  expect(document.activeElement).toBe(attachment);
  fireEvent.click(screen.getByRole('button', { name: '新对话' }));
  expect(screen.getByLabelText('Agent 工作目标')).toBe(draft);
  expect(draft.value).toBe('保留未发送要求');
  expect(agent.mock.calls.some(([request]) => request.operation === 'start')).toBe(false);
  expect(screen.queryByLabelText('待发送附件')).toBeNull();
});

it('uses the existing safe message renderer for actual output and leaves stop reachable at maximum preview', async () => {
  const record = run('answer', {
    output:
      '# 实际回答\n\n![追踪](https://example.invalid/x.png)\n\n[外链](https://example.invalid)\n\n<script>window.secret=1</script>',
  });
  const { agent, profile } = fixture([record]);
  render(<Home />);
  await selectRecord(record);
  fireEvent.click(screen.getByRole('button', { name: '预览回答' }));
  const preview = await screen.findByLabelText('回答预览');
  await within(preview).findByRole('heading', { name: '实际回答' });
  expect(preview.querySelector('a,img,script,iframe')).toBeNull();
  expect(within(preview).getByText('[图片：追踪]')).toBeTruthy();
  expect(screen.getByRole('heading', { name: '回答内容 · 待人工核对' })).toBeTruthy();
  agent.mockImplementation(async (request) =>
    request.operation === 'active_runs'
      ? profile([
          run('running-elsewhere', { scope: 'another-task', status: 'running', output: '' }),
        ])
      : request.operation === 'read'
        ? profile([record])
        : profile([record]),
  );
  fireEvent.click(screen.getByRole('button', { name: '最大化预览' }));
  expect(geometry.layouts.at(-1)?.['home-conversation']).toBe(0);
  expect(screen.getByLabelText('对话运行状态').closest('[data-testid="home-panels"]')).toBeNull();
  await screen.findByRole('button', { name: '停止', exact: true });
  fireEvent.click(screen.getByRole('button', { name: '停止', exact: true }));
  expect(agent).toHaveBeenCalledWith({
    protocol_version: 1,
    operation: 'cancel',
    scope: 'another-task',
    run_id: 'running-elsewhere',
  });
});

it('shows real DOCX extracted original text and leaves historical paragraphs outside current selections', async () => {
  const docx = { ...source, name: '合成原件.docx' };
  const record = run('docx', {
    attachments: [{ source_id: docx.id, task_id: docx.task_id, name: docx.name, pages: [1] }],
  });
  fixture([record], async () => ({ ok: true, materials: [docx], data: new Uint8Array([1]) }));
  render(<Home />);
  const history = await selectRecord(record);
  fireEvent.click(within(history).getByRole('button', { name: /合成原件.docx/ }));
  const reader = await screen.findByLabelText('Word 固定原件');
  expect(screen.getByLabelText('首页预览').contains(reader)).toBe(true);
  expect(within(reader).getByText(/固定原件正文/)).toBeTruthy();
  expect(within(reader).getByText('固定原件已校验 · 以下为提取正文')).toBeTruthy();
  expect(within(reader).queryByRole('checkbox')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '新对话' }));
  expect(screen.getByLabelText('首页预览').hidden).toBe(true);
  expect(screen.queryByLabelText('待发送附件')).toBeNull();
});

it('rejects late historical reads after switching records and reports read failure without opening blank preview', async () => {
  let finish!: (value: MaterialResponse) => void;
  const first = run('late'),
    second = run('next');
  const { material } = fixture(
    [first, second],
    async () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(<Home />);
  const history = await selectRecord(first);
  fireEvent.click(within(history).getByRole('button', { name: /合成原件.pdf/ }));
  await act(async () => {});
  await selectRecord(second);
  await act(async () => finish({ ok: true, materials: [source], data: new Uint8Array([1]) }));
  expect(screen.getByLabelText('首页预览').hidden).toBe(true);
  expect(screen.queryByLabelText('合成PDF阅读器')).toBeNull();
  material.mockImplementation(async () => ({
    ok: false,
    code: 'RESULT_UNKNOWN',
    message: '原范围附件不可读取',
  }));
  fireEvent.click(
    within(screen.getByLabelText('只读运行记录')).getByRole('button', { name: /合成原件.pdf/ }),
  );
  expect((await screen.findByRole('alert')).textContent).toContain('原范围附件不可读取');
  expect(screen.getByLabelText('首页预览').hidden).toBe(true);
});

it('a later output intent invalidates a pending attachment and old cleanup cannot remove the output preview', async () => {
  let finish!: (value: MaterialResponse) => void;
  const record = run('intent');
  fixture(
    [record],
    async () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(<Home />);
  const history = await selectRecord(record);
  fireEvent.click(within(history).getByRole('button', { name: /合成原件.pdf/ }));
  fireEvent.click(screen.getByRole('button', { name: '预览回答' }));
  await screen.findByLabelText('回答预览');
  await act(async () => finish({ ok: true, materials: [source], data: new Uint8Array([1]) }));
  expect(screen.getByLabelText('首页预览').hidden).toBe(false);
  expect(screen.getByLabelText('回答预览').textContent).toContain(record.output);
  expect(screen.queryByLabelText('合成PDF阅读器')).toBeNull();
});

it('keeps a hidden live attachment read from taking over the selected historical preview and retains its draft attachment', async () => {
  let finish!: (value: MaterialResponse) => void;
  const liveSource = {
    ...source,
    id: 'live-preview-source',
    task_id: 'home',
    name: '本轮材料.pdf',
  };
  const historical = run('fixed-history');
  const { material } = fixture([historical]);
  let imported = false;
  material.mockImplementation(async (request) => {
    if (request.operation === 'read')
      return new Promise((resolve) => {
        finish = resolve;
      });
    if (request.operation === 'commit') imported = true;
    return { ok: true, materials: imported ? [liveSource] : [], staged: null };
  });
  window.caselite.pickPdf = vi.fn(async () => ({
    ok: true,
    materials: [],
    staged: { token: liveSource.id, name: liveSource.name, bytes: 100 },
  }));
  render(<Home />);
  const draft = (await screen.findByLabelText('Agent 工作目标')) as HTMLTextAreaElement;
  fireEvent.change(draft, { target: { value: '连同附件保留草稿' } });
  fireEvent.click(screen.getByRole('button', { name: '添加文件与材料' }));
  fireEvent.click(screen.getByRole('menuitem', { name: '文件' }));
  const attachment = await screen.findByRole('button', { name: /本轮材料.pdf.*本次发送/ });
  fireEvent.click(attachment);
  await selectRecord(historical);
  fireEvent.click(screen.getByRole('button', { name: '预览回答' }));
  await screen.findByLabelText('回答预览');
  await act(async () => finish({ ok: true, materials: [liveSource], data: new Uint8Array([1]) }));
  expect(screen.getByLabelText('回答预览').textContent).toContain(historical.output);
  expect(screen.queryByLabelText('合成PDF阅读器')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '新对话' }));
  expect(screen.getByLabelText('Agent 工作目标')).toBe(draft);
  expect(draft.value).toBe('连同附件保留草稿');
  expect(screen.getByRole('button', { name: /本轮材料.pdf.*本次发送/ })).toBe(attachment);
  expect(screen.getByLabelText('首页预览').hidden).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '移除附件 本轮材料.pdf' }));
});

it('keeps identical source IDs bound to the historical task scope and replaces only the requested preview', async () => {
  const first = run('scope-a');
  const second = run('scope-b', {
    scope: 'second-task',
    attachments: [
      { source_id: source.id, task_id: 'second-task', name: '另一范围.pdf', pages: [1] },
    ],
  });
  const { material } = fixture([first, second], async (request) => ({
    ok: true,
    materials: [
      {
        ...source,
        task_id: request.scope,
        name: request.scope === 'second-task' ? '另一范围.pdf' : source.name,
      },
    ],
    data: new Uint8Array([1]),
  }));
  render(<Home />);
  fireEvent.click(within(await selectRecord(first)).getByRole('button', { name: /合成原件.pdf/ }));
  await screen.findByLabelText('合成PDF阅读器');
  fireEvent.click(within(await selectRecord(second)).getByRole('button', { name: /另一范围.pdf/ }));
  const preview = screen.getByLabelText('首页预览');
  await within(preview).findByText('另一范围.pdf', { selector: 'strong' });
  expect(within(preview).queryByText('合成原件.pdf')).toBeNull();
  expect(material).toHaveBeenCalledWith({
    protocol_version: 1,
    operation: 'read',
    scope: 'second-task',
    source_id: source.id,
  });
  expect(
    material.mock.calls
      .filter(([request]) => request.operation === 'read')
      .map(([request]) => request.scope),
  ).toEqual(['origin-task', 'second-task']);
});

it('hides old content during a second read, preserves polling through collapse and blocks sending when status becomes unknown', async () => {
  vi.useFakeTimers();
  let finish!: (value: MaterialResponse) => void;
  const record = run('read-again');
  const { agent, material, profile } = fixture([record]);
  render(<Home />);
  await act(async () => {});
  fireEvent.click(screen.getByRole('button', { name: record.prompt, exact: true }));
  await act(async () => {});
  const attachment = within(screen.getByLabelText('只读运行记录')).getByRole('button', {
    name: /合成原件.pdf/,
  });
  fireEvent.click(attachment);
  await act(async () => {});
  expect(screen.getByLabelText('首页预览').hidden).toBe(false);
  material.mockImplementation(async (request) =>
    request.operation === 'read'
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : { ok: true, materials: [] },
  );
  fireEvent.click(attachment);
  await act(async () => {});
  expect(screen.getByLabelText('首页预览').hidden).toBe(true);
  await act(async () => finish({ ok: true, materials: [source], data: new Uint8Array([1]) }));
  expect(screen.getByLabelText('首页预览').hidden).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '收起预览' }));
  const before = agent.mock.calls.filter(([request]) => request.operation === 'active_runs').length;
  agent.mockImplementation(async (request) =>
    request.operation === 'active_runs'
      ? { ok: false, code: 'RESULT_UNKNOWN', message: '状态未知' }
      : profile([record]),
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(agent.mock.calls.filter(([request]) => request.operation === 'active_runs')).toHaveLength(
    before + 1,
  );
  fireEvent.click(screen.getByRole('button', { name: '新对话' }));
  const draft = screen.getByLabelText('Agent 工作目标');
  fireEvent.change(draft, { target: { value: '状态未知不得派发' } });
  expect(
    (screen.getByRole('button', { name: '发送', exact: true }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(agent.mock.calls.some(([request]) => request.operation === 'start')).toBe(false);
});

it('never previews raw command JSON or duplicates an existing action card', async () => {
  fixture([run('command', { output: '{"operation":"confirm_sensitive_action"}' })]);
  const begin = vi.fn(),
    show = vi.fn(),
    release = vi.fn();
  render(
    <HomePreview.Provider
      value={{
        enabled: true,
        session: 'custom',
        target: document.body,
        owner: null,
        begin,
        show,
        release,
      }}
    >
      <AgentPanel scope="origin-task" renderRun={() => <button>确认原有操作</button>} />
    </HomePreview.Provider>,
  );
  expect(await screen.findByRole('button', { name: '确认原有操作' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '预览回答' })).toBeNull();
  expect(screen.queryByText('{"operation":"confirm_sensitive_action"}')).toBeNull();
  expect(show).not.toHaveBeenCalled();
  expect(begin).not.toHaveBeenCalled();
});

it('does not offer a preview for an empty or still-running answer and never writes inspector state during unmount', async () => {
  const records = [
    run('empty', { output: '  ' }),
    run('still-running', { status: 'running', output: '尚未生成完成' }),
  ];
  fixture(records);
  const inspector = vi.fn();
  const view = render(<Home onInspectorChange={inspector} />);
  await selectRecord(records[0]);
  expect(screen.queryByRole('button', { name: '预览回答' })).toBeNull();
  await selectRecord(records[1]);
  expect(screen.queryByRole('button', { name: '预览回答' })).toBeNull();
  inspector.mockClear();
  view.unmount();
  expect(inspector).not.toHaveBeenCalled();
});

it.each([
  { format: 'pdf', maximized: false },
  { format: 'docx', maximized: false },
  { format: 'pdf', maximized: true },
  { format: 'docx', maximized: true },
])(
  'restores original attachment focus after the $format reader closes with maximized=$maximized',
  async ({ format, maximized }) => {
    const materialSource = { ...source, name: `合成原件.${format}` };
    const record = run(`own-close-${format}-${maximized}`, {
      attachments: [
        { source_id: source.id, task_id: source.task_id, name: materialSource.name, pages: [1] },
      ],
    });
    const active = run('focus-active', { scope: 'other-task', status: 'running', output: '' });
    const { agent, material, profile } = fixture([record], async () => ({
      ok: true,
      materials: [materialSource],
      data: new Uint8Array([1]),
    }));
    agent.mockImplementation(async (request) =>
      profile(request.operation === 'active_runs' ? [active] : [record]),
    );
    render(<Home />);
    await screen.findByRole('button', { name: '停止', exact: true });
    const history = await selectRecord(record);
    const attachment = within(history).getByRole('button', {
      name: new RegExp(materialSource.name),
    });
    attachment.focus();
    fireEvent.click(attachment);
    const reader = await screen.findByLabelText(
      format === 'pdf' ? '合成PDF阅读器' : 'Word 固定原件',
    );
    if (maximized) {
      fireEvent.click(screen.getByRole('button', { name: '最大化预览' }));
      expect(geometry.layouts.at(-1)?.['home-conversation']).toBe(0);
    }
    let conversationWidthAtFocus: number | undefined;
    attachment.addEventListener('focus', () => {
      conversationWidthAtFocus = geometry.layouts.at(-1)?.['home-conversation'];
    });
    const ownClose = within(reader).getByRole('button', { name: '收起阅读' });
    ownClose.focus();
    expect(document.activeElement).toBe(ownClose);
    fireEvent.click(ownClose);
    expect(document.activeElement).toBe(attachment);
    expect(conversationWidthAtFocus).toBe(100);
    expect(geometry.layouts.at(-1)?.['home-conversation']).toBe(100);
    expect(screen.getByLabelText('首页预览').hidden).toBe(true);
    expect(reader.isConnected).toBe(false);
    const stop = screen.getByRole('button', { name: '停止', exact: true });
    expect(stop.closest('[hidden], [inert]')).toBeNull();
    expect(readCount(material)).toBe(1);
    expect(
      agent.mock.calls.some(
        ([request]) => request.operation === 'start' || request.operation === 'cancel',
      ),
    ).toBe(false);
    expect(screen.queryByLabelText('待发送附件')).toBeNull();
  },
);

it.each(['removed', 'hidden', 'inert', 'disabled'])(
  'does not restore focus to a %s attachment trigger after reader close',
  async (state) => {
    const record = run(`invalid-trigger-${state}`);
    fixture([record]);
    render(<Home />);
    const history = await selectRecord(record);
    const attachment = within(history).getByRole('button', { name: /合成原件.pdf/ });
    attachment.focus();
    fireEvent.click(attachment);
    const reader = await screen.findByLabelText('合成PDF阅读器');
    const ownClose = within(reader).getByRole('button', { name: '收起阅读' });
    ownClose.focus();
    expect(document.activeElement).toBe(ownClose);
    if (state === 'removed') attachment.remove();
    else attachment.setAttribute(state, '');
    fireEvent.click(ownClose);
    expect(document.activeElement).toBe(document.body);
    expect(screen.getByLabelText('首页预览').hidden).toBe(true);
    expect(reader.isConnected).toBe(false);
  },
);

it('ignores an old reader close after selecting a new conversation or a later preview owner', async () => {
  const record = run('stale-close');
  const { material } = fixture([record]);
  render(<Home />);
  const history = await selectRecord(record);
  const attachment = within(history).getByRole('button', { name: /合成原件.pdf/ });
  attachment.focus();
  fireEvent.click(attachment);
  await screen.findByLabelText('合成PDF阅读器');
  const oldClose = readerActions.close;
  expect(oldClose).toBeTypeOf('function');
  const answer = within(history).getByRole('button', { name: '预览回答' });
  answer.focus();
  fireEvent.click(answer);
  const output = await screen.findByLabelText('回答预览');
  act(() => oldClose?.());
  expect(document.activeElement).toBe(answer);
  expect(screen.getByLabelText('回答预览')).toBe(output);
  fireEvent.click(screen.getByRole('button', { name: '新对话' }));
  const input = screen.getByLabelText('Agent 工作目标');
  expect(document.activeElement).toBe(input);
  act(() => oldClose?.());
  expect(document.activeElement).toBe(input);
  expect(screen.getByLabelText('首页预览').hidden).toBe(true);
  expect(screen.queryByLabelText('合成PDF阅读器')).toBeNull();
  expect(readCount(material)).toBe(1);
});
