import { useCallback, useEffect, useRef, useState } from 'react';
import type { CatalogRequest, CatalogResponse } from '../../preload/caselite-api';
type Success = Extract<CatalogResponse, { ok: true }>;
export const catalogMutation = <T extends object>(input: T) => ({
  ...input,
  protocol_version: 1 as const,
  request_id: crypto.randomUUID(),
  idempotency_key: crypto.randomUUID(),
});
export function useCatalog() {
  const [data, setData] = useState<Success | null>(null),
    [error, setError] = useState(''),
    [pending, setPending] = useState(false),
    [unknown, setUnknown] = useState(false);
  const alive = useRef(true),
    locked = useRef(false),
    submission = useRef<CatalogRequest | null>(null);
  const completion = useRef<((result: Success) => void | Promise<void>) | undefined>(undefined),
    generation = useRef(0);
  const load = useCallback(async () => {
    const current = ++generation.current;
    try {
      const r = await window.caselite.catalog({ operation: 'list', protocol_version: 1 });
      if (alive.current && current === generation.current) {
        if (r.ok) {
          setData(r);
          setError('');
        } else setError(r.message);
      }
    } catch {
      if (alive.current && current === generation.current) setError('无法读取本地目录，请重试。');
    }
  }, []);
  useEffect(() => {
    alive.current = true;
    queueMicrotask(() => void load());
    return () => {
      alive.current = false;
    };
  }, [load]);
  const execute = async (
    request: CatalogRequest,
    onSuccess?: (result: Success) => void | Promise<void>,
    queryFirst = false,
  ): Promise<CatalogResponse | null> => {
    if (locked.current) return null;
    locked.current = true;
    submission.current = request;
    completion.current = onSuccess;
    generation.current++;
    setPending(true);
    setError('');
    try {
      let r = await window.caselite.catalog(
        queryFirst && 'idempotency_key' in request
          ? { operation: 'status', protocol_version: 1, idempotency_key: request.idempotency_key }
          : request,
      );
      // 结果未知先查原键；仅明确未落盘时重试原请求，不生成新身份。
      if (queryFirst && !r.ok && r.code === 'NOT_FOUND') r = await window.caselite.catalog(request);
      if (!alive.current) return null;
      if (r.ok) {
        setUnknown(false);
        submission.current = null;
        await load();
        if (alive.current) await onSuccess?.(r);
        return r;
      }
      setError(r.message);
      setUnknown(r.code === 'RESULT_UNKNOWN' || r.code === 'UNAVAILABLE');
      if (r.code !== 'RESULT_UNKNOWN' && r.code !== 'UNAVAILABLE') submission.current = null;
      return r;
    } catch {
      if (alive.current) {
        setError('提交结果未知，请核对原提交。');
        setUnknown(true);
      }
      return null;
    } finally {
      locked.current = false;
      if (alive.current) setPending(false);
    }
  };
  return {
    data,
    error,
    pending,
    unknown,
    load,
    execute,
    retry: () =>
      submission.current
        ? execute(submission.current, completion.current, true)
        : Promise.resolve(null),
  };
}
