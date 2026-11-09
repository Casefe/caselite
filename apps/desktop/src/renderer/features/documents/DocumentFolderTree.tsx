import type { CatalogDocument, Matter } from '../../../preload/caselite-api';
import { Icon } from '../../shared/ui/Icon';

export type DocumentFolder = { id: string; label: string; documents: CatalogDocument[] };
export function documentFolderGroups(
  documents: CatalogDocument[],
  projects: Matter[],
  visited: Record<string, number> = {},
) {
  const personal = documents.filter((d) => !d.matter_id && !d.collection.includes('模板'));
  const names = [...new Set(personal.map((d) => d.collection).filter(Boolean))].sort();
  return [
    {
      id: 'personal',
      label: '我的文档',
      documents: personal,
      children: [
        { id: 'personal:all', label: '工作文档', documents: personal },
        {
          id: 'collection:个人资料',
          label: '个人资料',
          documents: personal.filter((d) => d.collection === '个人资料'),
        },
        {
          id: 'personal:unsorted',
          label: '待整理',
          documents: personal.filter((d) => !d.collection),
        },
        ...names
          .filter((n) => !n.includes('模板') && n !== '个人资料')
          .map((n) => ({
            id: 'collection:' + n,
            label: n,
            documents: personal.filter((d) => d.collection === n),
          })),
      ],
    },
    {
      id: 'projects',
      label: '案件文档',
      documents: documents.filter((d) => !!d.matter_id),
      children: projects.map((p) => ({
        id: 'project:' + p.id,
        label: p.title,
        documents: documents.filter((d) => d.matter_id === p.id),
      })),
    },
    {
      id: 'templates',
      label: '模板',
      documents: documents.filter((d) => d.collection.includes('模板')),
      children: [
        ...new Set([
          '合同模板',
          '法律文书模板',
          '常用函件模板',
          ...documents.map((d) => d.collection).filter((n) => n.includes('模板')),
        ]),
      ].map((n) => ({
        id: 'collection:' + n,
        label: n,
        documents: documents.filter((d) => d.collection === n),
      })),
    },
    {
      id: 'recent',
      label: '最近访问',
      documents: documents.filter((d) => visited[d.id]),
      children: [7, 30].map((days) => ({
        id: 'recent:' + days,
        label: '过去' + days + '天',
        documents: documents.filter(
          (d) => visited[d.id] && Date.now() - visited[d.id] <= days * 86400000,
        ),
      })),
    },
  ];
}
export default function DocumentFolderTree({
  documents,
  projects,
  visited,
  selected,
  disabled,
  onSelect,
}: {
  documents: CatalogDocument[];
  projects: Matter[];
  visited: Record<string, number>;
  selected: string;
  disabled: boolean;
  onSelect(folder: DocumentFolder): void;
}) {
  const groups = documentFolderGroups(documents, projects, visited);
  return (
    <nav className="document-folder-tree" aria-label="文件夹">
      <h2>文件夹</h2>
      <button
        type="button"
        className="document-folder-row"
        aria-pressed={selected === 'all'}
        disabled={disabled}
        onClick={() => onSelect({ id: 'all', label: '全部文档', documents })}
      >
        <Icon name="folder" size={18} />
        <span>全部文档</span>
        <small>{documents.length}</small>
      </button>
      {groups.map((g) => (
        <details key={g.id} open>
          <summary
            aria-current={selected === g.id ? 'page' : undefined}
            onClick={(event) => {
              if (disabled) event.preventDefault();
              else onSelect(g);
            }}
          >
            <Icon name={g.id === 'recent' ? 'clock' : 'folder'} size={19} />
            <strong>
              {g.label}
              {g.id === 'recent' && <em>本次会话</em>}
            </strong>
            <small>{g.documents.length}</small>
          </summary>
          <div>
            {g.children.map((f) => (
              <button
                type="button"
                key={f.id}
                className="document-folder-row"
                disabled={disabled}
                aria-pressed={selected === f.id}
                onClick={() => onSelect(f)}
              >
                <Icon name={g.id === 'recent' ? 'clock' : 'folder'} size={17} />
                <span>{f.label}</span>
                <small>{f.documents.length}</small>
              </button>
            ))}
            {!g.children.length && (
              <p className="document-folder-empty">
                暂无{g.label === '案件文档' ? '项目' : '分类'}
              </p>
            )}
          </div>
        </details>
      ))}
    </nav>
  );
}
