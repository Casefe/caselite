import { useEffect, useState } from 'react';
import type { AgentResponse, CalendarType } from '../../../preload/caselite-api';
type Rules = NonNullable<Extract<AgentResponse, { ok: true }>['date_rules']>;
export default function DateRuleSettings({ types }: { types: CalendarType[] }) {
  const [rules, setRules] = useState<Rules>(),
    [error, setError] = useState('');
  useEffect(() => {
    if (typeof window.caselite?.agent !== 'function') return;
    let stopped = false;
    void window.caselite
      .agent({ protocol_version: 1, operation: 'date_rules' })
      .then((r) => {
        if (stopped) return;
        if (r.ok && r.date_rules) setRules(r.date_rules);
        else setError('日期规则暂不可读取');
      })
      .catch(() => {
        if (!stopped) setError('日期规则暂不可读取');
      });
    return () => {
      stopped = true;
    };
  }, []);
  return (
    <section aria-label="重要日期识别依据">
      <h3>重要日期识别依据</h3>
      <p>
        只分析明确选择的固定PDF/DOCX。原文位置核对不等于法律适用已确认；没有通用公式时仅提取明确日期或返回缺件。律师确认后写同Task的重要关注，不自动改工作安排、截止日或创建提醒。
      </p>
      {error && <p role="alert">{error}</p>}
      {rules && (
        <>
          <p>规则版本 {rules.version} · 法域：中国大陆；相对公式仅已确认适用的普通民事。</p>
          {types.map((t) => {
            const info =
              rules.types.find((r) => r.type_id === t.id) ??
              rules.types.find((r) => r.type_id === 'custom')!;
            return (
              <details key={t.id}>
                <summary>
                  {t.name}
                  {!t.enabled ? '（已停用，旧依据保留）' : ''}
                </summary>
                <p>文书：{info.documents}</p>
                <p>公式／边界：{info.support}</p>
                <p>
                  规则ID：
                  {t.id === 'remedy'
                    ? 'civil-judgment-15 / civil-order-10'
                    : t.id === 'payment'
                      ? 'civil-plaintiff-fee-7'
                      : t.id === 'evidence' ||
                          t.id === 'court-submission' ||
                          t.id === 'filing' ||
                          t.id === 'appraisal'
                        ? 'court-natural-days'
                        : 'explicit'}
                  ；版本 {rules.version}
                </p>
                <p>
                  自然日起算排除起始日，逐日连续累加，仅末日按已核验休假/调休日历顺延。明确指定日不擅改；“日前”包含性/渠道/时刻待核对，不补23:59，工作日计算未支持。
                </p>
                <p>
                  适用事实与缺口：{Object.values(rules.checks).join('；')}
                  。刑事、行政、涉外、终审、保全/执行/时效复杂规则不套此公式。未知年份或来源无法核实不可确认。
                </p>
                {rules.laws.map((l) => (
                  <p key={l.url}>
                    {l.title} · 生效 {l.effective}
                    <br />
                    <span className="date-source-url">{l.url}</span>
                  </p>
                ))}
                <p>历法版本：{rules.calendars.map((c) => `${c.year}：${c.id}`).join('；')}</p>
              </details>
            );
          })}
          <details>
            <summary>已核验年度日历来源</summary>
            {rules.calendars.map((c) => (
              <p key={c.id}>
                {c.id}
                <br />
                <span className="date-source-url">{c.url}</span>
              </p>
            ))}
            <p>规则或历法更新只影响新候选；旧确认保留原版本和计算过程。</p>
          </details>
        </>
      )}
    </section>
  );
}
