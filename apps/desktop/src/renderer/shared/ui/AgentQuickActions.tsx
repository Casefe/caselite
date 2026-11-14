import { Icon } from './Icon';

type PageKind = 'document' | 'project' | 'task' | 'contact';
const actions: Record<PageKind, readonly { label: string; icon: string; prompt: string }[]> = {
  document: [
    {
      label: '总结此页面',
      icon: 'list',
      prompt: '请总结当前引用内容，提炼主要观点、关键信息和待核实事项。',
    },
    {
      label: '尝试剖析',
      icon: 'search',
      prompt: '请剖析当前引用内容，梳理问题、依据、可能的风险和信息缺口，区分已有信息与推断。',
    },
    {
      label: '创建任务',
      icon: 'check',
      prompt:
        '请根据当前引用内容起草待办任务，列出任务名称、目标和步骤，供我核对后手动创建；不要推定缺失的期限。',
    },
  ],
  project: [
    {
      label: '总结此项目',
      icon: 'list',
      prompt: '请总结当前引用的项目信息，梳理目标、当前状态和待明确事项。',
    },
    {
      label: '梳理下一步',
      icon: 'search',
      prompt:
        '请根据当前引用的项目信息梳理下一步工作建议，标明需要补充的信息，不推定未引用的任务或材料。',
    },
    {
      label: '创建任务',
      icon: 'check',
      prompt:
        '请根据当前引用的项目信息起草待办任务，列出任务名称、目标和步骤，供我核对后手动创建；不要推定缺失的期限。',
    },
  ],
  task: [
    {
      label: '总结此任务',
      icon: 'list',
      prompt: '请总结当前引用的任务信息，提炼工作目标、已知要求和待明确事项。',
    },
    {
      label: '拆解工作步骤',
      icon: 'search',
      prompt: '请根据当前引用的任务信息拆解可执行的工作步骤，列出需要补充的信息和核对要点。',
    },
    {
      label: '创建任务',
      icon: 'check',
      prompt:
        '请根据当前引用的任务信息起草后续待办任务，列出任务名称、目标和步骤，供我核对后手动创建；不要推定缺失的期限。',
    },
  ],
  contact: [
    {
      label: '总结客户信息',
      icon: 'list',
      prompt: '请总结当前引用的客户信息，梳理已知情况和待补充的信息，不推定未引用的沟通记录。',
    },
    {
      label: '梳理沟通要点',
      icon: 'search',
      prompt: '请根据当前引用的客户信息整理下次沟通的要点和待确认问题。',
    },
    {
      label: '创建任务',
      icon: 'check',
      prompt:
        '请根据当前引用的客户信息起草跟进任务，列出任务名称、目标和步骤，供我核对后手动创建；不要推定缺失的期限。',
    },
  ],
};

export default function AgentQuickActions({
  kind,
  disabled,
  onSelect,
}: {
  kind: PageKind;
  disabled: boolean;
  onSelect(prompt: string): void;
}) {
  return (
    <div className="agent-quick-actions" role="group" aria-label="AI 常用功能">
      {actions[kind].map((action) => (
        <button
          type="button"
          key={action.label}
          disabled={disabled}
          title="填入问题，编辑后发送"
          onClick={() => onSelect(action.prompt)}
        >
          <Icon name={action.icon} size={19} />
          <span>{action.label}</span>
        </button>
      ))}
    </div>
  );
}
