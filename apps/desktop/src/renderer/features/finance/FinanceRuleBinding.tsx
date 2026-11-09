import { useState } from 'react';
import type { Matter } from '../../../preload/caselite-api';
import type { FinanceManagementController } from './useFinanceManagement';
export default function FinanceRuleBinding({
  project,
  finance,
  disabled,
}: {
  project: Matter;
  finance: FinanceManagementController;
  disabled: boolean;
}) {
  const [ruleId, setRuleId] = useState('');
  const state = finance.state;
  const binding = state?.bindings.find((row) => row.project_id === project.id);
  return (
    <div className="finance-rule-binding">
      <label>
        本案结算规则
        <select
          aria-label="本案结算规则"
          disabled={disabled || !!project.archived_at}
          value={ruleId || binding?.rule_id || ''}
          onChange={(event) => {
            setRuleId(event.target.value);
            finance.markDirty(`rule:${project.id}`);
          }}
        >
          <option value="">选择已保存规则</option>
          {state?.rules.map((rule) => (
            <option key={rule.id} value={rule.id}>
              {rule.name}
            </option>
          ))}
        </select>
      </label>
      <button
        disabled={disabled || !ruleId || !!project.archived_at}
        onClick={() =>
          void finance.submit({
            operation: 'm_bind_rule',
            project_id: project.id,
            rule_id: ruleId,
            expected_rule_id: binding?.rule_id ?? null,
          })
        }
      >
        采用此规则
      </button>
      <span className="finance-muted">历史结算按原快照保留。</span>
    </div>
  );
}
