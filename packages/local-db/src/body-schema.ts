import * as Y from 'yjs';

const blocks = new Set([
  'paragraph',
  'heading',
  'blockquote',
  'bulletList',
  'orderedList',
  'codeBlock',
  'horizontalRule',
  'table',
]);
const marks = new Set(['bold', 'italic', 'strike', 'code', 'underline']);
// @tiptap/y-tiptap 3.0.12为块转换/移动保留相对位置迁移；仅接受default的已知辅助根。
const positionRoot = '__tiptap_position_migrations:root:default';
function validatePositions(doc: Y.Doc) {
  if (!doc.share.has(positionRoot)) return;
  // Yjs二进制的根不携带容器类型；getMap会隐藏序列内容，必须在解释为Map前拒绝它。
  if (doc.share.get(positionRoot)!._start !== null)
    throw new Error('Invalid position root container');
  const record = (v: unknown): v is Record<string, unknown> =>
    !!v &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    Object.getPrototypeOf(v) === Object.prototype;
  const number = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
  const keys = (v: Record<string, unknown>, allowed: string[]) =>
    Object.keys(v).every((key) => allowed.includes(key));
  const id = (v: unknown): v is Record<string, unknown> =>
    record(v) && keys(v, ['client', 'clock']) && number(v.client) && number(v.clock);
  const boundary = (v: unknown) => v === undefined || v === 'start' || v === 'end';
  let count = 0;
  for (const [key, value] of doc.getMap(positionRoot)) {
    if (
      ++count > 100000 ||
      !record(value) ||
      !keys(value, ['version', 'client', 'clock', 'seen', 'transfers']) ||
      value.version !== 1 ||
      !number(value.client) ||
      !number(value.clock) ||
      key !== `${value.client}:${value.clock}` ||
      !Array.isArray(value.seen) ||
      !Array.isArray(value.transfers)
    )
      throw new Error('Unsupported position history');
    for (const pair of value.seen) {
      if (++count > 100000 || !Array.isArray(pair) || pair.length !== 2 || !pair.every(number))
        throw new Error('Invalid position history vector');
    }
    for (const transfer of value.transfers) {
      if (++count > 100000 || !record(transfer) || !keys(transfer, ['source', 'target']))
        throw new Error('Invalid position transfer');
      const { source, target } = transfer;
      if (
        !record(source) ||
        !keys(source, ['client', 'clock', 'length', 'boundary']) ||
        !number(source.client) ||
        !number(source.clock) ||
        !number(source.length) ||
        source.length < 1 ||
        !boundary(source.boundary)
      )
        throw new Error('Invalid position source');
      if (
        target !== null &&
        (!record(target) ||
          !keys(target, ['client', 'clock', 'type', 'tname', 'assoc', 'boundary']) ||
          !number(target.client) ||
          !number(target.clock) ||
          (target.type !== null && !id(target.type)) ||
          (target.tname !== undefined && target.tname !== 'default') ||
          (target.assoc !== undefined && target.assoc !== -1 && target.assoc !== 0) ||
          !boundary(target.boundary))
      )
        throw new Error('Invalid position target');
    }
  }
}
// 表格必须是完整矩形；拒绝重叠、越界和空洞，避免重开时编辑器自动修复并丢失内容。
function validateTable(table: Y.XmlElement) {
  const rows = table.toArray();
  if (!rows.length || rows.length > 200) throw new Error('Invalid table height');
  const grid: boolean[][] = Array.from({ length: rows.length }, () => []);
  let width = 0;
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y];
    if (!(row instanceof Y.XmlElement) || row.nodeName !== 'tableRow')
      throw new Error('Invalid table row');
    let x = 0;
    for (const cell of row.toArray()) {
      if (!(cell instanceof Y.XmlElement)) throw new Error('Invalid table cell');
      while (grid[y][x]) x++;
      const attrs = cell.getAttributes() as Record<string, unknown>;
      if (
        attrs.align !== undefined &&
        attrs.align !== null &&
        !['left', 'right', 'center', 'justify'].includes(attrs.align as string)
      )
        throw new Error('Invalid cell alignment');
      const colspan = attrs.colspan ?? 1,
        rowspan = attrs.rowspan ?? 1;
      if (
        !Number.isSafeInteger(colspan) ||
        !Number.isSafeInteger(rowspan) ||
        (colspan as number) < 1 ||
        (rowspan as number) < 1 ||
        x + (colspan as number) > 100 ||
        y + (rowspan as number) > rows.length
      )
        throw new Error('Invalid table span');
      if (
        attrs.colwidth !== undefined &&
        attrs.colwidth !== null &&
        (!Array.isArray(attrs.colwidth) ||
          attrs.colwidth.length !== colspan ||
          !attrs.colwidth.every(
            (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) <= 10000,
          ))
      )
        throw new Error('Invalid column widths');
      for (let dy = 0; dy < (rowspan as number); dy++)
        for (let dx = 0; dx < (colspan as number); dx++) {
          if (grid[y + dy][x + dx]) throw new Error('Overlapping table cells');
          grid[y + dy][x + dx] = true;
        }
      x += colspan as number;
      width = Math.max(width, x);
    }
  }
  if (
    !width ||
    grid.some(
      (row) =>
        row.length !== width || Array.from({ length: width }, (_, x) => row[x]).some((v) => !v),
    )
  )
    throw new Error('Incomplete table grid');
}

// 仅任务成果正文允许表格，其他富文本消费者保持原节点范围。
export function validateBody(state: Uint8Array, allowTables = false, editorSchema = 1) {
  if (editorSchema !== 1 && editorSchema !== 2) throw new Error('Unsupported editor schema');
  const comments = new Map<string, string>();
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, state);
    if ([...doc.share.keys()].some((name) => name !== 'default' && name !== positionRoot))
      throw new Error('Unsupported body root');
    validatePositions(doc);
    const root = doc.getXmlFragment('default');
    if (root._map.size) throw new Error('Invalid body root container');
    let count = 0;
    let hasTable = false;
    function visit(node: Y.XmlElement | Y.XmlText, parent: string, depth: number) {
      if (++count > 100000 || depth > 40) throw new Error('Body too complex');
      if (node instanceof Y.XmlText) {
        if (!['paragraph', 'heading', 'codeBlock'].includes(parent))
          throw new Error('Invalid text position');
        for (const delta of node.toDelta()) {
          if (typeof delta.insert !== 'string') throw new Error('Unsupported text');
          for (const [key, value] of Object.entries(delta.attributes ?? {})) {
            if (marks.has(key)) continue;
            if (editorSchema !== 2 || parent === 'codeBlock') throw new Error('Unsupported mark');
            if (!value || typeof value !== 'object' || Array.isArray(value))
              throw new Error('Invalid annotation');
            const attrs = value as Record<string, unknown>;
            if (key === 'highlight' && Object.keys(attrs).length === 0) continue;
            if (
              key !== 'comment' ||
              Object.keys(attrs).length !== 2 ||
              typeof attrs.id !== 'string' ||
              !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
                attrs.id,
              ) ||
              typeof attrs.text !== 'string' ||
              !attrs.text.trim() ||
              attrs.text !== attrs.text.trim() ||
              attrs.text.length > 4000
            )
              throw new Error('Invalid comment');
            if (comments.has(attrs.id) && comments.get(attrs.id) !== attrs.text)
              throw new Error('Inconsistent comment');
            comments.set(attrs.id, attrs.text);
            if (comments.size > 200) throw new Error('Too many comments');
          }
        }
        return;
      }
      const name = node.nodeName;
      const allowed =
        parent === 'default' || parent === 'blockquote'
          ? blocks.has(name)
          : parent === 'bulletList' || parent === 'orderedList'
            ? name === 'listItem'
            : parent === 'listItem' || parent === 'tableCell' || parent === 'tableHeader'
              ? blocks.has(name)
              : parent === 'table'
                ? name === 'tableRow'
                : parent === 'tableRow'
                  ? name === 'tableCell' || name === 'tableHeader'
                  : ['paragraph', 'heading'].includes(parent)
                    ? name === 'hardBreak'
                    : false;
      if (!allowed) throw new Error('Unsupported node');
      const attrs = node.getAttributes();
      const allowedAttrs =
        name === 'heading'
          ? ['level']
          : name === 'orderedList'
            ? ['start', 'type']
            : name === 'codeBlock'
              ? ['language']
              : name === 'tableCell' || name === 'tableHeader'
                ? ['colspan', 'rowspan', 'colwidth', 'align']
                : [];
      if (Object.keys(attrs).some((key) => !allowedAttrs.includes(key)))
        throw new Error('Unsupported node attribute');
      if (
        name === 'heading' &&
        attrs.level !== undefined &&
        ![1, 2, 3, 4, 5, 6].includes(Number(attrs.level))
      )
        throw new Error('Invalid heading');
      if (name === 'listItem' && (node.toArray()[0] as Y.XmlElement)?.nodeName !== 'paragraph')
        throw new Error('Invalid list item');
      if (name === 'table') {
        if (!allowTables) throw new Error('Table is outside the supported body scope');
        validateTable(node);
        hasTable = true;
      }
      if ((name === 'tableCell' || name === 'tableHeader') && !node.length)
        throw new Error('Empty table cell');
      for (const child of node.toArray()) {
        if (!(child instanceof Y.XmlElement) && !(child instanceof Y.XmlText))
          throw new Error('Unsupported child');
        visit(child, name, depth + 1);
      }
    }
    for (const child of root.toArray()) {
      if (!(child instanceof Y.XmlElement)) throw new Error('Invalid top-level body');
      visit(child, 'default', 0);
    }
    return hasTable;
  } finally {
    doc.destroy();
  }
}

// 仅派生列表/检索用文字；格式与块结构仍由已验证的Yjs二进制唯一持有。
export function bodyPlainText(state: Uint8Array, allowTables = false, editorSchema = 1) {
  validateBody(state, allowTables, editorSchema);
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, state);
    let result = '';
    // 与Tiptap getText({blockSeparator:'\n'})相同：容器块也产生分隔，硬换行直接保留。
    const visit = (node: Y.XmlElement | Y.XmlText, position: number): number => {
      if (node instanceof Y.XmlText) {
        const text = node
          .toDelta()
          .map((part: { insert: string }) => part.insert)
          .join('');
        result += text;
        return text.length;
      }
      if (node.nodeName === 'hardBreak') {
        result += '\n';
        return 1;
      }
      if (position > 0) result += '\n';
      if (node.nodeName === 'horizontalRule') return 1;
      let size = 1;
      for (const child of node.toArray())
        size += visit(child as Y.XmlElement | Y.XmlText, position + size);
      return size + 1;
    };
    let position = 0;
    for (const child of doc.getXmlFragment('default').toArray())
      position += visit(child as Y.XmlElement, position);
    return result;
  } finally {
    doc.destroy();
  }
}

// 选区绑定已保存修订。只编辑顶层纯文本段落，表格和其他块保持原有 Yjs 身份。
export function reviewBodyRange(
  state: Uint8Array,
  range: { paragraph: number; from: number; to: number; text: string },
  replacement?: string,
  action: 'replace' | 'insert_after' | 'append' = 'replace',
): Uint8Array | undefined {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, state);
    const root = doc.getXmlFragment('default');
    if (range.paragraph >= root.length) return;
    const block = root.get(range.paragraph);
    if (!(block instanceof Y.XmlElement) || block.nodeName !== 'paragraph' || block.length > 1)
      return;
    let text = block.get(0);
    if (text !== undefined && !(text instanceof Y.XmlText)) return;
    const parts = (text?.toDelta() ?? []) as {
      insert: string;
      attributes?: Record<string, unknown>;
    }[];
    const original = parts.map((part) => part.insert).join('');
    const { from, to } = range;
    if (
      from < 0 ||
      from > to ||
      to > original.length ||
      original.slice(from, to) !== range.text ||
      /[\p{Cc}\uD800-\uDFFF]/u.test(range.text) ||
      /[\uD800-\uDBFF]$/u.test(original.slice(0, from)) ||
      /[\uD800-\uDBFF]$/u.test(original.slice(0, to))
    )
      return;
    if (replacement !== undefined) {
      if (
        !replacement.trim() ||
        replacement.length > 8000 ||
        /[\p{Cc}\u2028\u2029\uD800-\uDFFF]/u.test(replacement.replaceAll('\n', '')) ||
        (action === 'replace' && from === to)
      )
        return;
      const lines = replacement.split('\n');
      const paragraph = (line: string, attributes?: Record<string, unknown>) => {
        const node = new Y.XmlElement('paragraph');
        if (line) {
          const content = new Y.XmlText();
          content.insert(0, line, attributes);
          node.insert(0, [content]);
        }
        return node;
      };
      doc.transact(() => {
        if (action === 'append') {
          root.push(lines.map((line) => paragraph(line)));
          return;
        }
        if (!(text instanceof Y.XmlText)) {
          text = new Y.XmlText();
          block.push([text]);
        }
        const start = action === 'replace' ? from : to;
        let offset = 0;
        const attributes = parts.find((part) => (offset += part.insert.length) > start)?.attributes;
        // 多段候选只拆分目标段落；尾部原文及其 marks 随最后一段保留，不重建整篇正文。
        let position = 0;
        const suffixParts = parts.flatMap((part) => {
          const end = position + part.insert.length;
          const insert = part.insert.slice(Math.max(0, to - position));
          position = end;
          return insert ? [{ ...part, insert }] : [];
        });
        text.delete(start, (lines.length > 1 ? original.length : to) - start);
        if (lines[0]) text.insert(start, lines[0], attributes ?? {});
        if (lines.length > 1) {
          const nodes = lines.slice(1).map((line, index) => {
            if (index !== lines.length - 2) return paragraph(line, attributes);
            const node = new Y.XmlElement('paragraph');
            const content = new Y.XmlText();
            content.applyDelta([...(line ? [{ insert: line, attributes }] : []), ...suffixParts]);
            node.insert(0, [content]);
            return node;
          });
          root.insert(range.paragraph + 1, nodes);
        }
      });
    }
    const result = Y.encodeStateAsUpdate(doc);
    validateBody(result, true);
    return result;
  } finally {
    doc.destroy();
  }
}
