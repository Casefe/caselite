import { useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import type {
  Task,
  TaskRequest,
  TaskResponse,
  DeliveryExport,
} from '../../../../preload/caselite-api';
import { mutation } from '../../../shared/data/taskCommand';
import type { DeliveryResult } from './DeliveryVersions';

type Request = Extract<TaskRequest, { operation: 'export_snapshot' }>;
export function useSnapshotWord(task: Task, snapshot: string | null) {
  const [writing, setWriting] = useState(false),
    [phase, setPhase] = useState<'idle' | 'verify' | 'retry'>('idle');
  const [feedback, setFeedback] = useState<{ snapshot: string; value: DeliveryResult } | null>(
    null,
  );
  const pending = useRef<Request | null>(null),
    lock = useRef(false);
  const scope = { protocol_version: 1 as const, task_id: task.id, document_id: task.document_id };
  const query = useQuery({
    queryKey: ['snapshot-word', task.id, task.document_id, snapshot],
    enabled: !!snapshot,
    staleTime: 0,
    gcTime: 0,
    queryFn: async () => {
      if (!snapshot) throw new Error('Missing snapshot');
      const result = await window.caselite.task({
        ...scope,
        operation: 'read_export',
        snapshot_id: snapshot,
      });
      if (!result.ok || !result.exports || result.exports.some((r) => r.snapshot_id !== snapshot))
        throw new Error('Word read failed');
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
        format: 'docx',
      };
    }
    const request = pending.current;
    if (!request) return;
    const display = (kind: DeliveryResult['kind'], message: string) =>
      setFeedback({ snapshot: request.snapshot_id, value: { kind, message } });
    lock.current = true;
    setWriting(true);
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
          display('error', 'Word保存结果尚不确定，请核对原提交。');
        } else if (
          response.code === 'WRITE_FAILED' ||
          (checking && response.code === 'NOT_FOUND')
        ) {
          setPhase('retry');
          display('error', '未确认Word保存成功，可使用原提交重试。');
        } else {
          pending.current = null;
          setPhase('idle');
          display('error', response.message);
        }
        return;
      }
      const row = response.exports?.[0];
      if (
        response.receipt !== request.idempotency_key ||
        row?.snapshot_id !== request.snapshot_id ||
        row.status !== 'ready' ||
        !row.sha256
      )
        throw new Error('Word receipt mismatch');
      pending.current = null;
      setPhase('idle');
      display(
        'success',
        response.export_created
          ? 'Word草稿已保存。可打开独立工作副本。'
          : '沿用已保存Word，未重复生成。',
      );
      // 已拿到原回执，刷新失败只重读，绝不重新执行生成命令。
      try {
        const refreshed = await query.refetch();
        if (refreshed.isError)
          display('error', 'Word已保存；读取失败，请重新读取Word，勿重新生成。');
      } catch {
        display('error', 'Word已保存；读取失败，请重新读取Word。');
      }
    } catch {
      setPhase('verify');
      display('error', '无法确认Word结果，请核对原提交。');
    } finally {
      lock.current = false;
      setWriting(false);
    }
  }
  async function open(row: DeliveryExport) {
    if (lock.current || !snapshot) return;
    lock.current = true;
    setWriting(true);
    try {
      const r = await window.caselite.task({
        ...scope,
        operation: 'open_export',
        snapshot_id: snapshot,
        export_id: row.id,
      });
      setFeedback({
        snapshot,
        value:
          r.ok && r.export_opened
            ? {
                kind: 'success',
                message: '已交给系统应用打开Word工作副本；外部编辑不回写固定版本。',
              }
            : { kind: 'error', message: r.ok ? '工作副本尚未打开。' : r.message },
      });
    } catch {
      setFeedback({
        snapshot,
        value: {
          kind: 'error',
          message: '无法确认系统是否打开Word；已生成文件保留，请检查关联应用。',
        },
      });
    } finally {
      lock.current = false;
      setWriting(false);
    }
  }
  return {
    busy: writing || phase !== 'idle',
    result: feedback?.snapshot === snapshot ? feedback.value : null,
    start,
    controls: (
      <div className="delivery-word-controls">
        <p>PDF 导出尚未接入。Word以草稿生成；打开的是独立工作副本，外部修改不会回写。</p>
        {query.isError && <p role="alert">Word记录读取失败，请重新读取；不会自动生成。</p>}
        <button
          type="button"
          disabled={writing || phase !== 'idle'}
          onClick={() => void query.refetch()}
        >
          重新读取Word
        </button>
        {phase !== 'idle' && (
          <button type="button" disabled={writing} onClick={() => void start(phase)}>
            {phase === 'verify' ? '核对Word保存结果' : '使用原提交重试Word'}
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
        {record?.status === 'ready' && (
          <>
            <button
              type="button"
              disabled={writing || phase !== 'idle'}
              onClick={() => void open(record)}
            >
              打开Word工作副本
            </button>
            <p>
              输出摘要：{record.sha256} · {record.bytes} 字节
            </p>
          </>
        )}
        {record?.status === 'pending' && (
          <p>此版本导出尚未确认完成，可核对原提交或恢复同一产物。</p>
        )}
      </div>
    ),
  };
}
