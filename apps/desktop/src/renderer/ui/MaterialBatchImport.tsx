import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type {
  MaterialBatch,
  MaterialBatchRequest,
  MaterialScope,
} from '../../preload/caselite-api';
import { materialSize } from './material-size';

export default function MaterialBatchImport({
  scope,
  mode,
  onRequested,
  onSelect,
  disabled = false,
}: {
  scope: MaterialScope;
  mode: 'files' | 'folder' | null;
  onRequested(): void;
  onSelect?(ids: string[]): void;
  disabled?: boolean;
}) {
  const [batch, setBatch] = useState<MaterialBatch | null>(null);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const context = useRef<MaterialScope | null>(scope);
  const generation = useRef(0);
  const picking = useRef(false);
  const available = typeof window.caselite?.materialBatch === 'function';
  useLayoutEffect(() => {
    const pendingGeneration = generation;
    context.current = scope;
    return () => {
      context.current = null;
      pendingGeneration.current++;
    };
  }, [scope]);
  const command = useCallback(async (request: MaterialBatchRequest) => {
    const sequence = ++generation.current;
    setError('');
    const result = await window.caselite.materialBatch(request);
    if (context.current !== request.scope || sequence !== generation.current) return;
    if (result.ok) setBatch(result.batch);
    else setError(result.message);
    return result;
  }, []);
  useEffect(() => {
    if (!available) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      const sequence = generation.current;
      try {
        const result = await window.caselite.materialBatch({
          protocol_version: 1,
          operation: 'list',
          scope,
        });
        if (stopped || sequence !== generation.current) return;
        if (result.ok) setBatch(result.batch);
        else setError(result.message);
      } catch {
        if (!stopped) setError('批次暂不可读取，请重试。');
      } finally {
        if (!stopped) timer = setTimeout(() => void poll(), 500);
      }
    }
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [scope, available]);
  useEffect(() => {
    if (!mode || picking.current || !available) return;
    picking.current = true;
    setWorking(true);
    onRequested();
    void command({ protocol_version: 1, operation: 'pick', scope, mode }).finally(() => {
      picking.current = false;
      setWorking(false);
    });
    // mode只表示本次用户点击；不把重新渲染或轮询变成再次打开选择器。
  }, [mode, scope, available, command, onRequested]);
  if (!available) return null;
  const running = batch?.state === 'running';
  const saved = batch?.items.filter((item) => item.state === 'saved') ?? [];
  const unfinished =
    batch?.items.filter((item) => ['pending', 'staged', 'failed'].includes(item.state)) ?? [];
  const act = async (operation: 'run' | 'pause' | 'discard' | 'dismiss') => {
    if (!batch) return;
    if (operation !== 'pause') setWorking(true);
    try {
      await command({ protocol_version: 1, operation, scope, batch_id: batch.id });
      window.dispatchEvent(new Event('caselite:material-task-saved'));
    } finally {
      if (operation !== 'pause') setWorking(false);
    }
  };
  return (
    <section className="material-batch" aria-label="材料批次">
      {working && !batch && <p role="status">正在读取所选材料范围…</p>}
      {error && (
        <p role="alert">
          {error}{' '}
          <button
            type="button"
            onClick={() => void command({ protocol_version: 1, operation: 'list', scope })}
          >
            重新读取批次
          </button>
        </p>
      )}
      {batch && (
        <>
          <header>
            <strong>{batch.title}</strong>
            <span>
              {batch.items.length} 项 · 已保存 {saved.length} 项
            </span>
          </header>
          <p>仅保存到当前材料任务。每批最多16项，PDF / DOCX每份20 MB以内；保存不会发送给模型。</p>
          <ul aria-label="批次逐项结果">
            {batch.items.map((item) => (
              <li key={item.token}>
                <span>
                  <strong>{item.relative_name}</strong>
                  <small>
                    {materialSize(item.bytes)} · {item.message}
                  </small>
                </span>
                <span>
                  {
                    {
                      pending: '待保存',
                      staged: '待确认保存',
                      saved: '已保存',
                      failed: '未完成',
                      skipped: '已跳过',
                      cancelled: '已移除',
                    }[item.state]
                  }
                </span>
              </li>
            ))}
          </ul>
          <div className="material-batch-actions">
            {running ? (
              <button type="button" disabled={disabled} onClick={() => void act('pause')}>
                暂停后续导入
              </button>
            ) : (
              unfinished.length > 0 && (
                <button
                  type="button"
                  disabled={disabled || working}
                  onClick={() => void act('run')}
                >
                  {saved.length || batch.state === 'paused' ? '继续保存未完成项' : '保存本批材料'}
                </button>
              )
            )}
            {onSelect && saved.length > 0 && (
              <button
                type="button"
                disabled={disabled || working || running}
                onClick={() => onSelect(saved.map((item) => item.token))}
              >
                将已保存材料加入本轮
              </button>
            )}
            {!running && (
              <button
                type="button"
                disabled={disabled || working}
                onClick={() => void act(unfinished.length ? 'discard' : 'dismiss')}
              >
                {unfinished.length ? '移除未完成项，保留已保存材料' : '收起清单'}
              </button>
            )}
          </div>
          {batch.state === 'paused' && (
            <p>批次尚未全部保存。继续时仅核对未完成项；重启后尚未暂存的文件需要重新选择。</p>
          )}
        </>
      )}
    </section>
  );
}
