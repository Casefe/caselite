import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type {
  DeliverySnapshot,
  Task,
  TaskRequest,
  TaskResponse,
} from '../../../../preload/caselite-api';
import { DraftEditor } from '../../../editors/RichEditor';
import { mutation } from '../../../shared/data/taskCommand';
import DeliveryVersions, { type DeliveryResult } from './DeliveryVersions';
import { useSnapshotExport } from './useSnapshotExport';

type Create = Extract<TaskRequest, { operation: 'create_snapshot' }>;
type Phase = 'idle' | 'verify' | 'retry';
const queryBase = { protocol_version: 1 as const };

export default function DeliverySnapshots({
  task,
  revision,
  dirty,
  disabled,
  onBack,
  onBusy,
}: {
  task: Task;
  revision: number;
  dirty: boolean;
  disabled: boolean;
  onBack(): void;
  onBusy(value: boolean): void;
}) {
  const [format, setFormat] = useState<'Word' | 'PDF'>('Word');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [committed, setCommitted] = useState<DeliverySnapshot | null>(null);
  const [writing, setWriting] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<DeliveryResult | null>(null);
  const pending = useRef<Create | null>(null);
  const lock = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      onBusy(false);
    };
  }, [onBusy]);
  // 查询缓存只是投影；按Document和固定ID隔离，重开从宿主读取，不承担正文或回执权威。
  const list = useInfiniteQuery({
    queryKey: ['delivery-snapshots', task.id, task.document_id],
    initialPageParam: 0,
    staleTime: 0,
    gcTime: 0,
    queryFn: async ({ pageParam }) => {
      const response = await window.caselite.task({
        ...queryBase,
        operation: 'list_snapshots',
        task_id: task.id,
        document_id: task.document_id,
        offset: pageParam,
      });
      if (
        !response.ok ||
        !response.snapshots ||
        !response.page ||
        response.snapshots.some(
          (row) => row.task_id !== task.id || row.document_id !== task.document_id,
        )
      )
        throw new Error('Snapshot list unavailable');
      return { rows: response.snapshots, page: response.page };
    },
    getNextPageParam: (last) =>
      last.page.has_more ? last.page.offset + last.rows.length : undefined,
  });
  const rows = list.data?.pages.flatMap((page) => page.rows) ?? [];
  const knownVersions = committed
    ? [committed, ...rows.filter((row) => row.id !== committed.id)]
    : rows;
  const versions = list.isError ? [] : knownVersions;
  const currentId =
    selectedId && versions.some((row) => row.id === selectedId)
      ? selectedId
      : (versions[0]?.id ?? null);
  const word = useSnapshotExport(task, currentId, format === 'PDF' ? 'pdf' : 'docx');
  useEffect(() => {
    onBusy(writing || phase === 'verify' || word.busy);
  }, [writing, phase, word.busy, onBusy]);
  const fixedRead = useQuery({
    queryKey: ['delivery-snapshot-body', task.id, task.document_id, currentId],
    enabled: currentId !== null,
    staleTime: 0,
    gcTime: 0,
    queryFn: async () => {
      if (!currentId) throw new Error('No fixed snapshot selected');
      const response = await window.caselite.task({
        ...queryBase,
        operation: 'read_snapshot',
        task_id: task.id,
        document_id: task.document_id,
        snapshot_id: currentId,
      });
      if (
        !response.ok ||
        !response.state ||
        response.snapshots?.[0]?.id !== currentId ||
        response.snapshots[0].document_id !== task.document_id ||
        response.snapshots[0].task_id !== task.id
      )
        throw new Error('Fixed body unavailable');
      return { id: currentId, state: response.state };
    },
  });
  async function submit(kind: 'create' | 'verify' | 'retry', note = ''): Promise<boolean> {
    if (lock.current || word.busy || (kind === 'create' && disabled)) return false;
    if (kind === 'create') {
      if (pending.current || dirty || revision < 1 || !task.document_metadata_version) return false;
      pending.current = {
        ...mutation(),
        operation: 'create_snapshot',
        task_id: task.id,
        document_id: task.document_id,
        body_id: task.body_id,
        expected_revision: revision,
        expected_metadata_version: task.document_metadata_version,
        expected_task_version: task.version,
        note,
      };
    }
    const request = pending.current;
    if (!request) return false;
    lock.current = true;
    setWriting(true);
    let unresolved = false;
    try {
      let checkingReceipt = kind === 'verify';
      let response: TaskResponse = await window.caselite.task(
        checkingReceipt
          ? { ...queryBase, operation: 'status', idempotency_key: request.idempotency_key }
          : request,
      );
      // 等待超时不代表失败，先只读原键；只有明确查无回执后才允许用户同键重试。
      if (!response.ok && response.code === 'RESULT_UNKNOWN') {
        checkingReceipt = true;
        response = await window.caselite.task({
          ...queryBase,
          operation: 'status',
          idempotency_key: request.idempotency_key,
        });
      }
      if (!alive.current) return false;
      if (!response.ok) {
        if (response.code === 'RESULT_UNKNOWN' || response.code === 'READ_FAILED') {
          unresolved = true;
          setPhase('verify');
          setResult({ kind: 'error', message: '保存结果尚不确定，请核对原提交，暂不重新固定。' });
        } else if (
          response.code === 'WRITE_FAILED' ||
          (checkingReceipt && response.code === 'NOT_FOUND')
        ) {
          setPhase('retry');
          setResult({ kind: 'error', message: '未确认保存成功；原说明已保留，可用原提交重试。' });
        } else {
          pending.current = null;
          setPhase('idle');
          setResult({ kind: 'error', message: response.message });
        }
        return false;
      }
      const fixed = response.snapshots?.[0];
      if (
        response.receipt !== request.idempotency_key ||
        !fixed ||
        fixed.task_id !== task.id ||
        fixed.document_id !== task.document_id ||
        fixed.body_id !== task.body_id ||
        fixed.body_revision !== request.expected_revision
      )
        throw new Error('Snapshot receipt mismatch');
      pending.current = null;
      setPhase('idle');
      setCommitted(fixed);
      setSelectedId(fixed.id);
      setResult({
        kind: 'success',
        message:
          response.snapshot_created === false
            ? '此修订已固定，保留原版本与说明。'
            : '固定版本已保存到此设备。工作稿后续修改不会改变此版本。',
      });
      // 已确认提交后刷新失败只允许读，不能因刷新异常再次执行写入。
      try {
        await list.refetch({ throwOnError: true });
      } catch {
        // 保存已确认；查询错误由下方提示，不得重新进入写入错误恢复。
      }
      return true;
    } catch {
      if (alive.current) {
        unresolved = true;
        setPhase('verify');
        setResult({ kind: 'error', message: '保存结果尚不确定，请核对原提交。原说明已保留。' });
      }
      return false;
    } finally {
      lock.current = false;
      if (alive.current) {
        setWriting(false);
        void unresolved;
      }
    }
  }
  const selected = versions.find((item) => item.id === currentId);
  const alreadyFixed = knownVersions.some(
    (item) =>
      item.body_revision === revision &&
      item.metadata_version === task.document_metadata_version &&
      item.task_version === task.version,
  );
  const feedback: DeliveryResult | null =
    phase !== 'idle'
      ? result
      : list.isError
        ? {
            kind: 'error',
            message: committed
              ? '固定版本已保存；列表读取失败，请只重新读取，不必再次固定。'
              : '无法读取固定版本，请重新读取。已有内容保持不变。',
          }
        : fixedRead.isError
          ? { kind: 'error', message: '无法读取或校验此固定版本，未改用最新正文。请重新读取。' }
          : result;
  return (
    <div className="delivery-host">
      <link
        rel="stylesheet"
        href={new URL('../styles/delivery-versions.css', window.location.href).href}
      />
      <div className="delivery-saved-status">
        <span>固定版本保存在此设备 · 草稿</span>
        <button
          type="button"
          disabled={list.isFetching || writing || phase !== 'idle' || word.busy}
          onClick={() => {
            setResult(null);
            void list.refetch();
            if (currentId) void fixedRead.refetch();
          }}
        >
          重新读取固定版本
        </button>
        {phase !== 'idle' && (
          <button type="button" disabled={writing} onClick={() => void submit(phase)}>
            {phase === 'verify' ? '核对保存结果' : '使用原提交重试'}
          </button>
        )}
      </div>
      <DeliveryVersions
        noteDisabled={phase !== 'idle'}
        versions={versions.map((item) => ({
          id: item.id,
          documentId: item.document_id,
          revision: item.body_revision,
          title: item.title,
          note: item.note,
          createdAt: item.created_at,
        }))}
        selectedId={currentId}
        revision={revision}
        dirty={dirty}
        busy={list.isFetching || writing || phase === 'verify' || word.busy}
        result={word.result ?? feedback}
        captureDisabled={
          disabled ||
          list.isError ||
          phase !== 'idle' ||
          alreadyFixed ||
          !task.document_metadata_version
        }
        more={list.hasNextPage}
        onMore={() => void list.fetchNextPage()}
        onSelect={(id) => {
          setSelectedId(id);
          setResult(null);
        }}
        onCreate={(note) => submit('create', note)}
        onBack={onBack}
        exportAvailable={!fixedRead.isError && !!fixedRead.data && word.canGenerate}
        format={format}
        onFormatChange={setFormat}
        exportControls={word.controls}
        onExport={() => {
          void word.start();
        }}
        preview={
          fixedRead.isFetching ||
          fixedRead.isError ||
          !fixedRead.data ||
          fixedRead.data.id !== currentId ? (
            <p role="status">{fixedRead.isFetching ? '正在读取固定正文…' : '固定正文暂不可用。'}</p>
          ) : (
            <DraftEditor
              value={{ state: fixedRead.data.state, text: '' }}
              disabled
              readTables
              label="固定版本正文"
              onChange={() => {}}
            />
          )
        }
      />
      {selected && (
        <p className="delivery-content-hash">
          正文校验摘要：<code>{selected.content_sha256}</code> · 文档属性版本{' '}
          {selected.metadata_version}
        </p>
      )}
    </div>
  );
}
