import { expect, it } from 'vitest';
import * as Y from 'yjs';
import { fromBuffer } from 'yauzl';
import type { DeliverySnapshot } from '@caselite/contracts';
import { renderSnapshotWord } from '../../apps/desktop/src/main/adapters/snapshot-word';

// 根据缺陷现象独立构建CaseLite黑盒回归，不复用上游测试源码或内部接口。
const snapshot: DeliverySnapshot = {
  id: '00000000-0000-4000-8000-000000000001',
  document_id: '00000000-0000-4000-8000-000000000002',
  task_id: '00000000-0000-4000-8000-000000000003',
  body_id: '00000000-0000-4000-8000-000000000004',
  body_revision: 1,
  editor_schema: 1,
  metadata_version: 1,
  task_version: 1,
  title: '合成文书',
  collection: '',
  tags: [],
  note: '',
  content_sha256: '0'.repeat(64),
  created_at: '2026-11-09T00:00:00.000Z',
  created_by: 'local',
  kind: 'draft',
  source_refs: [],
};
function node(
  name: string,
  children: Array<Y.XmlElement | Y.XmlText> = [],
  attrs: Record<string, unknown> = {},
) {
  const n = new Y.XmlElement(name);
  for (const [key, value] of Object.entries(attrs)) n.setAttribute(key, value as string);
  n.insert(0, children);
  return n;
}
function p(value: string) {
  const text = new Y.XmlText();
  text.insert(0, value);
  return node('paragraph', [text]);
}
function state(children: Y.XmlElement[]) {
  const d = new Y.Doc();
  try {
    d.getXmlFragment('default').insert(0, children);
    return Y.encodeStateAsUpdate(d);
  } finally {
    d.destroy();
  }
}
function parts(bytes: Uint8Array): Promise<Map<string, string>> {
  return new Promise((resolve, reject) =>
    fromBuffer(Buffer.from(bytes), { lazyEntries: true }, (error, zip) => {
      if (error || !zip) return reject(error ?? new Error('Missing zip'));
      const values = new Map<string, string>();
      zip.on('error', reject);
      zip.on('end', () => resolve(values));
      zip.on('entry', (entry) => {
        if (!entry.fileName.endsWith('.xml')) return zip.readEntry();
        zip.openReadStream(entry, (err, stream) => {
          if (err || !stream) return reject(err ?? new Error('Missing stream'));
          const chunks: Buffer[] = [];
          stream.on('data', (c) => chunks.push(c));
          stream.on('error', reject);
          stream.on('end', () => {
            values.set(entry.fileName, Buffer.concat(chunks).toString('utf8'));
            zip.readEntry();
          });
        });
      });
      zip.readEntry();
    }),
  );
}

it.each([0, 1, 8, 11, 12, 14, 31, 0xfffe, 0xffff])(
  'rejects invalid XML body U+%s instead of deleting source text',
  async (code) => {
    await expect(
      renderSnapshotWord(snapshot, state([p(`甲${String.fromCodePoint(code)}乙`)])),
    ).rejects.toThrow('Unsupported XML character');
  },
);
it.each([0xfffe, 0xffff, 0xd800, 0xdc00])('rejects invalid XML title U+%s', async (code) => {
  await expect(
    renderSnapshotWord(
      { ...snapshot, title: `标题${String.fromCharCode(code)}` },
      state([p('正文')]),
    ),
  ).rejects.toThrow('Unsupported title character');
});
it('preserves legal XML boundary characters, rare Chinese and emoji in all emitted XML parts', async () => {
  const value = '甲\t乙\n丙\r丁 & < > " 𠮷 😀 \uFFFD';
  const xml = await parts(
    await renderSnapshotWord({ ...snapshot, title: '𠮷😀' }, state([p(value)])),
  );
  const body = xml.get('word/document.xml')!;
  expect(body).toContain('𠮷 😀');
  expect(body).toContain('&amp;');
  expect(body).toContain('&lt;');
  expect(xml.get('docProps/core.xml')).toContain('𠮷😀');
  for (const content of xml.values()) {
    for (const char of content) {
      const cp = char.codePointAt(0)!;
      expect(
        cp === 9 ||
          cp === 10 ||
          cp === 13 ||
          (cp >= 32 && cp <= 0xd7ff) ||
          (cp >= 0xe000 && cp <= 0xfffd) ||
          cp >= 0x10000,
      ).toBe(true);
    }
  }
});
it('rejects an uncovered empty table row rather than silently removing it', async () => {
  const body = state([
    node('table', [node('tableRow', [node('tableCell', [p('保留')])]), node('tableRow')]),
  ]);
  await expect(renderSnapshotWord(snapshot, body)).rejects.toThrow('Incomplete table grid');
});
it('retains an empty row fully covered by a vertical merge', async () => {
  const body = state([
    node('table', [
      node('tableRow', [node('tableCell', [p('跨两行')], { rowspan: 2 })]),
      node('tableRow'),
    ]),
  ]);
  const xml = (await parts(await renderSnapshotWord(snapshot, body))).get('word/document.xml')!;
  expect(xml.match(/<w:tr>/g)).toHaveLength(2);
  expect(xml).toContain('<w:vMerge w:val="restart"/>');
  expect(xml).toContain('<w:vMerge w:val="continue"/>');
});
it('gives separate lists independent numbering starts without mutating the body', async () => {
  const list = (start: number, label: string) =>
    node('orderedList', [node('listItem', [p(label)])], { start });
  const body = state([list(4, '第一组'), p('间隔'), list(7, '第二组')]);
  const before = body.slice();
  const xml = await parts(await renderSnapshotWord(snapshot, body));
  const numbering = xml.get('word/numbering.xml')!;
  const ids = [...xml.get('word/document.xml')!.matchAll(/<w:numId w:val="(\d+)"\/>/g)].map(
    (m) => m[1],
  );
  expect(ids).toHaveLength(2);
  expect(ids[0]).not.toBe(ids[1]);
  for (const [i, start] of [4, 7].entries()) {
    const number = [...numbering.matchAll(/<w:num w:numId="(\d+)">([\s\S]*?)<\/w:num>/g)].find(
      (m) => m[1] === ids[i],
    );
    expect(number?.[2]).toContain(`<w:startOverride w:val="${start}"/>`);
  }
  expect(body).toEqual(before);
});
