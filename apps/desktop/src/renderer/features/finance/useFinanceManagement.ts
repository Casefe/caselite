import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import type { FinanceManagementRequest, FinanceManagementSuccess } from './types';

type Write = Exclude<
  FinanceManagementRequest,
  { operation: 'm_read' | 'm_status' | 'm_preview_allocation' }
>;
type Strip<T> = T extends unknown
  ? Omit<T, 'protocol_version' | 'request_id' | 'idempotency_key'>
  : never;
export type FinanceManagementDraft = Strip<Write>;
function matches(request: Write, result: FinanceManagementSuccess) {
  const proof = result.evidence,
    actual = result.effect;
  if (!proof || !actual || proof.operation !== request.operation) return false;
  if (request.operation === 'm_save_rule')
    return (
      actual.id === proof.target_id &&
      Object.entries(request.values).every(([key, value]) => actual[key] === value)
    );
  if (request.operation === 'm_set_default')
    return (
      actual.id === proof.target_id &&
      actual.default_rule_id === request.rule_id &&
      actual.version === request.expected_version + 1
    );
  if (actual.project_id !== request.project_id) return false;
  if (request.operation === 'm_prepare_source')
    return (
      actual.id === proof.target_id &&
      actual.sha256 === request.sha256 &&
      actual.page === request.page
    );
  if (request.operation === 'm_dismiss_candidate')
    return actual.id === request.candidate_id && actual.status === 'dismissed';
  if (
    'source' in request &&
    request.source &&
    actual.source_candidate_id !== request.source.candidate_id
  )
    return false;
  if (request.operation === 'm_bind_rule')
    return proof.target_id === request.project_id && actual.rule_id === request.rule_id;
  if (actual.id !== proof.target_id) return false;
  if (request.operation === 'm_reverse_expense')
    return proof.target_id === request.expense_id && typeof actual.reversed_at === 'string';
  if (request.operation === 'm_reverse_reimbursement')
    return proof.target_id === request.reimbursement_id && typeof actual.reversed_at === 'string';
  if (request.operation === 'm_reverse_payout')
    return proof.target_id === request.payout_id && typeof actual.reversed_at === 'string';
  if (request.operation === 'm_reverse_allocation')
    return proof.target_id === request.allocation_id && typeof actual.reversed_at === 'string';
  const ignored = new Set([
    'operation',
    'protocol_version',
    'request_id',
    'idempotency_key',
    'deductions_confirmed',
    'expected_preview_digest',
    'source',
  ]);
  return Object.entries(request).every(([key, value]) => ignored.has(key) || actual[key] === value);
}
export const financeManagementKey = ['finance', 'management'] as const;
export function useFinanceManagement() {
  const client = useQueryClient();
  const [pending, setPending] = useState<Write>();
  const [retry, setRetry] = useState(false);
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<Set<string>>(() => new Set());
  const dirty = drafts.size > 0;
  const markDirty = (scope = 'general') => setDrafts((current) => new Set(current).add(scope));
  const clearDirty = (scope: string) =>
    setDrafts((current) => {
      const next = new Set(current);
      next.delete(scope);
      return next;
    });
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const inFlight = useRef(false);
  const query = useQuery({
    queryKey: financeManagementKey,
    staleTime: 0,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const result = await window.caselite.finance({ protocol_version: 1, operation: 'm_read' });
      if (!result.ok || result.kind !== 'management')
        throw new Error(result.ok ? '无法核对财务设置。' : result.message);
      return result;
    },
  });
  async function process(request: Write, check = false): Promise<boolean> {
    if (inFlight.current) return false;
    inFlight.current = true;
    setBusy(true);
    setPending(request);
    setError('');
    setMessage('');
    setRetry(false);
    let resolved = false;
    try {
      let result = await window.caselite.finance(
        check
          ? { protocol_version: 1, operation: 'm_status', idempotency_key: request.idempotency_key }
          : { ...request, request_id: crypto.randomUUID() },
      );
      if (!result.ok) {
        resolved = !['UNAVAILABLE', 'RESULT_UNKNOWN'].includes(result.code);
        setError(result.message);
        return false;
      }
      if (result.kind !== 'management') {
        setError('无法核对财务操作回执。');
        return false;
      }
      if (check && !result.evidence) {
        setRetry(true);
        setMessage('未查到原提交，保留输入后可同键重试。');
        return false;
      }
      if (result.receipt !== request.idempotency_key || !matches(request, result)) {
        setError('回执与本次操作不匹配，请核对原提交。');
        return false;
      }
      if (
        'project_id' in request &&
        ['m_bind_rule'].includes(request.operation) &&
        result.evidence?.target_id !== request.project_id
      ) {
        setError('回执项目不匹配。');
        return false;
      }
      if (check) {
        result = await window.caselite.finance({ protocol_version: 1, operation: 'm_read' });
        if (!result.ok || result.kind !== 'management') {
          setError('已查到凭据，读取财务状态失败，请再次核对。');
          return false;
        }
      }
      client.setQueryData<FinanceManagementSuccess>(financeManagementKey, result);
      void client.invalidateQueries({ queryKey: ['finance', 'ledger'] });
      clearDirty(
        request.operation === 'm_bind_rule'
          ? `rule:${request.project_id}`
          : 'project_id' in request
            ? `${['m_prepare_source', 'm_dismiss_candidate'].includes(request.operation) ? 'intake' : 'entry'}:${request.project_id}`
            : 'general',
      );
      setMessage('已保存并读回财务记录。');
      resolved = true;
      return true;
    } catch {
      setError('无法确认保存结果，请核对原提交；不要重复记一笔。');
      return false;
    } finally {
      if (resolved) setPending(undefined);
      setBusy(false);
      inFlight.current = false;
    }
  }
  return {
    state: query.data?.state,
    loading: query.isPending,
    error: error || query.error?.message || '',
    message,
    pending,
    busy,
    dirty,
    blocked: !!pending || busy || dirty,
    markDirty,
    clearEntry: (projectId: string) => clearDirty(`entry:${projectId}`),
    discard: () => {
      if (!pending) {
        setDrafts(new Set());
        setError('');
        setMessage('');
      }
    },
    reload: () => query.refetch(),
    submit: (draft: FinanceManagementDraft) => {
      if (pending) return Promise.resolve(false);
      const request = {
        ...draft,
        protocol_version: 1 as const,
        request_id: crypto.randomUUID(),
        idempotency_key: crypto.randomUUID(),
      };
      // 与受控协议的首尾空白规范化一致，幂等输入和回执核对使用同一内容。
      if ('values' in request)
        request.values = {
          ...request.values,
          name: request.values.name.trim(),
          firm_name: request.values.firm_name.trim(),
        };
      if ('note' in request) request.note = request.note.trim();
      if ('description' in request) request.description = request.description.trim();
      if ('payee' in request) request.payee = request.payee.trim();
      if ('invoice_number' in request) request.invoice_number = request.invoice_number.trim();
      return process(request);
    },
    recover: () => (pending ? process(pending, !retry) : Promise.resolve(false)),
    retry,
  };
}
export type FinanceManagementController = ReturnType<typeof useFinanceManagement>;
