import { useRef, useState } from 'react';
import { Editor, generateHTML, generateJSON, getSchema, type JSONContent } from '@tiptap/react';
import DOMPurify from 'dompurify';
import * as Y from 'yjs';
import type { Material, MaterialScope } from '../../preload/caselite-api';
import type { TaskRequest } from '../../preload/caselite-api';
import { localExtensions } from '../editors/editor-config';
import { check, mutation } from '../shared/data/taskCommand';

const allowedTags = [
  'p',
  'br',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'strike',
  'blockquote',
  'ol',
  'ul',
  'li',
  'table',
  'tbody',
  'thead',
  'tfoot',
  'tr',
  'th',
  'td',
];

export function parseDocxDraft(html: string) {
  const doc = new Y.Doc();
  const extensions = localExtensions(doc, true);
  try {
    const clean = DOMPurify.sanitize(html, {
      ALLOWED_TAGS: allowedTags,
      ALLOWED_ATTR: ['start', 'colspan', 'rowspan'],
      ALLOW_DATA_ATTR: false,
      ALLOW_ARIA_ATTR: false,
    });
    // TableMap 会按跨度分配网格，必须在创建 Editor 之前限制不可信 HTML。
    const tree = new DOMParser().parseFromString(clean, 'text/html');
    let count = 0;
    function inspect(element: Element, depth: number) {
      if (++count > 10000 || depth > 35) throw new Error('文档结构过于复杂，请核对原件。');
      for (const [attribute, limit] of [
        ['colspan', 100],
        ['rowspan', 200],
      ] as const) {
        const raw = element.getAttribute(attribute);
        if (raw !== null && (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > limit))
          throw new Error('合并表格跨度超出支持范围，请核对原件。');
      }
      if (element.tagName === 'TABLE' && element.querySelectorAll('tr').length > 200)
        throw new Error('表格超过 200 行，请核对原件。');
      if (
        element.tagName === 'TR' &&
        [...element.children].reduce(
          (n, cell) => n + Number(cell.getAttribute('colspan') ?? 1),
          0,
        ) > 100
      )
        throw new Error('表格超过 100 列，请核对原件。');
      for (const child of element.children) inspect(child, depth + 1);
      if (element.tagName === 'TABLE') {
        const rows = [...(element as HTMLTableElement).rows];
        const grid: boolean[][] = rows.map(() => []);
        let width = 0;
        for (const [y, row] of rows.entries()) {
          let x = 0;
          for (const cell of row.cells) {
            while (grid[y][x]) x++;
            if (x + cell.colSpan > 100 || y + cell.rowSpan > rows.length)
              throw new Error('表格跨度越界，请核对原件。');
            for (let dy = 0; dy < cell.rowSpan; dy++)
              for (let dx = 0; dx < cell.colSpan; dx++) {
                if (grid[y + dy][x + dx]) throw new Error('表格单元格重叠，请核对原件。');
                grid[y + dy][x + dx] = true;
              }
            x += cell.colSpan;
            width = Math.max(width, x);
          }
        }
        if (
          !width ||
          grid.some(
            (row) =>
              row.length !== width ||
              Array.from({ length: width }, (_, x) => row[x]).some((v) => !v),
          )
        )
          throw new Error('表格不完整，请核对原件。');
      }
    }
    inspect(tree.body, 0);
    const json = generateJSON(clean, extensions);
    const parsed = getSchema(extensions).nodeFromJSON(json);
    parsed.check();
    if (!parsed.textContent.trim()) throw new Error('未找到可编辑正文。');
    const editor = new Editor({ extensions, injectCSS: false });
    try {
      editor.commands.setContent(json, { errorOnInvalidContent: true });
      // 使用同一编辑内核的规范化结果预览，包括表格后供继续输入的空段落。
      const normalized = editor.getJSON();
      return { json: normalized, html: generateHTML(normalized, extensions) };
    } finally {
      editor.destroy();
    }
  } finally {
    doc.destroy();
  }
}

export function encodeDocxDraft(json: JSONContent) {
  const doc = new Y.Doc();
  const editor = new Editor({ extensions: localExtensions(doc, true), injectCSS: false });
  try {
    if (!editor.commands.setContent(json, { errorOnInvalidContent: true }))
      throw new Error('无法创建草稿。');
    return Array.from(Y.encodeStateAsUpdate(doc));
  } finally {
    editor.destroy();
    doc.destroy();
  }
}

export function DocxDraftPreview({ source, scope }: { source: Material; scope: MaterialScope }) {
  const [preview, setPreview] = useState<ReturnType<typeof parseDocxDraft> | null>(null);
  const [status, setStatus] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hasPending, setHasPending] = useState(false);
  const pending = useRef<Extract<TaskRequest, { operation: 'save' }> | null>(null);
  async function prepare() {
    setBusy(true);
    try {
      const result = await window.caselite.material({
        protocol_version: 1,
        operation: 'docx_semantic_preview',
        source_id: source.id,
        scope,
      });
      if (!result.ok) throw new Error(result.message);
      if (!result.docx_semantic) throw new Error('没有可用的结构预览。');
      setPreview(parseDocxDraft(result.docx_semantic.html));
      setStatus(
        result.docx_semantic.warningCount
          ? `解析器报告 ${result.docx_semantic.warningCount} 项提示，请核对原件。`
          : '请核对预览后保存草稿。',
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '预览失败。');
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!preview) return;
    setBusy(true);
    const lookup = (key: string) =>
      window.caselite.task({
        protocol_version: 1,
        operation: 'status',
        idempotency_key: key,
      });
    try {
      let result;
      if (pending.current) {
        result = await lookup(pending.current.idempotency_key);
        if (!result.ok && result.code === 'NOT_FOUND')
          result = await window.caselite.task(pending.current);
      } else {
        const read = check(
          await window.caselite.task({
            protocol_version: 1,
            operation: 'read',
            task_id: source.task_id,
          }),
        );
        const task = read.tasks[0];
        if (!task || task.id !== source.task_id || task.body_revision !== 0 || read.state)
          throw new Error('该任务已有草稿，请从任务的「成果正文」打开。');
        // 从固定来源初始化空正文。已有修订或并发保存由正式正文入口拒绝覆盖。
        pending.current = {
          ...mutation(),
          operation: 'save',
          task_id: task.id,
          document_id: task.document_id,
          body_id: task.body_id,
          expected_revision: 0,
          editor_schema: 1,
          state: encodeDocxDraft(preview.json),
        };
        result = await window.caselite.task(pending.current);
      }
      if (!result.ok && result.code === 'RESULT_UNKNOWN')
        result = await lookup(pending.current.idempotency_key);
      check(result);
      pending.current = null;
      setHasPending(false);
      setSaved(true);
      setStatus('草稿已保存到此设备。可在「任务 → 成果正文」重开。');
      window.dispatchEvent(new Event('caselite:material-task-saved'));
      window.dispatchEvent(
        new CustomEvent('caselite:docx-draft-saved', { detail: source.task_id }),
      );
    } catch (error) {
      setHasPending(Boolean(pending.current));
      setStatus(error instanceof Error ? error.message : '保存结果待核对。');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="docx-draft-preview">
      <p>
        草稿保留正文和基础表格。图片、页眉页脚、页码、修订与批注请回原件核对；编号样式可能简化。
      </p>
      {!preview && (
        <button disabled={busy} type="button" onClick={() => void prepare()}>
          预览可编辑草稿
        </button>
      )}
      {preview && (
        <>
          <div
            data-testid="docx-draft-preview"
            className="docx-draft-content"
            dangerouslySetInnerHTML={{ __html: preview.html }}
          />
          <button disabled={busy || saved} type="button" onClick={() => void save()}>
            {hasPending ? '核对保存结果' : '确认保存草稿'}
          </button>
        </>
      )}
      <p role="status" data-testid="docx-draft-status">
        {status}
      </p>
    </div>
  );
}
