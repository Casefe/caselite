import { expect, it } from 'vitest';
import { emptyDateChecks, type DateFactCandidate } from '@caselite/contracts';
import { addNaturalDays, evaluateDate, normalizedFactMatches } from './important-date-rules';
const id = '11111111-1111-4111-8111-111111111111';
const fact = (value: string, quote: string) => ({ source_id: id, page: 1, value, quote });
const checks = Object.fromEntries(
  Object.keys(emptyDateChecks).map((k) => [k, true]),
) as typeof emptyDateChecks;
it('rejects genuine quotes with forged normalized date, period or working-day semantics', () => {
  expect(normalizedFactMatches('date', fact('2026-11-10', '请于2026年11月20日前提交'))).toBe(false);
  expect(normalizedFactMatches('period', fact('15', '自送达之日起三十日内提交'))).toBe(false);
  expect(normalizedFactMatches('period', fact('15', '自送达之日起十五个工作日内提交'))).toBe(false);
  expect(normalizedFactMatches('period', fact('15', '自送达之日起十五日内提交'))).toBe(true);
  expect(normalizedFactMatches('period', fact('15', '普通程序举证期限不得少于十五日'))).toBe(false);
  expect(normalizedFactMatches('period', fact('3', '应当在开庭三日前通知当事人'))).toBe(false);
  expect(
    normalizedFactMatches('trigger', fact('2026-11-09', '2026年11月9日上传电子送达文书')),
  ).toBe(false);
  expect(normalizedFactMatches('time', fact('03:00', '定于2026年11月10日下午3:00开庭'))).toBe(
    false,
  );
  expect(normalizedFactMatches('time', fact('15:00', '定于2026年11月10日下午3:00开庭'))).toBe(true);
  expect(normalizedFactMatches('time', fact('12:00', '中午12:00'))).toBe(true);
  expect(normalizedFactMatches('time', fact('05:00', '下午3:00至5:00'))).toBe(false);
  expect(
    normalizedFactMatches(
      'trigger',
      fact('2026-11-01', '落款2026年11月1日；送达回证2026年11月9日签收'),
    ),
  ).toBe(false);
  expect(
    normalizedFactMatches(
      'trigger',
      fact('2026-11-09', '落款2026年11月1日；送达回证2026年11月9日签收'),
    ),
  ).toBe(true);
});
it('counts natural days, adjusts only the last day, honors makeup workdays and versions both years', () => {
  expect(addNaturalDays('2026-09-24', 7)).toMatchObject({
    raw: '2026-10-01',
    date: '2026-10-08',
    versions: ['CN-2026-GBFM-2025-7-v1'],
  });
  expect(addNaturalDays('2026-09-25', 15)).toMatchObject({ raw: '2026-10-10', date: '2026-10-10' });
  expect(addNaturalDays('2026-11-09', 15).date).toBe('2026-11-24');
  expect(addNaturalDays('2026-11-09', 10).date).toBe('2026-11-19');
  expect(addNaturalDays('2026-12-25', 7)).toMatchObject({
    raw: '2027-01-01',
    date: '2027-01-04',
    versions: ['CN-2027-GBFM-2026-10-v1'],
  });
  expect(() => addNaturalDays('2027-12-31', 1)).toThrow('2028');
  expect(() => addNaturalDays('2026-02-30', 1)).toThrow('无效');
});
it('requires explicit applicability including evidence 55/56, does not shift a court specified date or invent an end', () => {
  const c: DateFactCandidate = {
    type_id: 'evidence',
    rule: 'court-natural-days',
    date: null,
    time: null,
    trigger: fact('2026-11-09', '2026年11月9日签收'),
    period: fact('15', '法院指定十五日内提交'),
    time_semantics: 'unknown',
    context: [],
    missing: [],
  };
  expect(evaluateDate(c, 0, { ...checks, evidence_55_56: false })).toMatchObject({
    status: 'needs_information',
    date: null,
  });
  expect(evaluateDate(c, 0, checks)).toMatchObject({ status: 'ready', date: '2026-11-24' });
  expect(
    evaluateDate(
      {
        ...c,
        rule: 'explicit',
        date: fact('2026-10-01', '2026年10月1日前提交'),
        trigger: null,
        period: null,
      },
      0,
      checks,
    ),
  ).toMatchObject({ date: '2026-10-01', calendar_versions: [] });
  expect(evaluateDate({ ...c, type_id: 'hearing' }, 0, checks).status).toBe('unsupported');
  expect(
    evaluateDate(
      { ...c, context: [{ source_id: id, page: 1, quote: '本案系刑事案件' }] },
      0,
      checks,
    ).status,
  ).toBe('unsupported');
});
