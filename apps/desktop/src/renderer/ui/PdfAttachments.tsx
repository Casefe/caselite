import { lazy, Suspense, useState, type ReactNode } from 'react';
import type { MaterialController } from './useMaterials';
const PdfReader = lazy(() => import('./PdfReader'));
export function validatePdfFile(file: Pick<File, 'name' | 'size'>): string | null {
  if (!/\.pdf$/i.test(file.name)) return '当前仅支持 PDF，请选择 PDF 文件。';
  if (!file.size || file.size > 20 * 1024 * 1024) return '请选择非空且不超过 20 MB 的 PDF。';
  return null;
}
export default function PdfAttachments({
  children,
  disabled = false,
  controller: c,
}: {
  children: ReactNode;
  disabled?: boolean;
  controller: MaterialController;
}) {
  const [over, setOver] = useState(false);
  return (
    <div
      className={`material-composer${over ? ' material-drag-over' : ''}`}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) {
          event.preventDefault();
          if (!disabled) setOver(true);
        }
      }}
      onDragLeave={(event) => {
        if (
          !(event.relatedTarget instanceof Node) ||
          !event.currentTarget.contains(event.relatedTarget)
        )
          setOver(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        if (disabled || c.busy) return;
        const files = event.dataTransfer.files;
        if (files.length !== 1) {
          c.errorMessage('每次添加一份 PDF，可多次添加。');
          return;
        }
        const error = validatePdfFile(files[0]);
        if (error) c.errorMessage(error);
        else void c.add(files[0]);
      }}
    >
      {over && <div className="material-drop-hint">松开以添加 PDF</div>}
      {children}
      <div className="material-controls">
        <button
          type="button"
          disabled={disabled || c.busy || !c.available}
          onClick={() => void c.add()}
        >
          ＋ 文件
        </button>
        <span>拖入 PDF · 自动处理 · 每份 ≤20 MB / 200 页</span>
      </div>
      {c.busy && (
        <div className="material-staged" role="status">
          <span className="material-file-icon">PDF</span>
          <strong>{c.uploadingName ?? '正在添加附件'}</strong>
          <span>正在准备，可继续输入并发送…</span>
        </div>
      )}
      {c.staged && !c.busy && (
        <div className="material-staged">
          <strong>{c.staged.name}</strong>
          <span>上次附件尚未完成</span>
          <button type="button" disabled={disabled} onClick={() => void c.retry()}>
            继续添加
          </button>
          <button type="button" disabled={disabled} onClick={() => void c.discard()}>
            移除
          </button>
        </div>
      )}
      {c.error && (
        <div role="alert" className="material-error">
          {c.error}
          {!c.busy && (
            <>
              <button type="button" disabled={disabled} onClick={() => void c.retry()}>
                重试附件
              </button>
              <button type="button" disabled={disabled} onClick={() => void c.discard()}>
                移除未完成附件
              </button>
            </>
          )}
        </div>
      )}
      {Object.keys(c.selected).length > 0 && (
        <ul className="material-cards" aria-label="待发送附件">
          {c.items
            .filter((item) => item.id in c.selected)
            .map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="material-card-open"
                  onClick={() => void c.readReference(item.id, item.task_id, item.name)}
                >
                  <span className="material-file-icon">PDF</span>
                  <span>
                    <strong>{item.name}</strong>
                    <small>{item.page_count} 页 · 将随本轮要求分析</small>
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={`移除附件 ${item.name}`}
                  disabled={disabled}
                  onClick={() => c.select(item.id, false)}
                >
                  ×
                </button>
              </li>
            ))}
        </ul>
      )}
      {c.items.some((item) => !(item.id in c.selected)) && (
        <details className="material-library">
          <summary>已保存材料</summary>
          {c.items
            .filter((item) => !(item.id in c.selected))
            .map((item) => (
              <div key={item.id}>
                <button
                  type="button"
                  onClick={() => void c.readReference(item.id, item.task_id, item.name)}
                >
                  {item.name}
                </button>
                <button type="button" disabled={disabled} onClick={() => c.select(item.id, true)}>
                  添加到本轮
                </button>
              </div>
            ))}
        </details>
      )}
      {c.reading && (
        <Suspense fallback={<p>正在加载阅读器…</p>}>
          <PdfReader
            key={c.reading.id}
            name={c.reading.name}
            bytes={c.reading.bytes}
            textPages={c.items.find((item) => item.id === c.reading?.id)?.pages}
            onClose={c.clearReading}
          />
        </Suspense>
      )}
    </div>
  );
}
