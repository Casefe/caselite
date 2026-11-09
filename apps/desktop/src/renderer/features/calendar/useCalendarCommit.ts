import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { TaskRequest, TaskResponse } from '../../../preload/caselite-api';
import { invalidateCalendar } from './calendar-query';
type Command = Extract<TaskRequest, { operation: 'update_calendar' | 'set_calendar_type' }>;
type Success = Extract<TaskResponse, { ok: true }>;
export function useCalendarCommit(confirm: (command: Command) => Promise<void>) {
  const client = useQueryClient(),
    alive = useRef(true),
    running = useRef(false),
    original = useRef<Command | null>(null);
  const [pending, setPending] = useState(false),
    [phase, setPhase] = useState<'idle' | 'unknown' | 'write' | 'read'>('idle'),
    [error, setError] = useState('');
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function run(next?: Command) {
    if (running.current) return;
    const request = original.current ?? next;
    if (!request) return;
    const recovering = !!original.current;
    original.current = request;
    running.current = true;
    setPending(true);
    setError('');
    let stage: 'unknown' | 'write' | 'read' = 'unknown';
    try {
      if (phase !== 'read') {
        let checkingOriginal = recovering;
        let response = await window.caselite.task(
          recovering
            ? { protocol_version: 1, operation: 'status', idempotency_key: request.idempotency_key }
            : request,
        );
        // 只有用户触发恢复且原键明确不存在时，才重发原请求；迟到ACK不能产生第二键。
        if (recovering && !response.ok && response.code === 'NOT_FOUND') {
          checkingOriginal = false;
          response = await window.caselite.task(request);
        }
        if (!alive.current) return;
        if (!response.ok) {
          // 查询失败不能证明原写入失败，必须保留原键和未知锁。
          // 只有初次写入或原键明确不存在后同键重发的已知失败，才允许放弃输入。
          stage =
            checkingOriginal ||
            response.code === 'RESULT_UNKNOWN' ||
            response.code === 'READ_FAILED'
              ? 'unknown'
              : 'write';
          throw Error(response.message);
        }
        const r: Success = response;
        if (r.receipt !== request.idempotency_key) throw Error('回执身份不一致，请核对原提交。');
        if (request.operation === 'update_calendar') {
          const saved = r.tasks.find((t) => t.id === request.task_id);
          if (
            !saved ||
            saved.version !== request.expected_version + 1 ||
            JSON.stringify(saved.calendar) !== JSON.stringify(request.calendar)
          )
            throw Error('任务回执与日历输入不一致，请核对原提交。');
        } else {
          const saved = r.calendar_types?.find((t) => t.id === request.type.id);
          if (
            !saved ||
            saved.version !== request.type.version + 1 ||
            saved.name !== request.type.name ||
            saved.enabled !== request.type.enabled ||
            saved.show_home !== request.type.show_home
          )
            throw Error('类型回执不一致，请核对原提交。');
        }
      }
      stage = 'read';
      await confirm(request);
      if (!alive.current) return;
      original.current = null;
      setPhase('idle');
      invalidateCalendar(client);
    } catch (e) {
      if (alive.current) {
        setError(e instanceof Error ? e.message : '日历保存未确认，请保留输入。');
        setPhase(stage);
      }
    } finally {
      running.current = false;
      if (alive.current) setPending(false);
    }
  }
  function clear() {
    if (running.current || phase === 'unknown') return false;
    original.current = null;
    setPhase('idle');
    setError('');
    return true;
  }
  return {
    pending,
    phase,
    error,
    locked: pending || phase !== 'idle',
    save: run,
    recover: () => run(),
    clear,
  };
}
