import { lazy, Suspense, useState, type ReactNode } from 'react';
import type { MaterialController } from './useMaterials';
const PdfReader = lazy(() => import('./PdfReader'));
export function validatePdfFile(file: Pick<File, 'name' | 'size'>): string | null {
  if (!/\.pdf$/i.test(file.name)) return '当前仅支持 PDF，请选择 PDF 文件。';
  if (!file.size || file.size > 20 * 1024 * 1024) return '请选择非空且不超过 20 MB 的 PDF。';
  return null;
}
const labels = {
  imported: '已保存 · 待提取文字',
  processing: '正在处理',
  ready: '文字可用',
  needs_ocr: '扫描页待识别',
  cancelled: '已取消 · 可继续',
  interrupted: '上次中断 · 可继续',
  failed: '处理失败 · 可重试',
};
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
        <span>拖入 PDF · 每份 ≤20 MB / 200页 · 本地处理</span>
        {c.items.length > 0 && c.canNewHome && (
          <button type="button" disabled={disabled || c.busy} onClick={() => void c.newHome()}>
            新一组材料
          </button>
        )}
      </div>
      {c.error && (
        <p role="alert" className="material-error">
          {c.error}
        </p>
      )}
      {c.staged && (
        <div className="material-staged">
          <strong>{c.staged.name}</strong>
          <span>待导入 · {(c.staged.bytes / 1024).toFixed(0)} KB</span>
          <button type="button" disabled={disabled || c.busy} onClick={() => void c.commit()}>
            导入并保存
          </button>
          <button type="button" disabled={disabled || c.busy} onClick={() => void c.discard()}>
            取消导入
          </button>
        </div>
      )}
      {c.items.length > 0 && (
        <ul className="material-cards" aria-label="本次材料">
          {c.items.map((item) => (
            <li key={item.id} className="material-saved-card">
              <div className="material-card-heading">
                <button
                  type="button"
                  className="material-card-open"
                  onClick={() => void c.read(item)}
                >
                  <span className="material-file-icon">PDF</span>
                  <span>
                    <strong>{item.name}</strong>
                    <small>
                      {item.status === 'ready' &&
                      item.pages.some((page) => page.origin === 'ocr_candidate')
                        ? 'OCR 已完成 · 待核对'
                        : labels[item.status]}{' '}
                      · {item.pages.length}/{item.page_count}页
                    </small>
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={`恢复原件 ${item.name}`}
                  disabled={c.busy || disabled}
                  onClick={() => void c.restore(item)}
                >
                  恢复
                </button>
              </div>
              <div className="material-card-actions">
                <label>
                  <input
                    type="checkbox"
                    aria-label={`纳入分析 ${item.name}`}
                    checked={item.id in c.selected}
                    disabled={disabled || c.busy}
                    onChange={(e) => c.select(item.id, e.target.checked)}
                  />
                  纳入分析
                </label>
                {item.id in c.selected && (
                  <input
                    aria-label={`页范围 ${item.name}`}
                    placeholder="全部页，如 1-3,5"
                    value={c.selected[item.id]}
                    disabled={disabled || c.busy}
                    onChange={(e) => c.range(item.id, e.target.value)}
                  />
                )}
                {item.status === 'processing' ? (
                  <button type="button" disabled={c.busy} onClick={() => void c.cancel(item)}>
                    取消处理
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={c.busy || disabled}
                    onClick={() => void c.process(item, true)}
                  >
                    本地 OCR
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {c.items.length > 0 && (
        <p className="material-notice">
          原件已保存在本机。勾选材料并预览后才发送文字；OCR 结果需核对。未选材料不进入 AI。
        </p>
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
