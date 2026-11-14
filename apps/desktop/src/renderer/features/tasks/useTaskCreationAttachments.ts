import { useCallback, useRef, useState } from 'react';
import type { CreationAttachmentDraft, MaterialRequest } from '../../../preload/caselite-api';

export function useTaskCreationAttachments() {
  const [draft, setDraft] = useState<CreationAttachmentDraft | null>(null);
  const current = useRef<CreationAttachmentDraft | null>(null);
  const working = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [recovered, setRecovered] = useState(false);
  const [ready, setReady] = useState(true);
  const available = typeof window.caselite?.material === 'function';
  const accept = useCallback((value: CreationAttachmentDraft | null) => {
    current.current = value;
    setDraft(value);
  }, []);
  async function command(request: MaterialRequest) {
    const result = await window.caselite.material(request);
    if (!result.ok) throw Error(result.message);
    if (result.creation_draft !== undefined) accept(result.creation_draft);
    if (result.creation_warning) setError(result.creation_warning);
    return result;
  }
  async function run(work: () => Promise<boolean>) {
    if (working.current) return false;
    working.current = true;
    setBusy(true);
    setError('');
    try {
      return await work();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '附件操作未完成，请核对原提交。');
      return false;
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  return {
    draft,
    ready,
    busy,
    error,
    recovered,
    available,
    resume() {
      if (!available) {
        accept(null);
        setRecovered(false);
        setReady(true);
        return Promise.resolve(true);
      }
      setReady(false);
      return run(async () => {
        const result = await command({
          protocol_version: 1,
          operation: 'creation_resume',
          scope: 'home',
        });
        setRecovered(Boolean(result.creation_draft));
        setReady(true);
        return true;
      });
    },
    async pick() {
      return run(async () => {
        if (!current.current)
          await command({
            protocol_version: 1,
            operation: 'creation_open',
            scope: crypto.randomUUID(),
          });
        const value = current.current;
        if (!value || value.state !== 'open') throw Error('上次任务已创建，请先继续保存附件。');
        const result = await window.caselite.pickPdf(value.id);
        if (!result.ok) throw Error(result.message);
        if (result.creation_draft) accept(result.creation_draft);
        return true;
      });
    },
    async remove(token: string) {
      return run(async () => {
        if (!current.current) return false;
        await command({
          protocol_version: 1,
          operation: 'creation_remove',
          scope: current.current.id,
          token,
        });
        return true;
      });
    },
    async discard() {
      return run(async () => {
        if (current.current)
          await command({
            protocol_version: 1,
            operation: 'creation_discard',
            scope: current.current.id,
          });
        accept(null);
        return true;
      });
    },
    async save(taskId: string) {
      return run(async () => {
        const id = current.current?.id;
        if (!id) return true;
        await command({ protocol_version: 1, operation: 'creation_read', scope: id });
        await command({
          protocol_version: 1,
          operation: 'creation_bind',
          scope: id,
          task_id: taskId,
        });
        const value = current.current!;
        for (const file of value.files) {
          if (file.saved) continue;
          // 任务身份与 token 在失败后保持，继续保存只重放原附件提交。
          const result = await window.caselite.material({
            protocol_version: 1,
            operation: 'commit',
            scope: taskId,
            token: file.token,
          });
          if (!result.ok)
            throw Error(`任务已创建，附件“${file.name}”未确认保存：${result.message}`);
          await command({ protocol_version: 1, operation: 'creation_read', scope: id });
        }
        await command({ protocol_version: 1, operation: 'creation_finish', scope: id });
        accept(null);
        return true;
      });
    },
  };
}
export type TaskCreationAttachmentController = ReturnType<typeof useTaskCreationAttachments>;
