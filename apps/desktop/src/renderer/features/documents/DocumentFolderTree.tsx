import { useState } from 'react';
import type { CatalogDocument, Matter } from '../../../preload/caselite-api';
import { Icon } from '../../shared/ui/Icon';

export type DocumentFolder = {
  id: string;
  label: string;
  documents: CatalogDocument[];
  children?: DocumentFolder[];
};
export function documentFolderGroups(documents: CatalogDocument[], projects: Matter[]) {
  const templates = documents.filter((d) => d.collection.includes('模板'));
  const ordinary = documents.filter((d) => !d.collection.includes('模板'));
  const personal = ordinary.filter((d) => !d.matter_id);
  const names = [
    ...new Set([
      '工作文档',
      '个人资料',
      '待整理',
      ...personal.map((d) => d.collection).filter(Boolean),
    ]),
  ];
  const projectIds = [
    ...new Set([
      ...projects.map((p) => p.id),
      ...ordinary.flatMap((d) => (d.matter_id ? [d.matter_id] : [])),
    ]),
  ];
  return [
    {
      id: 'personal',
      label: '我的文档',
      documents: personal,
      children: names.map((name) => ({
        id: 'collection:' + name,
        label: name,
        // 未分类的既有工作稿归入工作文档；每份文件只出现一次，不复制正文。
        documents: personal.filter((d) => (d.collection || '工作文档') === name),
      })),
    },
    {
      id: 'projects',
      label: '案件文档',
      documents: ordinary.filter((d) => !!d.matter_id),
      children: projectIds.map((id) => ({
        id: 'project:' + id,
        label: projects.find((p) => p.id === id)?.title ?? '项目文档',
        documents: ordinary.filter((d) => d.matter_id === id),
      })),
    },
    {
      id: 'templates',
      label: '模板',
      documents: templates,
      children: [
        ...new Set([
          '合同模板',
          '法律文书模板',
          '常用函件模板',
          ...templates.map((d) => d.collection),
        ]),
      ].map((name) => ({
        id: 'collection:' + name,
        label: name,
        documents: templates.filter((d) => d.collection === name),
      })),
    },
  ] satisfies DocumentFolder[];
}

export function documentFolderPath(groups: DocumentFolder[], id: string): string[] {
  for (const folder of groups) {
    if (folder.children) {
      const path = documentFolderPath(folder.children, id);
      if (path.length) return [folder.label, ...path];
    } else if (folder.documents.some((d) => d.id === id)) return [folder.label];
  }
  return [];
}
export default function DocumentFolderTree({
  documents,
  projects,
  selected,
  disabled,
  onSelect,
}: {
  documents: CatalogDocument[];
  projects: Matter[];
  selected: string | null;
  disabled: boolean;
  onSelect(document: CatalogDocument): void;
}) {
  const [expanded, setExpanded] = useState(['personal', 'collection:工作文档', 'projects']);
  const groups = documentFolderGroups(documents, projects);
  function folder(node: DocumentFolder) {
    const open = expanded.includes(node.id);
    return (
      <details key={node.id} open={open} data-folder-id={node.id}>
        <summary
          aria-expanded={open}
          aria-disabled={disabled}
          onClick={(event) => {
            event.preventDefault();
            if (!disabled)
              setExpanded((old) =>
                old.includes(node.id) ? old.filter((id) => id !== node.id) : [...old, node.id],
              );
          }}
        >
          <Icon name="folder" size={19} />
          <span>{node.label}</span>
        </summary>
        {open && (
          <div className="document-folder-children">
            {node.children
              ? node.children.map(folder)
              : node.documents.map((doc) => {
                  const extension = doc.title.split('.').at(-1)?.toLocaleLowerCase();
                  const badge =
                    extension === 'pdf'
                      ? 'PDF'
                      : extension === 'docx' || extension === 'doc'
                        ? 'W'
                        : null;
                  return (
                    <button
                      key={doc.id}
                      type="button"
                      className="document-folder-file"
                      data-document-id={doc.id}
                      aria-label={doc.title}
                      aria-pressed={selected === doc.id}
                      disabled={disabled}
                      title={doc.title}
                      onClick={() => onSelect(doc)}
                    >
                      {badge ? (
                        <span className="document-file-badge" data-format={badge}>
                          {badge}
                        </span>
                      ) : (
                        <Icon name="file" size={17} />
                      )}
                      <span>{doc.title}</span>
                    </button>
                  );
                })}
            {!(node.children ? node.children.length : node.documents.length) && (
              <p className="document-folder-empty">此文件夹为空</p>
            )}
          </div>
        )}
      </details>
    );
  }
  return (
    <nav className="document-folder-tree" aria-label="文件夹">
      {groups.map(folder)}
    </nav>
  );
}
