import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { Material } from '../../preload/caselite-api';
const PdfReader = lazy(() => import('../ui/PdfReader'));
const states: Record<Material['status'], string> = {
  imported: '原件已保存',
  processing: '提取中',
  ready: '文字已就绪',
  needs_ocr: '待识别',
  cancelled: '提取已取消',
  interrupted: '提取已中断',
  failed: '提取失败',
};
export default function ProjectFiles({
  projectId,
  disabled,
}: {
  projectId: string;
  disabled: boolean;
}) {
  const [data, setData] = useState<Material[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState('name');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Material | null>(null);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const epoch = useRef(0);
  const load = useCallback(
    async (source?: Material) => {
      const request = ++epoch.current;
      setBusy(true);
      setError('');
      setBytes(null);
      if (source) setSelected(source);
      else setSelected(null);
      try {
        const r = await window.caselite.material(
          source
            ? {
                protocol_version: 1,
                operation: 'read_project',
                project_id: projectId,
                source_id: source.id,
              }
            : { protocol_version: 1, operation: 'list_project', project_id: projectId },
        );
        if (request !== epoch.current) return;
        if (!r.ok) {
          setError(r.message);
          return;
        }
        setData(r.materials);
        if (source && r.data) setBytes(r.data);
      } catch {
        if (request === epoch.current) setError('无法读取项目文件，请重试。已保存的原件保留。');
      } finally {
        if (request === epoch.current) setBusy(false);
      }
    },
    [projectId],
  );
  useEffect(() => {
    let active = true;
    const guard = epoch;
    void Promise.resolve().then(() => {
      if (active) void load();
    });
    return () => {
      active = false;
      guard.current++;
    };
  }, [load]);
  const filtered = (data ?? [])
    .filter(
      (m) =>
        m.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) &&
        (!status || m.status === status),
    )
    .sort((a, b) =>
      sort === 'size'
        ? b.bytes - a.bytes || a.id.localeCompare(b.id)
        : a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
    );
  const pages = Math.max(1, Math.ceil(filtered.length / 20));
  const current = Math.min(page, pages - 1);
  return (
    <div className="project-files">
      <div className="project-query-toolbar">
        <input
          type="search"
          aria-label="搜索项目文件"
          placeholder="搜索文件名称…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(0);
          }}
        />
        <select
          aria-label="文件处理状态"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(0);
          }}
        >
          <option value="">全部处理状态</option>
          {Object.entries(states).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          aria-label="文件排序"
          value={sort}
          onChange={(e) => {
            setSort(e.target.value);
            setPage(0);
          }}
        >
          <option value="name">名称排序</option>
          <option value="size">大小排序</option>
        </select>
        <button disabled={busy || disabled} onClick={() => void load()}>
          重新读取文件
        </button>
      </div>
      <p className="caption">PDF · 仅本项目任务的受管原件 · 处理状态不影响已保存字节</p>
      {busy && <p role="status">正在读取文件…</p>}
      {error && (
        <div role="alert">
          <p>{error}</p>
          <button disabled={busy || disabled} onClick={() => void load(selected ?? undefined)}>
            重试读取
          </button>
        </div>
      )}
      {data && (
        <>
          <table className="catalog-table">
            <thead>
              <tr>
                <th>文件名</th>
                <th>类型</th>
                <th>原件</th>
                <th>文字处理</th>
                <th>固定版本</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(current * 20, current * 20 + 20).map((m) => (
                <tr key={m.id} data-source-id={m.id} aria-selected={selected?.id === m.id}>
                  <td>
                    <button disabled={disabled || busy} onClick={() => void load(m)}>
                      {m.name}
                    </button>
                    <small>
                      {Math.ceil(m.bytes / 1024)} KB · {m.page_count} 页
                    </small>
                  </td>
                  <td>PDF</td>
                  <td>本地已保存</td>
                  <td>{states[m.status]}</td>
                  <td>
                    <code title={m.id}>{m.id.slice(0, 8)}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filtered.length && (
            <p>
              {data.length
                ? '没有符合筛选条件的文件。'
                : '项目还没有已登记材料，请在任务中添加 PDF。'}
            </p>
          )}
          <div className="project-query-toolbar">
            <span>
              {filtered.length} 份 · 第 {current + 1} / {pages} 页
            </span>
            <button disabled={!current} onClick={() => setPage(current - 1)}>
              上一页文件
            </button>
            <button disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}>
              下一页文件
            </button>
          </div>
        </>
      )}
      {selected && bytes && (
        <Suspense fallback={<p>正在打开阅读器…</p>}>
          <PdfReader
            key={selected.id}
            bytes={bytes}
            name={selected.name}
            textPages={selected.pages}
            onClose={() => {
              epoch.current++;
              setBytes(null);
              setSelected(null);
            }}
          />
        </Suspense>
      )}
    </div>
  );
}
