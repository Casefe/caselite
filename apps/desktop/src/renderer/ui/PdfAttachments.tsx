import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
const PdfReader = lazy(() => import('./PdfReader'));

type Attachment = { id: string; name: string; bytes: Uint8Array };
const MAX_BYTES = 20 * 1024 * 1024;

export function validatePdfFile(file: Pick<File, 'name' | 'size'>): string | null {
  if (!/\.pdf$/i.test(file.name)) return '当前仅支持 PDF，请选择 PDF 文件。';
  if (!file.size || file.size > MAX_BYTES) return '请选择非空且不超过 20 MB 的 PDF。';
  return null;
}

export default function PdfAttachments({
  children,
  disabled = false,
}: {
  children: ReactNode;
  disabled?: boolean;
}) {
  const picker = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const [items, setItems] = useState<Attachment[]>([]);
  const [reading, setReading] = useState<Attachment | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  async function add(files: FileList | File[]) {
    if (disabled || busy) return;
    if (files.length !== 1) {
      setError('每次添加一份 PDF，可多次添加。');
      return;
    }
    const file = files[0];
    const invalid = validatePdfFile(file);
    if (invalid) {
      setError(invalid);
      return;
    }
    const ticket = ++generation.current;
    setBusy(true);
    setError('');
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (ticket !== generation.current) return;
      if (new TextDecoder().decode(bytes.slice(0, 1024)).indexOf('%PDF-') < 0)
        throw new Error('INVALID_PDF');
      setItems((old) => [...old, { id: crypto.randomUUID(), name: file.name, bytes }]);
    } catch {
      if (ticket === generation.current) setError('无法读取 PDF，请检查文件后重试。');
    } finally {
      if (ticket === generation.current) setBusy(false);
    }
  }
  return (
    <div
      className={`material-composer${over ? ' material-drag-over' : ''}`}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) {
          event.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) setOver(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        void add(event.dataTransfer.files);
      }}
    >
      {over && <div className="material-drop-hint">松开以添加 PDF</div>}
      {children}
      <div className="material-controls">
        <button type="button" disabled={disabled || busy} onClick={() => picker.current?.click()}>
          ＋ 文件
        </button>
        <span>拖入 PDF · 每份不超过 20 MB</span>
        <input
          ref={picker}
          type="file"
          accept="application/pdf,.pdf"
          aria-label="选择 PDF 文件"
          hidden
          onChange={(event) => {
            if (event.target.files?.length) void add(event.target.files);
            event.target.value = '';
          }}
        />
        {busy && (
          <button
            type="button"
            onClick={() => {
              generation.current++;
              setBusy(false);
            }}
          >
            取消读取
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="material-error">
          {error}
        </p>
      )}
      {items.length > 0 && (
        <>
          <ul className="material-cards" aria-label="本次材料">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="material-card-open"
                  onClick={() => setReading(item)}
                >
                  <span className="material-file-icon">PDF</span>
                  <span>
                    <strong>{item.name}</strong>
                    <small>暂存 · 尚未保存或发送给 AI</small>
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={`移除 ${item.name}`}
                  onClick={() => {
                    setItems((old) => old.filter((entry) => entry.id !== item.id));
                    if (reading?.id === item.id) setReading(null);
                  }}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          <p className="material-notice">
            当前为附件交互增量：重开不保留暂存文件，AI 尚不读取附件。
          </p>
        </>
      )}
      {reading && (
        <Suspense fallback={<p>正在加载阅读器…</p>}>
          <PdfReader
            key={reading.id}
            name={reading.name}
            bytes={reading.bytes}
            onClose={() => setReading(null)}
          />
        </Suspense>
      )}
    </div>
  );
}
