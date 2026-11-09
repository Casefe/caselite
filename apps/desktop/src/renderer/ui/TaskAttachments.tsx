import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { DocxOriginalReader } from './DocxOriginalReader';
import { isDocx, useMaterials } from './useMaterials';
import ImportantDates from '../features/calendar/ImportantDates';
import type { Task } from '../../preload/caselite-api';

const PdfReader = lazy(() => import('./PdfReader'));
const statuses = {
  imported: '原件已保存',
  processing: '正在本地处理',
  ready: '正文已提取',
  needs_ocr: '待识别',
  cancelled: '处理已取消',
  interrupted: '处理已中断',
  failed: '处理失败，原件保留',
};

export default function TaskAttachments({
  taskId,
  disabled = false,
  task,
  onDateBlocked,
  onTaskChanged,
}: {
  taskId: string;
  disabled?: boolean;
  task?: Task;
  onDateBlocked?(value: boolean): void;
  onTaskChanged?(task: Task, state: number[] | null): void;
}) {
  // 属性栏只消费材料，不把导入或阅读动作变成 AI 选材授权。
  const c = useMaterials(taskId, true, false);
  const [selected, setSelected] = useState<string | null>(null);
  const reader = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const reading = c.reading;
  const current = reading && c.items.find((item) => item.id === reading.id);
  const material = current ?? reading?.material;
  useEffect(() => {
    if (!reading || !reader.current) return;
    const dialog = reader.current;
    const focus = document.activeElement;
    const fallback = trigger.current;
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
      if (focus instanceof HTMLElement && focus.isConnected) focus.focus();
      else fallback?.focus();
    };
  }, [reading]);
  const open = (id: string) => {
    const item = c.items.find((value) => value.id === id && value.task_id === taskId);
    if (item) void c.readReference(item.id, taskId, item.name);
  };
  return (
    <section className="task-attachments" aria-label="任务附件">
      <header>
        <h3>
          附件 <small>{c.items.length || ''}</small>
        </h3>
        <button
          ref={trigger}
          type="button"
          disabled={disabled || !c.available || c.busy || Boolean(c.staged)}
          onClick={() => void c.add()}
          title="添加 PDF 或 DOCX，每份不超过 20 MB"
        >
          添加附件
        </button>
      </header>
      {task && onDateBlocked && onTaskChanged && (
        <ImportantDates
          key={task.id}
          task={task}
          disabled={disabled}
          onBlocked={onDateBlocked}
          onChanged={onTaskChanged}
        />
      )}
      {!c.available ? (
        <p>当前环境暂不可读取附件。</p>
      ) : !c.loaded && !c.readError ? (
        <p>正在读取附件…</p>
      ) : (
        !c.items.length && <p>暂无附件 · PDF / DOCX</p>
      )}
      {c.items.length > 0 && (
        <ul aria-label="已保存任务附件">
          {c.items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                aria-pressed={selected === item.id}
                onClick={() => setSelected(item.id)}
                onDoubleClick={() => open(item.id)}
                onKeyDown={(event) => {
                  if (
                    event.key === 'Enter' &&
                    !event.repeat &&
                    !event.nativeEvent.isComposing &&
                    event.nativeEvent.keyCode !== 229
                  ) {
                    event.preventDefault();
                    setSelected(item.id);
                    open(item.id);
                  }
                }}
                title={`${item.name}\n固定来源版本 ${item.id}\n资产版本 ${item.asset_version_id}\nSHA-256 ${item.sha256}`}
              >
                <span className="task-attachment-format">{isDocx(item.name) ? 'DOCX' : 'PDF'}</span>
                <span className="task-attachment-label">
                  <strong>{item.name}</strong>
                  <small>
                    固定版本 {item.sha256.slice(0, 8)} · {statuses[item.status]}
                  </small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {c.busy && <p role="status">正在保存{c.uploadingName ? ` ${c.uploadingName}` : '附件'}…</p>}
      {c.staged && !c.busy && (
        <div className="task-attachment-recovery">
          <p>未完成：{c.staged.name}</p>
          <button disabled={disabled} onClick={() => void c.retry()}>
            {c.staged.restore_source_id ? '重试恢复' : '继续导入'}
          </button>
          <button disabled={disabled} onClick={() => void c.discard()}>
            取消未完成导入
          </button>
        </div>
      )}
      {(c.error || c.readError) && <p role="alert">{c.error || c.readError}</p>}
      {c.error && !c.staged && selected && !c.readPending && (
        <button onClick={() => open(selected)}>重试打开附件</button>
      )}
      {c.readPending && (
        <p role="status">
          正在打开附件… <button onClick={c.clearReading}>取消打开</button>
        </p>
      )}
      {reading && (
        <dialog
          ref={reader}
          className="material-reader-dialog"
          aria-label="任务附件原件"
          onCancel={(event) => {
            event.preventDefault();
            c.clearReading();
          }}
        >
          {isDocx(reading.name) ? (
            <DocxOriginalReader
              name={reading.name}
              material={material}
              onClose={c.clearReading}
              onSaveOriginal={() => void c.saveOriginal(reading.id, taskId)}
            >
              {c.copyError && <p role="alert">{c.copyError}</p>}
              {material && material.status !== 'ready' && (
                <button
                  disabled={disabled || c.busy}
                  onClick={() =>
                    void (material.status === 'processing'
                      ? c.stopLocalText(material)
                      : c.localText(material))
                  }
                >
                  {material.status === 'processing' ? '停止提取' : '提取文字（离线）'}
                </button>
              )}
            </DocxOriginalReader>
          ) : (
            <Suspense fallback={<p>正在加载阅读器…</p>}>
              <PdfReader
                key={reading.id}
                name={reading.name}
                bytes={reading.bytes}
                textPages={material?.pages}
                onClose={c.clearReading}
              />
            </Suspense>
          )}
        </dialog>
      )}
    </section>
  );
}
