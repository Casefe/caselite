import type { ReactNode } from 'react';
import type { FolderEntry } from '../../../preload/caselite-api';
import { Icon } from '../../shared/ui/Icon';
import DefaultFolderSettings from './DefaultFolderSettings';
import type { LocalFolderModel } from './useLocalFolder';

export default function LocalFolderTree({
  folder,
  disabled,
  projectId,
  onOpen,
  onBeforeOpen,
  onSettingsBlocked,
}: {
  folder: LocalFolderModel;
  disabled: boolean;
  projectId?: string;
  onOpen(entry: FolderEntry): void;
  onBeforeOpen(): void;
  onSettingsBlocked(value: boolean): void;
}) {
  const { root, directories, expanded, pending, saved } = folder;
  function contents(id: string): ReactNode {
    const list = directories[id];
    if (!list) return <p role="status">正在读取目录…</p>;
    if (!list.entries.length) return <p className="document-folder-empty">此文件夹为空</p>;
    return (
      <>
        {list.entries.map((entry) =>
          entry.kind === 'directory' ? (
            <details key={entry.entry_id} open={expanded.includes(entry.entry_id)}>
              <summary
                aria-disabled={disabled || folder.busy}
                onClick={(event) => {
                  event.preventDefault();
                  if (!disabled) folder.toggle(entry.entry_id);
                }}
              >
                <Icon name="folder" size={17} />
                <span>{entry.display_name}</span>
              </summary>
              {expanded.includes(entry.entry_id) && (
                <div className="document-folder-children">{contents(entry.entry_id)}</div>
              )}
            </details>
          ) : (
            <button
              key={entry.entry_id}
              type="button"
              className="document-folder-file"
              data-source-id={entry.entry_id}
              title={entry.display_name}
              disabled={disabled || folder.busy || entry.kind !== 'file'}
              onClick={() => onOpen(entry)}
            >
              <span className="document-file-badge">
                {entry.kind === 'blocked_link'
                  ? '链接'
                  : entry.kind === 'unsupported'
                    ? '—'
                    : entry.display_name.split('.').pop()?.toUpperCase()}
              </span>
              <span>{entry.display_name}</span>
            </button>
          ),
        )}
        {list.cursor && (
          <button disabled={disabled || folder.busy} onClick={() => folder.more(id)}>
            加载更多
          </button>
        )}
      </>
    );
  }
  return (
    <section aria-label="本地文件夹" className="document-folder-tree local-folder-tree">
      <h2>本地文件夹</h2>
      {folder.busy && <p role="status">正在处理…</p>}
      {folder.message && <p role="alert">{folder.message}</p>}
      {folder.state === 'not_configured' && (
        <p>{projectId ? '请先为此项目选择默认文件夹内的目录。' : '请在设置中选择默认文件夹。'}</p>
      )}
      {folder.state === 'needs_reselect' && (
        <p>
          {projectId
            ? '项目目录尚未选择或不可用，请先核对并选择项目目录。'
            : '文件夹不可用，请在设置中重新选择原文件夹。'}
        </p>
      )}
      {projectId && (
        <DefaultFolderSettings
          projectId={projectId}
          onBlocked={onSettingsBlocked}
          onChanged={folder.restore}
          disabled={disabled || folder.busy}
        />
      )}
      <button disabled={folder.busy || disabled} onClick={folder.restore}>
        重新读取文件夹
      </button>
      {root && (
        <details open={expanded.includes(root.root_entry_id)}>
          <summary
            aria-disabled={disabled || folder.busy}
            onClick={(event) => {
              event.preventDefault();
              if (!disabled) folder.toggle(root.root_entry_id);
            }}
          >
            <Icon name="folder" size={17} />
            {root.display_name}
          </summary>
          {expanded.includes(root.root_entry_id) && (
            <div className="document-folder-children">{contents(root.root_entry_id)}</div>
          )}
        </details>
      )}
      {pending.length > 0 && (
        <section aria-label="未完成的文件打开">
          <h3>未完成的文件打开</h3>
          {pending.map((item) => (
            <div key={item.request_id}>
              <span>{item.relative_label}</span>
              {item.needs_reselect && <span> · 需要重新选择文件夹</span>}
              <button disabled={folder.busy} onClick={() => folder.query(item)}>
                核对结果
              </button>
              <button
                disabled={folder.busy || disabled || (item.phase === 'reserved' && !root)}
                onClick={() => {
                  onBeforeOpen();
                  folder.resume(item);
                }}
              >
                继续原操作
              </button>
              <button disabled={folder.busy} onClick={() => folder.cancel(item)}>
                取消原操作
              </button>
            </div>
          ))}
          {folder.resumeId && <p role="status">请点击原文件以继续；不会创建新的打开请求。</p>}
        </section>
      )}
      {saved.length > 0 && (
        <details>
          <summary>已保存的原件</summary>
          {saved.map((item) => (
            <button
              key={item.mapping_id}
              type="button"
              className="document-folder-file"
              disabled={disabled || folder.busy}
              onClick={() => {
                onBeforeOpen();
                folder.openSaved(item);
              }}
            >
              {item.relative_label}
            </button>
          ))}
        </details>
      )}
    </section>
  );
}
