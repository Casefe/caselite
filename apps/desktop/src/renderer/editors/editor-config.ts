import { TableKit } from '@tiptap/extension-table';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import type * as Y from 'yjs';
import { DocumentHighlight, DocumentComment } from './document-annotation-marks';

export const reviewUpdateOrigin = Symbol('accepted-ai-review');

// Collaboration 管理 Yjs 撤销历史；不能同时启用 StarterKit 的 UndoRedo。
// 每个编辑会话注入自己的 Y.Doc，不在场景配置中缓存或共享可变正文。
export const editorCapabilities = {
  basic: { tables: false, annotations: false },
  document: { tables: true, annotations: true },
} as const;

type EditorCapabilities = { tables: boolean; annotations: boolean };

export const localExtensions = (
  doc: Y.Doc,
  capabilities: boolean | EditorCapabilities = false,
  annotations = false,
) => {
  const tables = typeof capabilities === 'boolean' ? capabilities : capabilities.tables;
  const includeAnnotations =
    typeof capabilities === 'boolean' ? annotations : capabilities.annotations;
  return [
    StarterKit.configure({ undoRedo: false, link: false }),
    ...(tables ? [TableKit.configure({ table: { resizable: false } })] : []),
    ...(includeAnnotations ? [DocumentHighlight, DocumentComment] : []),
    Collaboration.configure({
      document: doc,
      yUndoOptions: { trackedOrigins: [reviewUpdateOrigin] },
    }),
  ];
};

// 展示配置不决定正文能力，不能据此扩大现有调用的 schema。
export const editorProfiles = {
  document: { mode: 'simple' },
  description: { mode: 'compact' },
  comment: { mode: 'compact' },
  draft: { mode: 'notion' },
} as const;
export type EditorProfile = keyof typeof editorProfiles;
