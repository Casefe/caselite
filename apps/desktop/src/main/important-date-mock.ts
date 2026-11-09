import type { StreamFn } from '@earendil-works/pi-agent-core';
import type { DateFactCandidate, TextPage } from '@caselite/contracts';
import { syntheticTextStream } from './agent-demo';

// 仅固定合成通知的测试Provider夹具；不作为产品提取器，不接真实材料或网络。
export function mockImportantDateFacts(
  source: string,
  pages: Pick<TextPage, 'page' | 'text'>[],
  name: string,
): DateFactCandidate[] {
  const id = name.slice(0, 2),
    q = (part: string) => {
      const p = pages.find((p) => p.text.includes(part)) ?? pages[0];
      return { source_id: source, page: p.page, quote: p.text };
    };
  const v = (value: string, part: string) => ({ ...q(part), value });
  const context = pages
    .slice(0, 8)
    .map((p) => ({ source_id: source, page: p.page, quote: p.text }));
  const base: DateFactCandidate = {
    type_id: 'hearing',
    rule: 'explicit',
    date: null,
    time: null,
    trigger: null,
    period: null,
    time_semantics: 'unknown',
    context,
    missing: [],
  };
  if (id === '01')
    return [
      {
        ...base,
        date: v('2026-11-10', '兹定于'),
        time: v('09:00', '兹定于'),
        time_semantics: 'event_start',
      },
    ];
  if (id === '02') return [{ ...base, type_id: 'evidence', date: v('2026-11-20', '请于') }];
  if (id === '03')
    return [
      {
        ...base,
        type_id: 'evidence',
        rule: 'court-natural-days',
        trigger: v('2026-11-09', '合成签收记录：'),
        period: v('15', '本通知指定'),
      },
    ];
  if (id === '04')
    return [
      {
        ...base,
        type_id: 'payment',
        rule: 'civil-plaintiff-fee-7',
        trigger: v('2026-09-24', '签收记录'),
        period: v('7', '七日'),
      },
    ];
  if (id === '05')
    return [
      {
        ...base,
        type_id: 'remedy',
        rule: 'civil-judgment-15',
        trigger: v('2026-11-09', '送达回证'),
        period: v('15', '十五日'),
      },
    ];
  if (id === '06')
    return [
      {
        ...base,
        type_id: 'remedy',
        rule: 'civil-judgment-15',
        period: v('15', '十五日'),
        missing: ['缺少有效送达日期及适用程序事实'],
      },
    ];
  if (id === '07')
    return [
      {
        ...base,
        date: v('2026-11-12', '通知甲'),
        time: v('09:00', '通知甲'),
        time_semantics: 'event_start',
      },
      {
        ...base,
        date: v('2026-11-13', '通知乙'),
        time: v('14:00', '通知乙'),
        time_semantics: 'event_start',
      },
    ];
  if (id === '08')
    return [
      {
        ...base,
        type_id: 'meeting',
        date: v('2026-11-16', '双方确认'),
        time: v('10:30', '双方确认'),
        time_semantics: 'event_start',
      },
    ];
  if (id === '09')
    return [
      {
        ...base,
        type_id: 'appraisal',
        date: v('2026-11-18', '请于'),
        time: v('16:00', '请于'),
        time_semantics: 'submission_deadline',
      },
    ];
  if (id === '10')
    return [
      {
        ...base,
        type_id: 'preservation',
        rule: 'unsupported',
        missing: ['缺少裁定、财产类型和实施/续保日期，本期不计算复杂保全期间'],
      },
    ];
  return [
    {
      ...base,
      rule: 'unsupported',
      missing: ['此合成Provider仅识别固定01—10测试通知，不证明真实模型质量'],
    },
  ];
}
let dateDispatches = 0;
export const importantDateMockDispatches = () => dateDispatches;
export const syntheticImportantDateStream: StreamFn = (model, context, options) => {
  dateDispatches++;
  const last = [...context.messages].reverse().find((m) => m.role === 'user'),
    content = last?.content;
  const input =
    typeof content === 'string'
      ? content
      : (content?.map((p) => (p.type === 'text' ? p.text : '')).join('\n') ?? '');
  const line = input.split('\n').find((s) => s.startsWith('固定材料映射：'));
  const sources = line
    ? (JSON.parse(line.slice('固定材料映射：'.length)) as { source_id: string; pages: number[] }[])
    : [];
  const headers = [
    ...input.matchAll(/\[材料 (\d+)｜([^｜]+)｜(?:物理页|Word 提取段) (\d+)｜[^\]]+\]\n/g),
  ];
  const candidates = sources.flatMap((s, i) => {
    const selected = headers.filter((h) => Number(h[1]) === i + 1);
    const pages = selected.map((h) => {
      const index = headers.indexOf(h),
        start = h.index! + h[0].length,
        end = headers[index + 1]?.index ?? input.length;
      return { page: Number(h[3]), text: input.slice(start, end).trim() };
    });
    return pages.length ? mockImportantDateFacts(s.source_id, pages, selected[0][2]) : [];
  });
  const output = JSON.stringify({ candidates }),
    middle = Math.floor(output.length / 2);
  return syntheticTextStream(model, context, options, [
    output.slice(0, middle),
    output.slice(middle),
  ]);
};
