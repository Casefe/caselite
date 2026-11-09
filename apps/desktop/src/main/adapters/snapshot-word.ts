import * as Y from 'yjs';
import { validateBody } from '@caselite/local-db';
import type { DeliverySnapshot } from '@caselite/contracts';
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  HeadingLevel,
  LevelFormat,
  AlignmentType,
  WidthType,
  BorderStyle,
  type IRunOptions,
  type ILevelsOptions,
} from 'docx';

// OOXML不接受这些控制字符；逐字符检查，避免把不可读内容交给Word修复。
const invalidXml = (value: string) =>
  Array.from(value).some((char) => {
    const code = char.codePointAt(0)!;
    return !(
      code === 9 ||
      code === 10 ||
      code === 13 ||
      (code >= 0x20 && code <= 0xd7ff) ||
      (code >= 0xe000 && code <= 0xfffd) ||
      (code >= 0x10000 && code <= 0x10ffff)
    );
  });
export async function renderSnapshotWord(
  snapshot: DeliverySnapshot,
  state: Uint8Array,
): Promise<Uint8Array> {
  if (state.length > 2_000_000 || snapshot.source_refs.length)
    throw new Error('Unsupported export input');
  if (invalidXml(snapshot.title)) throw new Error('Unsupported title character');
  validateBody(state, true);
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, state);
    let nodes = 0,
      textSize = 0;
    const numbering: Array<{ reference: string; levels: ILevelsOptions[] }> = [];
    const inline = (node: Y.XmlElement): TextRun[] =>
      node.toArray().flatMap((child) => {
        if (child instanceof Y.XmlText)
          return child
            .toDelta()
            .map((part: { insert: string; attributes?: Record<string, unknown> }) => {
              textSize += part.insert.length;
              if (textSize > 300_000) throw new Error('Export text limit');
              if (invalidXml(part.insert)) throw new Error('Unsupported XML character');
              const a = part.attributes ?? {};
              const opts: IRunOptions = {
                text: part.insert,
                bold: a.bold ? true : undefined,
                italics: a.italic ? true : undefined,
                strike: a.strike ? true : undefined,
                underline: a.underline ? {} : undefined,
                font: a.code ? 'Menlo' : '宋体',
              };
              return new TextRun(opts);
            });
        if (child instanceof Y.XmlElement && child.nodeName === 'hardBreak')
          return [new TextRun({ break: 1 })];
        throw new Error('Unsupported inline node');
      });
    type Block = Paragraph | Table;
    function blocks(
      children: Array<Y.XmlElement | Y.XmlText>,
      depth = 0,
      list?: { reference: string; first: boolean },
      tableDepth = 0,
    ): Block[] {
      if (depth > 16) throw new Error('Export nesting limit');
      return children.flatMap((node): Block[] => {
        if (!(node instanceof Y.XmlElement) || ++nodes > 20_000)
          throw new Error('Unsupported block or size');
        const name = node.nodeName,
          a = node.getAttributes();
        if (['paragraph', 'heading', 'codeBlock'].includes(name)) {
          const useNumbering = list?.first;
          if (list) list.first = false;
          return [
            new Paragraph({
              children: inline(node),
              heading:
                name === 'heading'
                  ? [
                      HeadingLevel.HEADING_1,
                      HeadingLevel.HEADING_2,
                      HeadingLevel.HEADING_3,
                      HeadingLevel.HEADING_4,
                      HeadingLevel.HEADING_5,
                      HeadingLevel.HEADING_6,
                    ][Number(a.level ?? 1) - 1]
                  : undefined,
              numbering: useNumbering ? { reference: list!.reference, level: 0 } : undefined,
              indent: depth && !useNumbering ? { left: depth * 360 } : undefined,
              spacing: { after: 120 },
              style: name === 'codeBlock' ? 'CodeBlock' : undefined,
            }),
          ];
        }
        if (name === 'bulletList' || name === 'orderedList') {
          const start = a.start ?? 1;
          if (!Number.isSafeInteger(start) || Number(start) < 1 || Number(start) > 1_000_000)
            throw new Error('Unsupported list start');
          const formats = {
            '1': LevelFormat.DECIMAL,
            a: LevelFormat.LOWER_LETTER,
            A: LevelFormat.UPPER_LETTER,
            i: LevelFormat.LOWER_ROMAN,
            I: LevelFormat.UPPER_ROMAN,
          };
          const format = formats[(a.type ?? '1') as keyof typeof formats];
          if (!format) throw new Error('Unsupported numbering');
          const reference = `list-${numbering.length}`;
          numbering.push({
            reference,
            levels: [
              {
                level: 0,
                format: name === 'bulletList' ? LevelFormat.BULLET : format,
                text: name === 'bulletList' ? '•' : '%1.',
                start: Number(start),
                alignment: AlignmentType.LEFT,
                style: { paragraph: { indent: { left: (depth + 1) * 360, hanging: 180 } } },
              },
            ],
          });
          return node.toArray().flatMap((item) => {
            if (!(item instanceof Y.XmlElement) || item.nodeName !== 'listItem')
              throw new Error('Invalid list item');
            return blocks(
              item.toArray() as Y.XmlElement[],
              depth + 1,
              { reference, first: true },
              tableDepth,
            );
          });
        }
        if (name === 'blockquote')
          return blocks(node.toArray() as Y.XmlElement[], depth + 1, undefined, tableDepth);
        if (name === 'horizontalRule')
          return [
            new Paragraph({
              border: { bottom: { color: '999999', style: BorderStyle.SINGLE, size: 4 } },
            }),
          ];
        if (name === 'table') {
          if (depth > 0 || tableDepth > 0)
            throw new Error('Nested or indented tables not supported');
          return [
            new Table({
              width: { size: 9026, type: WidthType.DXA },
              rows: node.toArray().map((row) => {
                if (!(row instanceof Y.XmlElement) || row.nodeName !== 'tableRow')
                  throw new Error('Invalid table row');
                return new TableRow({
                  children: row.toArray().map((cell) => {
                    if (
                      !(cell instanceof Y.XmlElement) ||
                      !['tableCell', 'tableHeader'].includes(cell.nodeName)
                    )
                      throw new Error('Invalid table cell');
                    const attrs = cell.getAttributes();
                    if (attrs.colwidth != null)
                      throw new Error('Explicit table widths not supported');
                    if (attrs.align && attrs.align !== 'left')
                      throw new Error('Unsupported cell alignment');
                    return new TableCell({
                      children: blocks(
                        cell.toArray() as Y.XmlElement[],
                        0,
                        undefined,
                        tableDepth + 1,
                      ),
                      columnSpan: Number(attrs.colspan ?? 1),
                      rowSpan: Number(attrs.rowspan ?? 1),
                      shading: cell.nodeName === 'tableHeader' ? { fill: 'EEEEEE' } : undefined,
                    });
                  }),
                });
              }),
            }),
          ];
        }
        throw new Error('Unsupported block');
      });
    }
    const content = blocks(doc.getXmlFragment('default').toArray() as Y.XmlElement[]);
    return new Uint8Array(
      await Packer.toBuffer(
        new Document({
          title: `${snapshot.title}（草稿）`,
          creator: 'CaseLite',
          description: `snapshot=${snapshot.id};body_revision=${snapshot.body_revision};sha256=${snapshot.content_sha256}`,
          numbering: { config: numbering },
          styles: {
            default: { document: { run: { font: '宋体', size: 24 } } },
            paragraphStyles: [
              { id: 'CodeBlock', name: 'CodeBlock', basedOn: 'Normal', run: { font: 'Menlo' } },
            ],
          },
          sections: [
            {
              properties: {
                page: {
                  size: { width: 11906, height: 16838 },
                  margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
                },
              },
              children: [
                new Paragraph({
                  children: [new TextRun({ text: '草稿 · 未经法律核验', color: '777777' })],
                }),
                new Paragraph({ text: snapshot.title, heading: HeadingLevel.TITLE }),
                ...content,
              ],
            },
          ],
        }),
      ),
    );
  } finally {
    doc.destroy();
  }
}
