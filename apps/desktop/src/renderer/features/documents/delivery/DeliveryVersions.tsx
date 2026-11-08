import { useState, type ReactNode } from 'react';
import { Icon } from '../../../shared/ui/Icon';

// 视图只消费固定版本，不回读“最新正文”。持久化和导出由各自 Application Owner 接入。
export type DeliveryVersion = {
  id: string;
  documentId: string;
  revision: number;
  title: string;
  note: string;
  createdAt: string;
};
export type DeliveryFormat = 'Word' | 'PDF';
export type DeliveryResult = { kind: 'success' | 'cancelled' | 'error'; message: string };

export default function DeliveryVersions({
  versions,
  selectedId,
  revision,
  dirty,
  busy,
  result,
  onSelect,
  onCreate,
  onExport,
  onBack,
  preview,
}: {
  versions: DeliveryVersion[];
  selectedId: string | null;
  revision: number;
  dirty: boolean;
  busy: boolean;
  result: DeliveryResult | null;
  onSelect(id: string): void;
  onCreate(note: string): Promise<boolean>;
  onExport(id: string, format: DeliveryFormat): void;
  onBack(): void;
  preview: ReactNode;
}) {
  const [note, setNote] = useState('');
  const [format, setFormat] = useState<DeliveryFormat>('Word');
  const [showPreview, setShowPreview] = useState(false);
  const selected = versions.find((item) => item.id === selectedId);
  const [creating, setCreating] = useState(false);
  async function create() {
    if (dirty || busy || creating || revision < 1) return;
    setCreating(true);
    try {
      if (await onCreate(note.trim())) setNote('');
    } finally {
      setCreating(false);
    }
  }
  return (
    <section className="delivery-versions" aria-label="交付版本">
      <header className="delivery-heading">
        <button type="button" onClick={onBack} disabled={busy || creating}>
          <Icon name="back" size={16} /> 返回工作稿
        </button>
        <div>
          <h1>交付版本</h1>
          <p>固定一个已保存修订，后续编辑保留在工作稿中。</p>
        </div>
        <span className="delivery-draft-badge">草稿 · 未经法律核验</span>
      </header>
      <form
        className="delivery-capture"
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <div>
          <strong>当前工作稿 · 修订 {revision}</strong>
          <p>{dirty ? '有未保存修改，请先返回工作稿保存。' : '可从此已保存修订建立固定版本。'}</p>
        </div>
        <label>
          <span>版本说明</span>
          <input
            value={note}
            maxLength={200}
            disabled={busy || creating}
            onChange={(event) => setNote(event.target.value)}
            placeholder="例如：付款期限核对稿"
          />
        </label>
        <button
          className="primary"
          type="submit"
          disabled={dirty || busy || creating || revision < 1}
        >
          {creating ? '正在固定…' : '固定当前修订'}
        </button>
      </form>
      <div className={`delivery-grid ${showPreview ? 'is-preview' : ''}`}>
        <aside className="delivery-history" aria-label="固定版本列表">
          <h2>
            固定版本 <span>{versions.length}</span>
          </h2>
          {!versions.length && (
            <p className="delivery-empty">还没有固定版本。先核对工作稿，再固定当前修订。</p>
          )}
          {versions.map((item) => (
            <button
              key={item.id}
              type="button"
              className="delivery-version-row"
              aria-pressed={item.id === selectedId}
              disabled={busy || creating}
              onClick={() => {
                onSelect(item.id);
                setShowPreview(true);
              }}
            >
              <Icon name="file" size={17} />
              <span>
                <strong>
                  修订 {item.revision} <small>草稿</small>
                </strong>
                <span>{item.note || '未填写说明'}</span>
                <time dateTime={item.createdAt}>
                  {new Date(item.createdAt).toLocaleString('zh-CN')}
                </time>
              </span>
              <Icon name="chevron" size={14} />
            </button>
          ))}
        </aside>
        <section className="delivery-detail" aria-label="固定版本预览">
          {selected ? (
            <>
              <button
                type="button"
                className="delivery-mobile-back"
                disabled={busy}
                onClick={() => setShowPreview(false)}
              >
                <Icon name="back" size={15} /> 返回版本列表
              </button>
              <header>
                <div>
                  <p>固定版本 · 修订 {selected.revision}</p>
                  <h2>{selected.title}</h2>
                </div>
                <span className="delivery-draft-badge">草稿</span>
              </header>
              <div className="delivery-preview" key={selected.id}>
                {preview}
              </div>
              <footer className="delivery-export">
                <div role="group" aria-label="导出格式">
                  {(['Word', 'PDF'] as const).map((value) => (
                    <button
                      type="button"
                      key={value}
                      aria-pressed={format === value}
                      disabled={busy}
                      onClick={() => setFormat(value)}
                    >
                      {value}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="primary"
                  disabled={busy || creating}
                  onClick={() => onExport(selected.id, format)}
                >
                  {busy ? '正在处理…' : `导出此版本 ${format}`}
                </button>
              </footer>
              <p className="delivery-export-note">导出不代表定稿确认、任务完成或已发送给客户。</p>
            </>
          ) : (
            <div className="delivery-empty">
              <Icon name="file" size={28} />
              <h2>选择一个固定版本</h2>
              <p>预览与导出始终使用同一个版本。</p>
            </div>
          )}
        </section>
      </div>
      {result && (
        <p
          className={`delivery-result is-${result.kind}`}
          role={result.kind === 'error' ? 'alert' : 'status'}
        >
          {result.message}
        </p>
      )}
    </section>
  );
}
