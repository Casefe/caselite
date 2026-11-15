import { useEffect, useRef, useState } from 'react';
import type { CatalogRequest } from '../../../preload/caselite-api';
import { mutation } from '../../shared/data/taskCommand';

type CreateRequest = Extract<CatalogRequest, { operation: 'create_document' }>;

export default function DocumentCreateDialog({
  onCreated,
  onCancel,
}: {
  onCreated(id: string): Promise<void>;
  onCancel(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const pending = useRef<CreateRequest | null>(null);
  const created = useRef<string | null>(null);
  const working = useRef(false);
  const composing = useRef(false);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const modal = dialog.current;
    const previous = document.activeElement;
    modal?.showModal();
    modal?.querySelector('input')?.focus();
    const guard = (event: BeforeUnloadEvent) => {
      if (pending.current || working.current) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', guard);
    return () => {
      modal?.close();
      window.removeEventListener('beforeunload', guard);
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  const cancel = () => {
    if (
      !working.current &&
      !pending.current &&
      !created.current &&
      (!title.trim() || window.confirm('放弃尚未创建的文档？'))
    )
      onCancel();
  };
  async function submit() {
    if (
      working.current ||
      composing.current ||
      (!pending.current &&
        !created.current &&
        (!title.trim() || title.trim().length > 160 || title.includes('\0')))
    )
      return;
    working.current = true;
    setBusy(true);
    setError('');
    try {
      if (!created.current) {
        const retry = !!pending.current;
        const request = pending.current ?? {
          ...mutation(),
          operation: 'create_document',
          title: title.trim(),
        };
        pending.current = request;
        setUncertain(true);
        let source: 'status' | 'create' = retry ? 'status' : 'create';
        const status = {
          protocol_version: 1 as const,
          operation: 'status' as const,
          idempotency_key: request.idempotency_key,
        };
        let result = await window.caselite.catalog(retry ? status : request);
        if (retry && !result.ok && result.code === 'NOT_FOUND') {
          source = 'create';
          result = await window.caselite.catalog(request);
        }
        if (!result.ok && result.code === 'RESULT_UNKNOWN') {
          source = 'status';
          result = await window.caselite.catalog(status);
        }
        if (!result.ok) {
          if (source === 'create' && result.code === 'INVALID_REQUEST') {
            pending.current = null;
            setUncertain(false);
          }
          throw new Error(result.message);
        }
        const document = result.documents.find((item) => item.id === result.target_id);
        if (
          result.receipt !== request.idempotency_key ||
          document?.owner_kind !== 'personal' ||
          document.task_id !== null ||
          document.matter_id !== null ||
          document.body_revision !== 1 ||
          document.editor_schema !== 1 ||
          document.title !== request.title
        )
          throw new Error('创建回执不一致，请保留输入并核对原提交。');
        created.current = document.id;
        pending.current = null;
      }
      // 回执只是当时的提交结果；父级按稳定 ID 重读目录与当前正文。
      await onCreated(created.current);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '创建结果尚未确认，请核对原提交。');
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="project-create-dialog document-create-dialog"
      aria-labelledby="document-create-title"
      onCancel={(event) => {
        event.preventDefault();
        cancel();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
        }}
      >
        <header>
          <h2 id="document-create-title">新建文档</h2>
          <button
            type="button"
            aria-label="关闭新建文档"
            disabled={busy || uncertain}
            onClick={cancel}
          >
            ×
          </button>
        </header>
        <div className="project-create-content">
          <label>
            文档名称
            <input
              autoComplete="off"
              aria-label="文档名称"
              value={title}
              maxLength={160}
              required
              disabled={busy || uncertain}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <p className="caption">创建独立工作稿，正文自动保存到此设备。</p>
          {error && <p role="alert">{error}</p>}
        </div>
        <footer>
          <button type="button" disabled={busy || uncertain} onClick={cancel}>
            取消
          </button>
          <button
            className="primary"
            type="submit"
            disabled={busy || (!uncertain && !title.trim())}
          >
            {busy ? '处理中…' : uncertain ? '核对并打开文档' : '创建文档'}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
