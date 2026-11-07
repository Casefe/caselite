import * as Y from 'yjs';

const blocks = new Set([
  'paragraph',
  'heading',
  'blockquote',
  'bulletList',
  'orderedList',
  'codeBlock',
  'horizontalRule',
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
// 当前本地正文仅接受已启用StarterKit节点；未知结构拒绝写回，避免编辑器自动修复时静默删内容。
export function validateBody(state: Uint8Array) {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, state);
    if ([...doc.share.keys()].some((name) => name !== 'default' && name !== positionRoot))
      throw new Error('Unsupported body root');
    validatePositions(doc);
    const root = doc.getXmlFragment('default');
    if (root._map.size) throw new Error('Invalid body root container');
    let count = 0;
    function visit(node: Y.XmlElement | Y.XmlText, parent: string, depth: number) {
      if (++count > 100000 || depth > 40) throw new Error('Body too complex');
      if (node instanceof Y.XmlText) {
        if (!['paragraph', 'heading', 'codeBlock'].includes(parent))
          throw new Error('Invalid text position');
        for (const delta of node.toDelta())
          if (
            typeof delta.insert !== 'string' ||
            Object.keys(delta.attributes ?? {}).some((key) => !marks.has(key))
          )
            throw new Error('Unsupported mark');
        return;
      }
      const name = node.nodeName;
      const allowed =
        parent === 'default' || parent === 'blockquote'
          ? blocks.has(name)
          : parent === 'bulletList' || parent === 'orderedList'
            ? name === 'listItem'
            : parent === 'listItem'
              ? blocks.has(name)
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
  } finally {
    doc.destroy();
  }
}

// 仅派生列表/检索用文字；格式与块结构仍由已验证的Yjs二进制唯一持有。
export function bodyPlainText(state: Uint8Array) {
  validateBody(state);
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
