import {
  DATE_RULE_VERSION,
  dateCheckLabels,
  ordinaryDateSchema,
  type DateChecks,
  type DateEvaluated,
  type DateFactCandidate,
} from '@caselite/contracts';

export const dateRules = {
  version: DATE_RULE_VERSION,
  checks: dateCheckLabels,
  types: [
    ['meeting', '双方确认函、工作会议通知', '提取明确日期/时刻，无通用法定公式'],
    ['hearing', '传票、开庭或延期通知', '仅提取明确开庭日期；不按收到+3日或举证期倒推'],
    [
      'payment',
      '案件受理费通知、有效签收记录',
      '明确日期；大陆普通民事原告案件受理费收到次日起7自然日',
    ],
    [
      'court-submission',
      '法院具体提交要求、有效通知及送达记录',
      '明确日期或法院当前有效指定的N自然日',
    ],
    [
      'evidence',
      '举证/证据交换通知、获准延期通知',
      '明确日期或法院当前有效N自然日；需排除55/56条变化，不套最低15日',
    ],
    ['filing', '立案/补正通知', '明确日期或法院明确N自然日；机关办理时限不当律师截止日'],
    [
      'appraisal',
      '鉴定/勘验通知及具体提交要求',
      '明确日期或法院明确N自然日；鉴定费不套案件受理费7日',
    ],
    ['negotiation', '调解、谈判确认函或具体通知', '提取明确日期/时刻，无通用公式'],
    [
      'remedy',
      '可上诉一审裁判、有效送达凭证',
      '大陆普通民事可上诉一审判决15自然日/裁定10日；不套刑事、行政、涉外、小额或终审',
    ],
    ['preservation', '保全裁定及实施、续保记录', '仅提取明确日期；财产种类/起算等复杂公式未支持'],
    ['execution', '执行通知、裁判和履行/异议材料', '仅提取明确日期；执行申请/异议复杂公式未支持'],
    [
      'period-check',
      '相关文书、起算及中止中断材料',
      '仅提取明确日期；时效中止中断等复杂公式未支持',
    ],
    ['custom', '用户选定的固定文书', '可提取明确日期/时刻；自定义名称不赋予法律公式'],
  ].map(([type_id, documents, support]) => ({ type_id, documents, support })),
  laws: [
    {
      title: '民事诉讼法（2023修正）68/85/88/90/139/171条',
      url: 'https://ipc.court.gov.cn/zh-cn/news/view-6231.html',
      effective: '2024-01-01',
    },
    {
      title: '民事诉讼证据规定（2019修正）50/51/54—56条',
      url: 'https://www.court.gov.cn/zixun/xiangqing/212721.html',
      effective: '2020-05-01',
    },
    {
      title: '诉讼费用交纳办法22条（本期仅民事原告案件受理费）',
      url: 'https://www.court.gov.cn/jianshe/xiangqing/5092.html',
      effective: '2007-04-01',
    },
  ],
  calendars: [
    {
      id: 'CN-2026-GBFM-2025-7-v1',
      year: 2026,
      url: 'https://www.beijing.gov.cn/zhengce/zhengcefagui/202511/t20251104_4258873.html',
    },
    {
      id: 'CN-2027-GBFM-2026-10-v1',
      year: 2027,
      url: 'https://www1.xinhuanet.com/politics/20261105/f90cd6ad4df94ab4833b141e52ccfc13/c.html',
    },
  ],
};
const holidays: Record<number, { ranges: string[][]; working: string[] }> = {
  2026: {
    ranges: [
      ['01-01', '01-03'],
      ['02-15', '02-23'],
      ['04-04', '04-06'],
      ['05-01', '05-05'],
      ['06-19', '06-21'],
      ['09-25', '09-27'],
      ['10-01', '10-07'],
    ],
    working: ['01-04', '02-14', '02-28', '05-09', '09-20', '10-10'],
  },
  2027: {
    ranges: [
      ['01-01', '01-03'],
      ['02-05', '02-13'],
      ['04-03', '04-05'],
      ['05-01', '05-05'],
      ['06-09', '06-09'],
      ['09-15', '09-15'],
      ['10-01', '10-07'],
    ],
    working: ['01-31', '02-14', '05-08', '09-26', '10-09'],
  },
};
const leap = (y: number) => y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
const monthDays = (y: number) => [31, leap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export function nextCivilDate(date: string) {
  let [y, m, d] = date.split('-').map(Number);
  if (++d > monthDays(y)[m - 1]) {
    d = 1;
    if (++m > 12) {
      m = 1;
      y++;
    }
  }
  if (y > 9999) throw Error('日期超出支持范围');
  return `${y.toString().padStart(4, '0')}-${m.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`;
}
function isRest(date: string) {
  const [y, m, d] = date.split('-').map(Number),
    c = holidays[y],
    md = date.slice(5);
  if (!c) throw Error(`缺少${y}年已校验日历版本，无法计算`);
  if (c.working.includes(md)) return false;
  if (c.ranges.some(([a, b]) => md >= a && md <= b)) return true;
  const n = y - 1,
    days =
      365 * n +
      Math.floor(n / 4) -
      Math.floor(n / 100) +
      Math.floor(n / 400) +
      monthDays(y)
        .slice(0, m - 1)
        .reduce((a, b) => a + b, 0) +
      d;
  return days % 7 === 0 || days % 7 === 6;
}
export function addNaturalDays(trigger: string, days: number) {
  if (
    !ordinaryDateSchema.safeParse(trigger).success ||
    !Number.isInteger(days) ||
    days < 1 ||
    days > 366
  )
    throw Error('起算日期或自然日期间无效（当前最多366日）');
  let result = trigger;
  const versions = new Set<string>();
  for (let i = 0; i < days; i++) result = nextCivilDate(result);
  const raw = result;
  for (let i = 0; i < 32; i++) {
    const year = Number(result.slice(0, 4)),
      c = dateRules.calendars.find((v) => v.year === year);
    if (!c) throw Error(`缺少${year}年已校验日历版本，无法计算`);
    versions.add(c.id);
    if (!isRest(result)) return { date: result, raw, versions: [...versions] };
    result = nextCivilDate(result);
  }
  throw Error('末日顺延超出本期支持范围');
}
const chineseNumber = (v: string): number => {
  if (/^\d+$/.test(v)) return Number(v);
  const digits: Record<string, number> = {
    零: 0,
    〇: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };
  let total = 0,
    current = 0;
  for (const ch of v) {
    if (ch === '百') {
      total += (current || 1) * 100;
      current = 0;
    } else if (ch === '十') {
      total += (current || 1) * 10;
      current = 0;
    } else if (ch in digits) current = digits[ch];
    else return NaN;
  }
  return total + current;
};
function datesIn(text: string) {
  return [...text.matchAll(/(\d{4})(?:年|-|\/)(\d{1,2})(?:月|-|\/)(\d{1,2})(?:日)?/g)].map(
    (m) => `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`,
  );
}
// 先核原文，再核值；含有真实引文不授权模型把11月20改成11月10，或把工作日改为自然日。
export function normalizedFactMatches(
  kind: 'date' | 'time' | 'trigger' | 'period',
  fact: NonNullable<DateFactCandidate['date']>,
) {
  if (kind === 'period') {
    if (
      !/^\d{1,3}$/.test(fact.value) ||
      /工作日|不得少于|不少于|不得超过|不超过|至少|至多|最低|开庭.{0,6}前/.test(fact.quote)
    )
      return false;
    const matches = [
      ...fact.quote
        .replace(/\d{4}(?:年|-|\/)(\d{1,2})(?:月|-|\/)(\d{1,2})(?:日)?/g, '[日期]')
        .matchAll(/([零〇一二两三四五六七八九十百\d]+)(?:个)?(?:自然日|日|天)/g),
    ].map((m) => chineseNumber(m[1]));
    return (
      matches.length === 1 &&
      matches[0] === Number(fact.value) &&
      matches[0] > 0 &&
      matches[0] <= 366
    );
  }
  if (kind === 'time') {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(fact.value)) return false;
    const modified = /(?:凌晨|早上|上午|中午|下午|傍晚|晚上|夜间)|\b(?:am|pm)\b/i.test(fact.quote);
    return [
      ...fact.quote.matchAll(
        /(凌晨|早上|上午|中午|下午|傍晚|晚上|夜间)?\s*(\d{1,2})[:：](\d{2})\s*(am|pm)?/gi,
      ),
    ].some((m) => {
      let h = Number(m[2]);
      const modifier = m[1] ?? m[4]?.toLowerCase();
      // 同句范围的省略修饰不猜继承；例如下午3:00至5:00中的5:00须重选完整引文。
      if (h > 23 || Number(m[3]) > 59 || (modified && !modifier) || (m[1] && m[4])) return false;
      if (modifier) {
        if (h > 12) return false;
        if (['下午', '傍晚', '晚上', '夜间', 'pm'].includes(modifier)) {
          if (!h || (h === 12 && modifier !== 'pm')) return false;
          h = (h % 12) + 12;
        } else if (modifier === '中午') {
          if (h !== 12) return false;
        } else if (modifier === 'am') h = h % 12;
        else if (h === 12) return false;
      }
      return `${String(h).padStart(2, '0')}:${m[3]}` === fact.value;
    });
  }
  if (!ordinaryDateSchema.safeParse(fact.value).success) return false;
  const segments =
    kind === 'trigger'
      ? fact.quote
          .split(/[；;。\n]/)
          .filter((s) => /签收|收到|接到|送达回证|到达.*系统|送达日期|有效送达|依法送达/.test(s))
      : [fact.quote];
  return segments.some((s) => datesIn(s).includes(fact.value));
}
export function evaluateDate(
  fact: DateFactCandidate,
  index: number,
  checks: DateChecks,
  conflict = false,
): DateEvaluated {
  const out: DateEvaluated = {
    index,
    fact,
    status: 'needs_information',
    date: null,
    time: null,
    requires: ['source_reviewed'],
    messages: [...fact.missing],
    computation: [],
    rule_version: DATE_RULE_VERSION,
    calendar_versions: [],
  };
  const requireChecks = (...keys: (keyof DateChecks)[]) => {
    for (const key of keys) if (!out.requires.includes(key)) out.requires.push(key);
  };
  const all = [fact.date, fact.time, fact.trigger, fact.period, ...fact.context].filter(
    (v) => v !== null,
  );
  const text = all.map((v) => v.quote).join('\n');
  if (fact.rule === 'unsupported') {
    out.status = 'unsupported';
    out.messages.push('该相对公式尚未支持；可另提取文书明确日期');
    return out;
  }
  if (conflict) requireChecks('conflict_resolved');
  if (conflict && !checks.conflict_resolved) out.status = 'conflict';
  if (fact.date && /日前|日之前|日前提交/.test(fact.date.quote)) requireChecks('boundary');
  if (fact.rule === 'explicit') {
    if (!fact.date) {
      out.messages.push('文书未提供可核对的完整年月日');
      return out;
    }
    out.date = fact.date.value;
    out.time = fact.time?.value ?? null;
    out.computation.push('提取文书明确日期；不按节假日擅自改期，不补23:59或工作结束时刻');
  } else {
    requireChecks(
      'ordinary_civil',
      'applicable_party',
      'valid_service',
      'current_notice',
      'no_changes',
    );
    if (fact.type_id === 'evidence') requireChecks('evidence_55_56');
    const unnegated = text.replace(
      /非(?:小额诉讼|终审|涉外|刑事|行政)|不是(?:小额诉讼|终审|涉外|刑事|行政)/g,
      '',
    );
    if (/刑事案件|行政诉讼|涉外案件|小额诉讼|一审终审|二审终审/.test(unnegated)) {
      out.status = 'unsupported';
      out.messages.push('文书提示不属于本期普通民事公式范围');
      return out;
    }
    if (!fact.trigger || !fact.period) {
      out.messages.push('缺少可核对的有效送达起算日或明确自然日期间');
      return out;
    }
    const days = Number(fact.period.value),
      expected = {
        'civil-judgment-15': 15,
        'civil-order-10': 10,
        'civil-plaintiff-fee-7': 7,
        'court-natural-days': days,
      }[fact.rule];
    const semantic =
      fact.rule === 'civil-judgment-15'
        ? /判决/.test(text) && /上诉/.test(text) && fact.type_id === 'remedy'
        : fact.rule === 'civil-order-10'
          ? /裁定/.test(text) && /上诉/.test(text) && fact.type_id === 'remedy'
          : fact.rule === 'civil-plaintiff-fee-7'
            ? /案件受理费/.test(text) && /原告/.test(text) && fact.type_id === 'payment'
            : /法院|本院|通知/.test(text);
    if (
      days !== expected ||
      !semantic ||
      ['hearing', 'meeting', 'negotiation', 'preservation', 'execution', 'period-check'].includes(
        fact.type_id,
      ) ||
      fact.type_id.startsWith('custom-')
    ) {
      out.status = 'unsupported';
      out.messages.push('类型、文书或期间与选定规则不匹配；没有可套用的通用公式');
      return out;
    }
    if (out.requires.some((key) => !checks[key])) {
      out.messages.push('先逐项核对适用事实；未提及不等于不存在');
      return out;
    }
    try {
      const result = addNaturalDays(fact.trigger.value, days);
      out.date = result.date;
      out.calendar_versions = result.versions;
      out.computation.push(
        `有效送达起算日 ${fact.trigger.value} 不计入`,
        `连续累加 ${days} 自然日，原始届满 ${result.raw}`,
        result.raw === result.date
          ? '末日非休假日，保持原始届满'
          : `仅末日按已校验休假/调休日历顺延至 ${result.date}`,
      );
    } catch (e) {
      out.messages.push(e instanceof Error ? e.message : '日期计算失败');
      return out;
    }
  }
  out.status = out.messages.length
    ? 'needs_information'
    : out.requires.some((key) => !checks[key])
      ? 'needs_information'
      : 'ready';
  if (conflict && !checks.conflict_resolved) out.status = 'conflict';
  return out;
}
