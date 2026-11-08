import { useEffect, useRef, useState } from 'react';
import { DraftEditor, type RichDraft } from '../../../editors/RichEditor';
import DeliveryVersions, {
  type DeliveryFormat,
  type DeliveryResult,
  type DeliveryVersion,
} from './DeliveryVersions';

type DemoVersion = DeliveryVersion & { body: RichDraft };
const initialText = '付款期限为十日。\n本合同为合成样本，仅供交互验收。';
const documentId = 'synthetic-delivery-document';
const copyBody = (body: RichDraft): RichDraft => ({
  text: body.text,
  state: body.state ? [...body.state] : null,
});

// DEV-1737 仅为隔离UI原型：内存状态不称作落盘成功，不调用保存、导出或模型IPC。
export default function DeliveryPrototype() {
  const [draft, setDraft] = useState<RichDraft>({ text: initialText, state: null });
  const [saved, setSaved] = useState({ revision: 1, body: copyBody(draft) });
  const [dirty, setDirty] = useState(false);
  const [versions, setVersions] = useState<DemoVersion[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [page, setPage] = useState<'draft' | 'versions'>('draft');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DeliveryResult | null>(null);
  const [outcome, setOutcome] = useState<DeliveryResult['kind']>('success');
  const [pending, setPending] = useState<{ id: string; format: DeliveryFormat } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const confirmation = useRef<HTMLDialogElement | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const sequence = useRef(0);
  const lock = useRef(false);
  const editingIntent = useRef(false);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  useEffect(() => {
    const dialog = confirmation.current;
    if (pending) dialog?.showModal();
    // 关闭时先让React恢复按钮可用，再归还焦点；异步导出结束前不聚焦禁用按钮。
    if (!pending && !busy) {
      returnFocus.current?.focus();
      returnFocus.current = null;
    }
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, [pending, busy]);
  const selected = versions.find((version) => version.id === selectedId);
  async function create(note: string) {
    if (dirty || lock.current) return false;
    const version: DemoVersion = {
      id: `demo-version-${++sequence.current}`,
      documentId,
      revision: saved.revision,
      title: '合成合同｜付款条款',
      note,
      createdAt: new Date().toISOString(),
      body: copyBody(saved.body),
    };
    setVersions((items) => [version, ...items]);
    setSelectedId(version.id);
    setResult({
      kind: 'success',
      message: `演示：已在本次会话固定修订 ${version.revision}，尚未写入数据库。`,
    });
    return true;
  }
  function startExport(id: string, format: DeliveryFormat) {
    if (lock.current || !versions.some((item) => item.id === id)) return;
    returnFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPending({ id, format });
    setResult(null);
  }
  function confirmExport() {
    if (!pending || lock.current) return;
    const version = versions.find((item) => item.id === pending.id);
    if (!version) return;
    lock.current = true;
    setBusy(true);
    setPending(null);
    setResult(null);
    const { format } = pending;
    timer.current = setTimeout(() => {
      setResult({
        kind: outcome,
        message:
          outcome === 'success'
            ? `演示成功：${format} 将使用固定修订 ${version.revision}。本原型未生成文件。`
            : outcome === 'cancelled'
              ? '演示已取消：没有生成文件，固定版本保留。'
              : '演示失败：输出位置不可写。固定版本保留，可选择后重新导出。',
      });
      setBusy(false);
      lock.current = false;
    }, 600);
  }
  return (
    <main className="delivery-prototype">
      <link rel="stylesheet" href={new URL('../ui-design.css', window.location.href).href} />
      <link
        rel="stylesheet"
        href={new URL('../styles/delivery-versions.css', window.location.href).href}
      />
      <div className="delivery-demo-banner">
        <strong>MOCK_ONLY · 交付界面原型</strong>
        <span>合成文档；固定版本仅保留本次会话，退出即清空；不生成文件、不调用模型。</span>
      </div>
      <nav aria-label="文档位置">
        <strong>CaseLite</strong>
        <span>文档 / 合成合同 / {page === 'draft' ? '工作稿' : '交付版本'}</span>
      </nav>
      {page === 'draft' ? (
        <section className="delivery-workdraft">
          <header>
            <div>
              <p>演示工作稿 · 修订 {saved.revision}</p>
              <h1>合成合同｜付款条款</h1>
            </div>
            <button
              type="button"
              onClick={() => {
                setResult(null);
                setPage('versions');
              }}
            >
              交付版本
            </button>
          </header>
          <div
            onPasteCapture={() => {
              editingIntent.current = true;
            }}
            onDropCapture={() => {
              editingIntent.current = true;
            }}
            onCutCapture={() => {
              editingIntent.current = true;
            }}
            onInputCapture={() => {
              editingIntent.current = true;
            }}
            onKeyDownCapture={() => {
              editingIntent.current = true;
            }}
            onPointerDownCapture={() => {
              editingIntent.current = true;
            }}
          >
            <DraftEditor
              value={draft}
              onChange={(next) => {
                setDraft(next);
                // 原型重新挂载的水合不是人工编辑；格式按钮、键盘和输入仍计入未保存。
                if (editingIntent.current) setDirty(true);
              }}
              label="演示工作稿正文"
              profile="document"
            />
          </div>
          <footer>
            <p role="status">
              {dirty ? '有未保存修改' : `演示已保存修订 ${saved.revision} · 仅本次会话`}
            </p>
            <button
              type="button"
              className="primary"
              disabled={!dirty}
              onClick={() => {
                setSaved({ revision: saved.revision + 1, body: copyBody(draft) });
                setDirty(false);
              }}
            >
              演示保存工作稿
            </button>
          </footer>
        </section>
      ) : (
        <DeliveryVersions
          versions={versions}
          selectedId={selectedId}
          revision={saved.revision}
          dirty={dirty}
          busy={busy || pending !== null}
          result={result}
          onSelect={(id) => {
            setSelectedId(id);
            setResult(null);
          }}
          onCreate={create}
          onExport={startExport}
          onBack={() => {
            editingIntent.current = false;
            setPage('draft');
          }}
          preview={
            selected && (
              <DraftEditor
                value={selected.body}
                onChange={() => {}}
                label="固定版本正文"
                disabled
                readTables
              />
            )
          }
        />
      )}
      {page === 'versions' && (
        <details className="delivery-demo-controls">
          <summary>演示结果设置</summary>
          <div role="group" aria-label="模拟导出结果">
            {(
              [
                ['success', '成功'],
                ['cancelled', '取消'],
                ['error', '失败'],
              ] as const
            ).map(([kind, label]) => (
              <button
                type="button"
                key={kind}
                aria-pressed={kind === outcome}
                disabled={busy || pending !== null}
                onClick={() => setOutcome(kind)}
              >
                {label}
              </button>
            ))}
          </div>
          <p>仅验证反馈与恢复，实际文件输出由后续任务接入。</p>
        </details>
      )}
      {pending && (
        <dialog
          ref={confirmation}
          className="delivery-confirm"
          aria-label="确认演示导出"
          onCancel={() => {
            setPending(null);
            setResult({ kind: 'cancelled', message: '演示已取消：没有生成文件，固定版本保留。' });
          }}
        >
          <h2>
            导出固定修订 {versions.find((item) => item.id === pending.id)?.revision} ·{' '}
            {pending.format}
          </h2>
          <p>此次为演示，不会在磁盘创建文件。</p>
          <div>
            <button
              type="button"
              autoFocus
              onClick={() => {
                setPending(null);
                setResult({
                  kind: 'cancelled',
                  message: '演示已取消：没有生成文件，固定版本保留。',
                });
              }}
            >
              取消
            </button>
            <button type="button" className="primary" onClick={confirmExport}>
              演示导出
            </button>
          </div>
        </dialog>
      )}
    </main>
  );
}
