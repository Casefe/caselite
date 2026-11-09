import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense, useContext, useRef, useState } from 'react';
import type {
  Task,
  TaskRequest,
  TaskResponse,
  DeliveryExport,
  DeliveryExportFormat,
} from '../../../../preload/caselite-api';
import { mutation } from '../../../shared/data/taskCommand';
import { useLocalPreferences } from '../../../shared/data/LocalPreferences';
import { EditorSettingsNavigation } from '../../../shared/navigation/EditorSettingsNavigation';
const PdfReader = lazy(() => import('../../../ui/PdfReader'));
import type { DeliveryResult } from './DeliveryVersions';

type Request = Extract<TaskRequest, { operation: 'export_snapshot' }>;
export function useSnapshotExport(
  task: Task,
  snapshot: string | null,
  format: DeliveryExportFormat,
) {
  const label = format === 'pdf' ? 'PDF' : 'Word';
  const preferences = useLocalPreferences();
  const supportsStyle = Boolean(window.caselite.exportStyleDefaults);
  const canGenerate =
    !supportsStyle || (preferences.ready && !preferences.pending && preferences.phase === 'idle');
  const style = preferences.ready
    ? (preferences.preferences.export_style ?? window.caselite.exportStyleDefaults)
    : undefined;
  const openSettings = useContext(EditorSettingsNavigation);
  const styleKey = JSON.stringify(style);
  const [selected, setSelected] = useState<{
    snapshot: string;
    format: DeliveryExportFormat;
    id: string;
    styleKey: string | undefined;
  } | null>(null);
  const [preview, setPreview] = useState<{
    snapshot: string;
    id: string;
    bytes: Uint8Array;
  } | null>(null);
  const [generating, setGenerating] = useState(false),
    [cancelling, setCancelling] = useState(false);
  const [writing, setWriting] = useState(false),
    [phase, setPhase] = useState<'idle' | 'verify' | 'retry'>('idle');
  const [feedback, setFeedback] = useState<{
    snapshot: string;
    format: DeliveryExportFormat;
    value: DeliveryResult;
  } | null>(null);
  const pending = useRef<Request | null>(null),
    lock = useRef(false);
  const scope = { protocol_version: 1 as const, task_id: task.id, document_id: task.document_id };
  const query = useQuery({
    queryKey: ['snapshot-export', task.id, task.document_id, snapshot, format, style],
    enabled: !!snapshot && (!supportsStyle || preferences.ready),
    staleTime: 0,
    gcTime: 0,
    queryFn: async () => {
      if (!snapshot) throw new Error('Missing snapshot');
      let result = await window.caselite.task({
        ...scope,
        operation: 'read_export',
        snapshot_id: snapshot,
        format,
        ...(style ? { export_style: style } : {}),
        include_history: true,
      });
      let notice = '';
      if (!result.ok && result.code === 'INVALID_REQUEST' && style) {
        notice = result.message;
        result = await window.caselite.task({
          ...scope,
          operation: 'read_export',
          snapshot_id: snapshot,
          format,
          include_history: true,
        });
      }
      if (
        !result.ok ||
        !result.exports ||
        [...result.exports, ...(result.export_history ?? [])].some(
          (r) => r.snapshot_id !== snapshot || r.format !== format,
        )
      )
        throw new Error(`${label} read failed`);
      return {
        current: notice ? null : (result.exports[0] ?? null),
        history: result.export_history ?? result.exports,
        notice,
      };
    },
  });
  const record = query.isError
    ? null
    : selected?.snapshot === snapshot &&
        selected.format === format &&
        selected.styleKey === styleKey
      ? (query.data?.history.find((row) => row.id === selected.id) ?? query.data?.current)
      : query.data?.current;
  async function start(mode: 'create' | 'verify' | 'retry' = 'create') {
    if (lock.current || (mode === 'create' && (!snapshot || !canGenerate))) return;
    if (mode === 'create') {
      if (pending.current) return;
      pending.current = {
        ...mutation(),
        ...scope,
        operation: 'export_snapshot',
        snapshot_id: snapshot!,
        format,
        ...(style ? { export_style: structuredClone(style) } : {}),
      };
    }
    const request = pending.current;
    if (!request) return;
    const display = (kind: DeliveryResult['kind'], message: string) =>
      setFeedback({
        snapshot: request.snapshot_id,
        format: request.format,
        value: { kind, message },
      });
    lock.current = true;
    setWriting(true);
    setGenerating(mode !== 'verify');
    try {
      let checking = mode === 'verify';
      let response: TaskResponse = await window.caselite.task(
        checking
          ? { protocol_version: 1, operation: 'status', idempotency_key: request.idempotency_key }
          : request,
      );
      if (!response.ok && response.code === 'RESULT_UNKNOWN') {
        checking = true;
        response = await window.caselite.task({
          protocol_version: 1,
          operation: 'status',
          idempotency_key: request.idempotency_key,
        });
      }
      if (!response.ok) {
        if (response.code === 'RESULT_UNKNOWN' || response.code === 'READ_FAILED') {
          setPhase('verify');
          display('error', `${label}保存结果尚不确定，请核对原提交。`);
        } else if (
          response.code === 'WRITE_FAILED' ||
          (checking && response.code === 'NOT_FOUND')
        ) {
          setPhase('retry');
          display('error', `未确认${label}保存成功，可使用原提交重试。`);
        } else {
          pending.current = null;
          setPhase('idle');
          display(response.code === 'CANCELLED' ? 'cancelled' : 'error', response.message);
        }
        return;
      }
      const row = response.exports?.[0];
      if (
        response.receipt !== request.idempotency_key ||
        row?.snapshot_id !== request.snapshot_id ||
        row.format !== request.format ||
        row.status !== 'ready' ||
        !row.sha256
      )
        throw new Error(`${label} receipt mismatch`);
      pending.current = null;
      setSelected({
        snapshot: request.snapshot_id,
        format: request.format,
        id: row.id,
        styleKey: JSON.stringify(request.export_style),
      });
      setGenerating(false);
      setPhase('idle');
      display(
        'success',
        response.export_created
          ? `${label}草稿已保存。可打开独立工作副本。`
          : `沿用已保存${label}，未重复生成。`,
      );
      // 已拿到原回执，刷新失败只重读，绝不重新执行生成命令。
      try {
        const refreshed = await query.refetch();
        if (refreshed.isError)
          display('error', `${label}已保存；读取失败，请重新读取${label}，勿重新生成。`);
      } catch {
        display('error', `${label}已保存；读取失败，请重新读取${label}。`);
      }
    } catch {
      setPhase('verify');
      display('error', `无法确认${label}结果，请核对原提交。`);
    } finally {
      lock.current = false;
      setWriting(false);
      setGenerating(false);
    }
  }
  async function open(row: DeliveryExport, save = false) {
    if (lock.current || !snapshot) return;
    lock.current = true;
    setWriting(true);
    try {
      const r = await window.caselite.task({
        ...scope,
        operation: save ? 'save_export' : 'open_export',
        format,
        snapshot_id: snapshot,
        export_id: row.id,
      });
      setFeedback({
        snapshot,
        format,
        value:
          r.ok && (save ? r.export_saved : r.export_opened)
            ? {
                kind: 'success',
                message: save
                  ? `${label}副本已另存。受管产物保持不变。`
                  : `已交给系统应用打开${label}工作副本；外部编辑不回写固定版本。`,
              }
            : {
                kind: r.ok && save ? 'cancelled' : 'error',
                message: r.ok
                  ? save
                    ? '已取消另存，受管产物和已有目标保持不变。'
                    : '工作副本尚未打开。'
                  : r.message,
              },
      });
    } catch {
      setFeedback({
        snapshot,
        format,
        value: {
          kind: 'error',
          message: `无法确认系统是否打开${label}；已生成文件保留，请检查关联应用。`,
        },
      });
    } finally {
      lock.current = false;
      setWriting(false);
    }
  }
  async function showPreview(row: DeliveryExport) {
    if (lock.current || !snapshot) return;
    lock.current = true;
    setWriting(true);
    try {
      const response = await window.caselite.task({
        ...scope,
        operation: 'preview_export',
        format: 'pdf',
        snapshot_id: snapshot,
        export_id: row.id,
      });
      if (
        !response.ok ||
        response.exports?.[0].id !== row.id ||
        response.exports[0].sha256 !== row.sha256 ||
        !response.export_data ||
        response.export_data.length !== row.bytes
      )
        throw new Error('Preview mismatch');
      const digest = Array.from(
        new Uint8Array(await crypto.subtle.digest('SHA-256', response.export_data.slice().buffer)),
      )
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      if (digest !== row.sha256) throw new Error('Preview hash mismatch');
      setPreview({ snapshot, id: row.id, bytes: response.export_data });
    } catch {
      setFeedback({
        snapshot,
        format,
        value: { kind: 'error', message: '无法读取或校验最终 PDF，已有产物保持不变；请重新读取。' },
      });
    } finally {
      lock.current = false;
      setWriting(false);
    }
  }
  async function cancel() {
    const request = pending.current;
    if (!request || cancelling) return;
    setCancelling(true);
    try {
      const r = await window.caselite.task({
        protocol_version: 1,
        task_id: request.task_id,
        document_id: request.document_id,
        operation: 'cancel_export',
        snapshot_id: request.snapshot_id,
        idempotency_key: request.idempotency_key,
      });
      if (!writing && !r.ok && r.code === 'CANCELLED') {
        pending.current = null;
        setPhase('idle');
        setFeedback({
          snapshot: request.snapshot_id,
          format: request.format,
          value: { kind: 'cancelled', message: r.message },
        });
      } else if (!writing && r.ok && r.receipt === request.idempotency_key) void start('verify');
    } catch {
      if (!writing) setPhase('verify');
      setFeedback({
        snapshot: request.snapshot_id,
        format: request.format,
        value: { kind: 'error', message: `无法确认${label}取消结果，请核对原提交。` },
      });
    } finally {
      setCancelling(false);
    }
  }
  return {
    canGenerate,
    busy: writing || phase !== 'idle' || cancelling,
    result: feedback?.snapshot === snapshot && feedback.format === format ? feedback.value : null,
    start,
    controls: (
      <div className="delivery-word-controls">
        <p>{label}以草稿生成；打开的是独立工作副本，外部修改不会回写。</p>
        {supportsStyle && !preferences.ready && (
          <p role={preferences.error ? 'alert' : 'status'}>
            {preferences.error || '正在读取已保存导出设置…'}
            {!preferences.pending && (
              <button type="button" onClick={() => void preferences.reload()}>
                重新读取导出设置
              </button>
            )}
          </p>
        )}
        {style && (
          <p>
            下一次导出：{style.paper} · {style.font === 'pingfang' ? '苹方' : 'Arial Unicode MS'} ·{' '}
            {style.font_size} pt · 页边距 {Object.values(style.margins).join(' / ')} mm
          </p>
        )}
        {openSettings && (
          <button type="button" disabled={writing || phase !== 'idle'} onClick={openSettings}>
            设置导出样式
          </button>
        )}
        {query.data?.notice && <p role="alert">{query.data.notice} 可继续查看已有产物。</p>}
        {!!query.data?.history.length && (
          <label>
            已保存产物
            <select
              aria-label={`已保存${label}产物`}
              disabled={writing || phase !== 'idle'}
              value={record?.id ?? ''}
              onChange={(e) => {
                setPreview(null);
                setSelected(
                  e.target.value && snapshot
                    ? { snapshot, format, id: e.target.value, styleKey }
                    : null,
                );
              }}
            >
              <option value="">当前样式（尚无产物时留空）</option>
              {query.data.history.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.created_at} ·{' '}
                  {row.configuration
                    ? `${row.configuration.style.paper} / ${row.configuration.style.font_size} pt`
                    : '原有样式'}{' '}
                  · {row.status === 'ready' ? '已保存' : '待确认'}
                </option>
              ))}
            </select>
          </label>
        )}

        {query.isError && <p role="alert">{label}记录读取失败，请重新读取；不会自动生成。</p>}
        <button
          type="button"
          disabled={writing || phase !== 'idle'}
          onClick={() => void query.refetch()}
        >
          重新读取{label}
        </button>
        {phase !== 'idle' && (
          <button type="button" disabled={writing} onClick={() => void start(phase)}>
            {phase === 'verify' ? `核对${label}保存结果` : `使用原提交重试${label}`}
          </button>
        )}
        {phase === 'retry' && (
          <button
            type="button"
            disabled={writing}
            onClick={() => {
              pending.current = null;
              setPhase('idle');
            }}
          >
            结束本次尝试
          </button>
        )}
        {(generating || phase === 'verify') && (
          <button type="button" disabled={cancelling} onClick={() => void cancel()}>
            取消{label}生成
          </button>
        )}
        {record?.status === 'ready' && (
          <>
            {format === 'pdf' && (
              <button
                type="button"
                disabled={writing || phase !== 'idle'}
                onClick={() => void showPreview(record)}
              >
                预览最终 PDF
              </button>
            )}
            <button
              type="button"
              disabled={writing || phase !== 'idle'}
              onClick={() => void open(record)}
            >
              打开{label}工作副本
            </button>
            <button
              type="button"
              disabled={writing || phase !== 'idle'}
              onClick={() => void open(record, true)}
            >
              另存{label}副本…
            </button>
            <p>
              <span>
                快照 {snapshot} · {label}
              </span>
              <br />
              输出摘要：{record.sha256} · {record.bytes} 字节
            </p>
            {record.converter === 'electron-45.1.0-pdf-v1' && (
              <p>这是早期 PDF；重新导出可改善文字复制兼容性，旧文件保留。</p>
            )}
          </>
        )}
        {format === 'pdf' && preview?.snapshot === snapshot && preview.id === record?.id && (
          <Suspense fallback={<p>正在加载 PDF 阅读器…</p>}>
            <PdfReader
              key={preview.id}
              bytes={preview.bytes}
              name="最终 PDF · 草稿"
              onClose={() => setPreview(null)}
            />
          </Suspense>
        )}
        {record?.status === 'pending' && (
          <p>此版本导出尚未确认完成，可核对原提交或恢复同一产物。</p>
        )}
      </div>
    ),
  };
}
