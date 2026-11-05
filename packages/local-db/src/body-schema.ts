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
// 当前本地正文仅接受已启用StarterKit节点；未知结构拒绝写回，避免编辑器自动修复时静默删内容。
export function validateBody(state: Uint8Array) {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, state);
    if ([...doc.share.keys()].some((name) => name !== 'default'))
      throw new Error('Unsupported body root');
    const root = doc.getXmlFragment('default');
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
