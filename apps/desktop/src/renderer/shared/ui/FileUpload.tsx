import { materialSize } from '../data/material-size';
import { Icon } from './Icon';

export interface UploadFileItem {
  id: string;
  name: string;
  bytes: number;
  status: string;
}

export function FileUploadButton({
  disabled = false,
  title,
  onPick,
}: {
  disabled?: boolean;
  title?: string;
  onPick(): void;
}) {
  return (
    <button
      className="file-upload-button"
      type="button"
      disabled={disabled}
      onClick={onPick}
      title={title}
    >
      <Icon name="paperclip" size={17} />
      上传文件
    </button>
  );
}

export function FileUploadList({
  files,
  disabled = false,
  note,
  onRemove,
}: {
  files: readonly UploadFileItem[];
  disabled?: boolean;
  note?: string;
  onRemove(id: string): void;
}) {
  if (!files.length) return null;
  return (
    <div className="file-upload-list">
      <header>
        附件 <small>{files.length}</small>
        {note && <span>{note}</span>}
      </header>
      <ul>
        {files.map((file) => (
          <li key={file.id}>
            <Icon name="file" size={15} />
            <span>{file.name}</span>
            <small>{materialSize(file.bytes)}</small>
            <small className="file-upload-status">{file.status}</small>
            <button
              type="button"
              aria-label={`移除附件 ${file.name}`}
              disabled={disabled}
              onClick={() => onRemove(file.id)}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
