// 只读展示词汇供属性表单与 AI 上下文预览共用，不包含编辑或保存状态。
export const projectTypes = {
  general: '通用',
  litigation: '诉讼（未细分）',
  civil_litigation: '民事诉讼',
  criminal_litigation: '刑事诉讼',
  commercial_arbitration: '商事仲裁',
  non_litigation: '非诉项目',
  contract_review: '合同审查',
};
export const projectStatuses = { planned: '待开始', active: '进行中', done: '已完成' };

export const projectHealthNames = {
  on_track: '正常',
  at_risk: '有风险',
  off_track: '偏离计划',
} as const;
