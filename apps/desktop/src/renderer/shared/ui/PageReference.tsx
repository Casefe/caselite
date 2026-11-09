import type { AgentPageReference } from '../../../preload/caselite-api';
import { Icon } from './Icon';

export default function PageReference({
  reference,
  onRemove,
}: {
  reference: Pick<AgentPageReference, 'title' | 'mode' | 'characters'>;
  onRemove?(): void;
}) {
  return (
    <div
      className="agent-page-reference"
      aria-label={reference.mode === 'selection' ? '选区引用文件' : '页面引用文件'}
      aria-description={`${reference.mode === 'selection' ? '选中内容' : '当前页面'} · ${reference.characters} 字符`}
    >
      <span className="agent-page-reference-icon" aria-hidden="true">
        <Icon name="file" size={16} />
      </span>
      <span>
        <strong>{reference.title}.txt</strong>
      </span>
      {onRemove && (
        <button type="button" aria-label="移除页面引用" onClick={onRemove}>
          ×
        </button>
      )}
    </div>
  );
}
