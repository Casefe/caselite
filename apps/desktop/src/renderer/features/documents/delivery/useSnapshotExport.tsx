import { useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import type {
  Task,
  TaskRequest,
  TaskResponse,
  DeliveryExport,
  DeliveryExportFormat,
} from '../../../../preload/caselite-api';
import { mutation } from '../../../shared/data/taskCommand';
import type { DeliveryResult } from './DeliveryVersions';

type Request = Extract<TaskRequest, { operation: 'export_snapshot' }>;
export function useSnapshotExport(
  task: Task,
  snapshot: string | null,
  format: DeliveryExportFormat,
) {
  const label = format === 'pdf' ? 'PDF' : 'Word';
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
    queryKey: ['snapshot-export', task.id, task.document_id, snapshot, format],
    enabled: !!snapshot,
    staleTime: 0,
    gcTime: 0,
    queryFn: async () => {
      if (!snapshot) throw new Error('Missing snapshot');
      const result = await window.caselite.task({
        ...scope,
        operation: 'read_export',
        snapshot_id: snapshot,
        format,
      });
      if (
        !result.ok ||
        !result.exports ||
        result.exports.some((r) => r.snapshot_id !== snapshot || r.format !== format)
      )
        throw new Error(`${label} read failed`);
      return result.exports[0] ?? null;
    },
  });
  const record = query.isError ? null : query.data;
  async function start(mode: 'create' | 'verify' | 'retry' = 'create') {
    if (lock.current || (mode === 'create' && !snapshot)) return;
    if (mode === 'create') {
      if (pending.current) return;
      pending.current = {
        ...mutation(),
        ...scope,
        operation: 'export_snapshot',
        snapshot_id: snapshot!,
        format,
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
    busy: writing || phase !== 'idle' || cancelling,
    result: feedback?.snapshot === snapshot && feedback.format === format ? feedback.value : null,
    start,
    controls: (
      <div className="delivery-word-controls">
        <p>{label}以草稿生成；打开的是独立工作副本，外部修改不会回写。</p>
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
        {record?.status === 'pending' && (
          <p>此版本导出尚未确认完成，可核对原提交或恢复同一产物。</p>
        )}
      </div>
    ),
  };
}
