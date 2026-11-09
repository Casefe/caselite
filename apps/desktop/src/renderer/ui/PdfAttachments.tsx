import { DocxOriginalReader } from './DocxOriginalReader';
import { DocxDraftPreview } from './DocxDraftPreview';
import { Icon } from '../shared/ui/Icon';
import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type KeyboardEvent,
  type CSSProperties,
} from 'react';
import { isDocx, type MaterialController } from './useMaterials';

const PdfReader = lazy(() => import('./PdfReader'));
export function validatePdfFile(file: Pick<File, 'name' | 'size'>): string | null {
  if (!/\.pdf$/i.test(file.name)) return '当前仅支持 PDF，请选择 PDF 文件。';
  if (!file.size || file.size > 20 * 1024 * 1024) return '请选择非空且不超过 20 MB 的 PDF。';
  return null;
}
function validateMaterialFile(file: Pick<File, 'name' | 'size'>) {
  if (!isDocx(file.name)) return validatePdfFile(file);
  return !file.size || file.size > 20 * 1024 * 1024 ? '请选择非空且不超过 20 MB 的 DOCX。' : null;
}
export function materialSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Number((bytes / 1024).toFixed(2))} KB`;
  return `${Number((bytes / (1024 * 1024)).toFixed(2))} MB`;
}
function PaperclipIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m8.5 12.5 5-5a2.5 2.5 0 0 1 3.5 3.5l-7 7a4.5 4.5 0 0 1-6.4-6.4l7.2-7.2a6.5 6.5 0 0 1 9.2 9.2L13 20.6" />
    </svg>
  );
}
export default function PdfAttachments({
  children,
  actions,
  disabled = false,
  showSavedMaterials = false,
  controller: c,
}: {
  children: ReactNode;
  actions?: ReactNode;
  disabled?: boolean;
  showSavedMaterials?: boolean;
  controller: MaterialController;
}) {
  const [over, setOver] = useState(false);
  const [layer, setLayer] = useState<'closed' | 'commands' | 'library'>('closed');
  const menuOpen = layer === 'commands' || (showSavedMaterials && layer === 'library');
  const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
  const shortcut = isMac ? '⌘⇧U' : 'Ctrl⇧U';
  const composing = useRef(false);
  const selecting = useRef(false);
  const focusIntent = useRef<'first' | 'last' | 'library'>('first');
  const menuId = useId();
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [menuPosition, setMenuPosition] = useState<CSSProperties>({});
  const reader = useRef<HTMLDialogElement>(null);
  const readingId = c.reading?.id;
  const readingDocx = c.reading && isDocx(c.reading.name) ? c.reading : null;
  const docxMaterial = c.items.find((item) => item.id === readingId) ?? readingDocx?.material;
  const closeMenu = (restoreFocus = false) => {
    setLayer('closed');
    if (restoreFocus) trigger.current?.focus();
  };
  const openCommands = (intent: 'first' | 'last' | 'library' = 'first') => {
    focusIntent.current = intent;
    setLayer('commands');
  };
  const requestFile = () => {
    if (disabled || c.busy || !c.available || selecting.current) return;
    closeMenu(true);
    selecting.current = true;
    // 所有文件入口复用原受控选择器；这里仅锁住本次UI意图，不创建材料或模型请求。
    try {
      void Promise.resolve(c.add())
        .catch(() => c.errorMessage('未能添加文件，请重试。'))
        .finally(() => {
          selecting.current = false;
        });
    } catch {
      selecting.current = false;
      c.errorMessage('未能打开文件选择器，请重试。');
    }
  };
  useLayoutEffect(() => {
    if (!menuOpen) return;
    const position = () => {
      const anchor = trigger.current?.getBoundingClientRect();
      if (!anchor) return;
      const margin = 8;
      const gap = 6;
      const above = Math.max(0, anchor.top - gap - margin);
      const below = Math.max(0, window.innerHeight - anchor.bottom - gap - margin);
      const upwards = above >= Math.min(360, below);
      const width = Math.min(layer === 'library' ? 320 : 240, window.innerWidth - 2 * margin);
      // 菜单随当前视口翻转并限制高度，避免首页高位输入框把返回和关闭裁到屏幕外。
      setMenuPosition({
        width,
        left: Math.max(margin, Math.min(anchor.left, window.innerWidth - width - margin)),
        top: upwards ? undefined : anchor.bottom + gap,
        bottom: upwards ? window.innerHeight - anchor.top + gap : undefined,
        maxHeight: Math.min(360, upwards ? above : below),
      });
    };
    position();
    window.addEventListener('resize', position);
    document.addEventListener('scroll', position, true);
    return () => {
      window.removeEventListener('resize', position);
      document.removeEventListener('scroll', position, true);
    };
  }, [menuOpen, layer]);
  useLayoutEffect(() => {
    if (layer === 'commands') {
      const items = menu.current?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]:not(:disabled)',
      );
      const target =
        focusIntent.current === 'library'
          ? menu.current?.querySelector<HTMLButtonElement>('[data-material-library-command]')
          : items?.[focusIntent.current === 'last' ? items.length - 1 : 0];
      (target ?? items?.[0])?.focus();
    } else if (layer === 'library')
      menu.current?.querySelector<HTMLButtonElement>('.material-library-heading button')?.focus();
  }, [layer]);
  useEffect(() => {
    if (!menuOpen) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !menu.current?.contains(event.target)) setLayer('closed');
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [menuOpen]);
  const menuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!menuOpen || event.nativeEvent.isComposing || composing.current) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeMenu(true);
    } else if (layer === 'commands') {
      const items = [
        ...(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ??
          []),
      ];
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? items.length - 1
              : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      } else if (
        event.key === 'ArrowRight' &&
        document.activeElement?.hasAttribute('data-material-library-command')
      ) {
        event.preventDefault();
        setLayer('library');
      } else if (event.key === 'Tab') closeMenu(true);
    }
  };
  useEffect(() => {
    const dialog = reader.current;
    if (!readingId || !dialog) return;
    const previousFocus = document.activeElement;
    const materialTrigger = trigger.current;
    // 原件阅读进入浏览器原生顶层，不能撑高输入面板或挤掉发送/停止按钮。
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
      if (
        previousFocus instanceof HTMLElement &&
        previousFocus !== document.body &&
        previousFocus.isConnected &&
        !previousFocus.closest('[hidden]')
      )
        previousFocus.focus();
      else if (materialTrigger?.isConnected) materialTrigger.focus();
    };
  }, [readingId]);
  return (
    <div
      className={`material-composer${over ? ' material-drag-over' : ''}`}
      onCompositionStartCapture={() => {
        composing.current = true;
      }}
      onCompositionEndCapture={() => {
        composing.current = false;
      }}
      onKeyDownCapture={(event) => {
        const modifier = isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
        if (
          modifier &&
          event.shiftKey &&
          !event.altKey &&
          (event.code === 'KeyU' || event.key.toLowerCase() === 'u') &&
          !event.repeat &&
          !event.nativeEvent.isComposing &&
          event.nativeEvent.keyCode !== 229 &&
          !composing.current &&
          !reader.current?.open &&
          event.currentTarget.contains(document.activeElement) &&
          !disabled &&
          !c.busy &&
          c.available
        ) {
          event.preventDefault();
          event.stopPropagation();
          requestFile();
        }
      }}
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
        const error = validateMaterialFile(files[0]);
        if (error) c.errorMessage(error);
        else void c.add(files[0]);
      }}
    >
      {over && <div className="material-drop-hint">松开以添加 PDF 或 DOCX</div>}
      {c.busy && (c.uploadingName || c.staged) && (
        <div className="material-staged" role="status">
          <span className="material-file-icon">PDF</span>
          <strong>{c.uploadingName ?? c.staged?.name}</strong>
          {c.staged && <small>{materialSize(c.staged.bytes)}</small>}
          <span>正在准备，可继续输入并发送…</span>
        </div>
      )}
      {c.staged && !c.busy && (
        <div className="material-staged">
          <strong>{c.staged.name}</strong>
          <small>{materialSize(c.staged.bytes)}</small>
          <span>{c.staged.restore_source_id ? '上次原件恢复尚未完成' : '上次附件尚未完成'}</span>
          <button type="button" disabled={disabled} onClick={() => void c.retry()}>
            {c.staged.restore_source_id ? '重试恢复' : '继续添加'}
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
                  <span className="material-file-icon">{isDocx(item.name) ? 'DOCX' : 'PDF'}</span>
                  <span>
                    <strong title={item.name}>{item.name}</strong>
                    <small title={`${item.bytes} 字节`}>
                      {materialSize(item.bytes)} ·{' '}
                      {isDocx(item.name)
                        ? c.sections.get(item.id)?.length
                          ? `已选 ${c.sections.get(item.id)!.length} 段`
                          : '打开并选择段落'
                        : c.sections.has(item.id)
                          ? `第 ${c.sections.get(item.id)!.join('、')} 页 · 本次发送`
                          : `${item.page_count} 页 · 本次发送`}
                    </small>
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={`移除附件 ${item.name}`}
                  title="仅从本次发送移除，保留原件"
                  disabled={disabled}
                  onClick={() => c.select(item.id, false)}
                >
                  ×
                </button>
              </li>
            ))}
        </ul>
      )}
      {children}
      <div className="assistant-actions">
        <div
          className="material-menu"
          ref={menu}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null))
              setLayer('closed');
          }}
          onKeyDownCapture={menuKeyDown}
        >
          <button
            ref={trigger}
            type="button"
            className="material-menu-trigger"
            aria-label="添加文件与材料"
            title={`添加文件与材料（${shortcut}）`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-controls={menuId}
            disabled={disabled || c.busy || !c.available}
            onClick={() => {
              if (menuOpen) closeMenu();
              else openCommands();
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                openCommands(event.key === 'ArrowUp' ? 'last' : 'first');
              }
            }}
          >
            <Icon name="plus" size={18} />
          </button>
          <div
            id={menuId}
            className={`material-menu-popover${layer === 'library' ? ' material-menu-library' : ''}`}
            style={menuPosition}
            role={layer === 'library' ? 'dialog' : 'menu'}
            aria-label={layer === 'library' ? '已保存材料' : '添加文件与材料'}
            hidden={!menuOpen}
          >
            <div hidden={layer !== 'commands'} className="material-commands">
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                aria-label="文件"
                aria-describedby={`${menuId}-capability`}
                aria-keyshortcuts={isMac ? 'Meta+Shift+U' : 'Control+Shift+U'}
                title="PDF：20 MB / 200 页；DOCX：20 MB / 200 个提取段"
                disabled={disabled || c.busy || !c.available}
                onClick={requestFile}
              >
                <PaperclipIcon />
                <span>文件</span>
                <span className="material-format" aria-hidden="true">
                  PDF / DOCX
                </span>
                <kbd aria-hidden="true">{shortcut}</kbd>
              </button>
              <span id={`${menuId}-capability`} hidden>
                支持 PDF 和 DOCX，每份不超过 20 MB。
              </span>
              {showSavedMaterials && c.items.some((item) => !(item.id in c.selected)) && (
                <button
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  data-material-library-command
                  aria-haspopup="dialog"
                  onClick={() => setLayer('library')}
                >
                  <Icon name="folder" size={16} />
                  <span>已保存材料</span>
                  <Icon name="chevron" size={14} />
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                aria-label="Skill"
                aria-describedby={`${menuId}-skill-status`}
                aria-disabled="true"
                disabled
              >
                <Icon name="spark" size={16} />
                <span>Skill</span>
                <small id={`${menuId}-skill-status`}>暂未接入</small>
              </button>
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                aria-label="MCP connectors"
                aria-describedby={`${menuId}-mcp-status`}
                aria-disabled="true"
                disabled
              >
                <Icon name="grid" size={16} />
                <span>MCP connectors</span>
                <small id={`${menuId}-mcp-status`}>暂未接入</small>
              </button>
            </div>
            {showSavedMaterials && (
              <section
                className="material-library"
                hidden={layer !== 'library'}
                aria-label="材料列表"
              >
                <header className="material-library-heading">
                  <button
                    type="button"
                    aria-label="返回添加菜单"
                    onClick={() => openCommands('library')}
                  >
                    <Icon name="back" size={16} />
                  </button>
                  <strong>已保存材料</strong>
                  <button type="button" aria-label="收起材料" onClick={() => closeMenu(true)}>
                    ×
                  </button>
                </header>
                {c.items.every((item) => item.id in c.selected) && <p>暂无可添加的材料</p>}
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
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => {
                          c.select(item.id, true);
                          closeMenu(true);
                        }}
                      >
                        添加到本轮
                      </button>
                      <details>
                        <summary>更多</summary>
                        <button
                          type="button"
                          disabled={disabled || c.busy}
                          onClick={() => void c.restore(item)}
                        >
                          恢复原件
                        </button>
                      </details>
                    </div>
                  ))}
              </section>
            )}
          </div>
        </div>
        {actions}
      </div>
      {c.reading && (
        <dialog
          ref={reader}
          className="material-reader-dialog"
          aria-label="材料原件"
          onCancel={(event) => {
            event.preventDefault();
            c.clearReading();
          }}
        >
          {c.reading &&
            !readingDocx &&
            c.items
              .filter((item) => item.id === c.reading?.id)
              .map((item) => (
                <div className="material-reader-tools" key={item.id}>
                  <span>
                    {item.status === 'processing'
                      ? '正在本地提取文字…'
                      : item.pages.some((page) => page.origin === 'ocr_candidate')
                        ? '本地识别文字 · 待核对'
                        : '原件阅读'}
                  </span>
                  <button
                    type="button"
                    disabled={disabled || c.busy}
                    onClick={() =>
                      void (item.status === 'processing'
                        ? c.stopLocalText(item)
                        : c.localText(item))
                    }
                  >
                    {item.status === 'processing' ? '停止提取' : '提取文字（离线）'}
                  </button>
                </div>
              ))}
          {readingDocx && (
            <DocxOriginalReader
              name={readingDocx.name}
              material={docxMaterial}
              onSaveOriginal={() => void c.saveOriginal(readingDocx.id, readingDocx.task)}
              onClose={c.clearReading}
              selection={
                readingDocx.id in c.selected
                  ? {
                      pages: c.sections.get(readingDocx.id) ?? [],
                      disabled,
                      toggle: (page) => c.toggleSection(readingDocx.id, page),
                    }
                  : undefined
              }
            >
              {c.copyError && <p role="alert">{c.copyError}</p>}
              {docxMaterial && docxMaterial.status !== 'ready' && (
                <button
                  type="button"
                  disabled={disabled || c.busy}
                  onClick={() =>
                    void (docxMaterial.status === 'processing'
                      ? c.stopLocalText(docxMaterial)
                      : c.localText(docxMaterial))
                  }
                >
                  {docxMaterial.status === 'processing' ? '停止提取' : '提取文字（离线）'}
                </button>
              )}
              {docxMaterial?.status === 'ready' && (
                <DocxDraftPreview
                  key={readingDocx.id}
                  source={docxMaterial}
                  scope={readingDocx.task}
                />
              )}
            </DocxOriginalReader>
          )}
          {c.reading && !readingDocx && (
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
        </dialog>
      )}
    </div>
  );
}
