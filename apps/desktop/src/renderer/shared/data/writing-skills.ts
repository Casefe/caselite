import type { WritingSkill } from '../../../preload/caselite-api';

// 默认指令只用于缺省展示；保存后的个人配置由原 LocalPreferences 拥有。
export const defaultWritingSkills: readonly WritingSkill[] = [
  {
    id: 'improve-writing',
    name: '提升法律表达',
    enabled: true,
    instruction:
      '改进所选文字的清晰度、逻辑与法律文书表达，删去冗词。保留原有事实、主体、金额、日期、引文及权利义务，不新增法律结论。只输出修改后的纯文本。',
  },
  {
    id: 'proofread',
    name: '校对与一致性检查',
    enabled: true,
    instruction:
      '校对所选文字的错别字、标点、语法和称谓、术语一致性。保留事实、金额、日期、引文和权利义务；对无法确认的实质疑点保留原文，不猜测修正。只输出校对后的纯文本。',
  },
  {
    id: 'explain',
    name: '解释条款',
    enabled: true,
    instruction:
      '用便于客户理解的语言解释所选文字的含义、主体义务和适用条件。区分原文明确内容与未明确事项，不推定缺失事实，不编造法条或将解释当成已核验的法律结论。输出简洁的纯文本说明。',
  },
  {
    id: 'summarize',
    name: '摘要与要点提炼',
    enabled: true,
    instruction:
      '精简概括所选文字，提炼主体、事项、条件、时间与关键结论。保留关键限定、例外、金额、日期和原有引文，不添加原文没有的事实或法律依据。只输出纯文本摘要。',
  },
  {
    id: 'reformat',
    name: '重新组织格式',
    enabled: true,
    instruction:
      '在不改变事实、结论和权利义务的前提下，整理所选文字的句序、层次与编号。必要时用分行和“一、（一）1.”等纯文本编号，不输出 Markdown 标记或 HTML，不新增标题之外的实质内容。只输出整理后的纯文本。',
  },
];
export const writingSkills = (skills?: WritingSkill[]) => skills ?? defaultWritingSkills;
