// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CatalogRequest, CatalogResponse, Matter } from '../../preload/caselite-api';
import ProjectCatalog from './ProjectCatalog';
vi.mock('../editors/RichEditor', () => ({
  emptyDraft: () => ({ text: '', state: null }),
  DraftEditor: ({
    value,
    onChange,
    label,
    disabled,
  }: {
    value: { text: string };
    onChange(v: { text: string; state: null }): void;
    label: string;
    disabled: boolean;
  }) => (
    <textarea
      aria-label={label}
      value={value.text}
      disabled={disabled}
      onChange={(e) => onChange({ text: e.target.value, state: null })}
    />
  ),
}));
afterEach(cleanup);
const project = (id = '11111111-1111-4111-8111-111111111111', title = 'A'): Matter => ({
  id,
  title,
  status: 'planned',
  version: 1,
  archived_at: null,
  body_id: crypto.randomUUID(),
  body_revision: 0,
  editor_schema: 1,
  updated_at: '2026-11-05',
  task_count: 0,
});
const response = (
  projects: Matter[],
  target: string | null = null,
): Extract<CatalogResponse, { ok: true }> => ({
  ok: true,
  projects,
  documents: [],
  state: null,
  target_id: target,
  receipt: null,
});
function show() {
  const changed = vi.fn();
  render(<ProjectCatalog tasks={[]} onOpen={vi.fn()} onDirty={vi.fn()} onChanged={changed} />);
  return changed;
}
describe('durable project UI receipts and target identity', () => {
  it('reconciles unknown create with the same identity and closes the create form once', async () => {
    const p = project();
    let rows: Matter[] = [];
    const sent: CatalogRequest[] = [];
    const catalog = vi.fn(async (r: CatalogRequest): Promise<CatalogResponse> => {
      if (r.operation === 'create_project') {
        sent.push(r);
        rows = [p];
        if (sent.length === 1) return { ok: false, code: 'RESULT_UNKNOWN', message: '结果未知' };
        return response(rows, p.id);
      }
      return response(rows);
    });
    window.caselite = { catalog } as unknown as Window['caselite'];
    const changed = show();
    await screen.findByText('暂无项目，独立任务仍可直接使用。');
    fireEvent.click(screen.getByText('创建项目'));
    fireEvent.change(screen.getByLabelText('项目名称'), { target: { value: 'A' } });
    fireEvent.click(screen.getByText('保存项目'));
    await screen.findByText('核对原提交');
    expect((screen.getByText('保存项目') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText('核对原提交'));
    await waitFor(() => expect(screen.queryByLabelText('项目名称')).toBeNull());
    expect(sent).toHaveLength(2);
    expect(sent[0]).toEqual(sent[1]);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('保存项目')).toBeNull();
  });
  it('reloads the edited version after an unknown update instead of reusing the stale editor', async () => {
    let p = project();
    let updates = 0;
    const versions: number[] = [];
    const catalog = vi.fn(async (r: CatalogRequest): Promise<CatalogResponse> => {
      if (r.operation === 'update_project') {
        versions.push(r.expected_version);
        updates++;
        if (updates === 1) {
          p = { ...p, title: r.title, version: 2 };
          return { ok: false, code: 'RESULT_UNKNOWN', message: '结果未知' };
        }
        if (updates > 2) p = { ...p, title: r.title, version: 3 };
      }
      return response([p], p.id);
    });
    window.caselite = { catalog } as unknown as Window['caselite'];
    show();
    await screen.findByText('打开项目');
    fireEvent.click(screen.getByText('打开项目'));
    await screen.findByLabelText('编辑项目名称');
    fireEvent.change(screen.getByLabelText('编辑项目名称'), { target: { value: 'B' } });
    fireEvent.click(screen.getByText('保存项目概述'));
    await screen.findByText('核对原提交');
    fireEvent.click(screen.getByText('核对原提交'));
    await waitFor(() =>
      expect((screen.getByLabelText('编辑项目名称') as HTMLInputElement).value).toBe('B'),
    );
    await waitFor(() =>
      expect((screen.getByText('保存项目概述') as HTMLButtonElement).disabled).toBe(true),
    );
    fireEvent.change(screen.getByLabelText('编辑项目名称'), { target: { value: 'C' } });
    fireEvent.click(screen.getByText('保存项目概述'));
    await waitFor(() => expect(versions).toEqual([1, 1, 2]));
  });
  it('drops a delayed initial list after a newer post-commit list has arrived', async () => {
    let resolveOld: (r: CatalogResponse) => void = () => {};
    const old = new Promise<CatalogResponse>((r) => {
      resolveOld = r;
    });
    let reads = 0;
    const p = project();
    const catalog = vi.fn(async (r: CatalogRequest): Promise<CatalogResponse> =>
      r.operation === 'list' && ++reads === 1 ? old : response([p], p.id),
    );
    window.caselite = { catalog } as unknown as Window['caselite'];
    show();
    await waitFor(() => expect(reads).toBe(1));
    fireEvent.click(screen.getByText('创建项目'));
    fireEvent.change(screen.getByLabelText('项目名称'), { target: { value: 'A' } });
    fireEvent.click(screen.getByText('保存项目'));
    await screen.findByText('打开项目');
    await act(async () => {
      resolveOld(response([]));
      await old;
    });
    expect(screen.queryByText('暂无项目，独立任务仍可直接使用。')).toBeNull();
    expect(screen.getByText('打开项目')).toBeTruthy();
  });
  it('closes the archived editor and keeps properties on the visible target', async () => {
    let rows = [project(), project('22222222-2222-4222-8222-222222222222', 'B')];
    const catalog = vi.fn(async (r: CatalogRequest): Promise<CatalogResponse> => {
      if (r.operation === 'archive_project')
        rows = rows.map((p) =>
          p.id === r.id ? { ...p, archived_at: '2026-11-05', version: 2 } : p,
        );
      return response(rows, 'id' in r ? r.id : null);
    });
    window.caselite = { catalog } as unknown as Window['caselite'];
    show();
    await screen.findByText('打开项目');
    fireEvent.click(screen.getByText('打开项目'));
    await screen.findByLabelText('编辑项目名称');
    fireEvent.click(screen.getByText('归档项目'));
    await waitFor(() => expect(screen.queryByLabelText('编辑项目名称')).toBeNull());
    expect(screen.getByRole('heading', { name: 'B' })).toBeTruthy();
  });
  it('discards unsaved input when reloading the same stored version', async () => {
    const p = project();
    window.caselite = {
      catalog: vi.fn(async () => response([p], p.id)),
    } as unknown as Window['caselite'];
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    show();
    await screen.findByText('打开项目');
    fireEvent.click(screen.getByText('打开项目'));
    await screen.findByLabelText('编辑项目名称');
    fireEvent.change(screen.getByLabelText('编辑项目名称'), { target: { value: '未保存B' } });
    fireEvent.click(screen.getByText('放弃修改并重读'));
    await waitFor(() =>
      expect((screen.getByLabelText('编辑项目名称') as HTMLInputElement).value).toBe('A'),
    );
    expect((screen.getByText('返回项目列表') as HTMLButtonElement).disabled).toBe(false);
    vi.restoreAllMocks();
  });
});
