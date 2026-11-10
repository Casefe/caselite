import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Contact, ContactSourceRef } from '../../../preload/caselite-api';
import type { ContactWrite } from './useContactsWrite';

type SourceOption = { ref: ContactSourceRef; title: string };
export default function ContactSourcePicker({
  contact,
  refs,
  scopes,
  blocked,
  pending,
  onSave,
  onCancel,
}: {
  contact: Contact;
  refs: ContactSourceRef[];
  scopes: { value: string; label: string }[];
  blocked: boolean;
  pending?: ContactWrite;
  onSave(request: ContactWrite): Promise<unknown>;
  onCancel(): void;
}) {
  const [snapshot] = useState(() => structuredClone(contact));
  const [kind, setKind] = useState<ContactSourceRef['kind']>('run');
  const [scope, setScope] = useState(`contact:${contact.id}`);
  const [selected, setSelected] = useState(refs);
  const options = scopes.filter(
    (row) =>
      kind === 'run' ||
      (kind === 'payment'
        ? row.value.startsWith('project:')
        : !row.value.includes(':') && row.value !== 'home'),
  );
  const activeScope = options.some((row) => row.value === scope) ? scope : options[0]?.value;
  const sourceRead = useQuery({
    queryKey: ['contacts', 'source-options', kind, activeScope],
    enabled: Boolean(activeScope),
    queryFn: async (): Promise<SourceOption[]> => {
      if (!activeScope) return [];
      if (kind === 'run') {
        const result = await window.caselite.agent({
          protocol_version: 1,
          operation: 'read',
          scope: activeScope,
        });
        if (!result.ok) throw Error('对话来源暂不可读，请重试。');
        return result.runs
          .filter((run) => !run.purpose)
          .map((run) => ({
            ref: { kind, id: run.id, scope: activeScope },
            title: `${run.prompt.slice(0, 100)} · ${run.created_at?.slice(0, 10) ?? '日期未记录'}`,
          }));
      }
      if (kind === 'material') {
        const result = await window.caselite.material({
          protocol_version: 1,
          operation: 'list',
          scope: activeScope,
        });
        if (!result.ok) throw Error('任务材料暂不可读，请重试。');
        return result.materials.map((file) => ({
          ref: { kind, id: file.id, scope: activeScope },
          title: file.name,
        }));
      }
      const projectId = activeScope.slice('project:'.length);
      const result = await window.caselite.finance({
        protocol_version: 1,
        operation: 'read',
        project_id: projectId,
      });
      if (!result.ok || result.kind !== 'ledger') throw Error('项目账款暂不可读，请重试。');
      return (result.ledger?.payments ?? []).map((payment) => ({
        ref: { kind, id: payment.id, scope: projectId },
        title: `${payment.reversed_at ? '已冲销 · ' : ''}¥${(payment.amount_cents / 100).toFixed(2)} · ${payment.occurred_on ?? payment.committed_at.slice(0, 10)} ${payment.note ?? ''}`,
      }));
    },
  });
  return (
    <form
      className="customer-source-picker"
      aria-label="关联往来来源"
      onSubmit={async (event) => {
        event.preventDefault();
        if (blocked || sourceRead.error || sourceRead.isFetching) return;
        await onSave(
          pending ?? {
            protocol_version: 1,
            operation: 'set_source_links',
            contact_id: snapshot.id,
            expected_version: snapshot.version,
            receipt: crypto.randomUUID(),
            kind,
            source_refs: selected.filter((ref) => ref.kind === kind),
          },
        );
      }}
    >
      <p className="caption">
        选择与此联系人有关的现有记录，保留原始来源。微信截图可在原任务的材料区添加，再关联到这里。
      </p>
      <fieldset disabled={blocked || Boolean(pending)}>
        <label>
          来源类型
          <select
            aria-label="往来来源类型"
            value={kind}
            onChange={(event) => setKind(event.target.value as typeof kind)}
          >
            <option value="run">AI 对话</option>
            <option value="material">任务材料／微信截图</option>
            <option value="payment">项目收款</option>
          </select>
        </label>
        <label>
          所在位置
          <select
            aria-label="来源所在位置"
            value={activeScope ?? ''}
            onChange={(event) => setScope(event.target.value)}
          >
            {options.map((row) => (
              <option key={row.value} value={row.value}>
                {row.label}
              </option>
            ))}
          </select>
        </label>
        {sourceRead.isFetching && <p role="status">正在读取来源…</p>}
        {sourceRead.error && (
          <p role="alert">
            {sourceRead.error.message}
            <button type="button" onClick={() => void sourceRead.refetch()}>
              重试
            </button>
          </p>
        )}
        {sourceRead.data?.map((option) => (
          <label className="customer-source-option" key={option.ref.id}>
            <input
              type="checkbox"
              checked={selected.some((ref) => ref.kind === kind && ref.id === option.ref.id)}
              onChange={(event) =>
                setSelected((rows) => [
                  ...rows.filter((ref) => !(ref.kind === kind && ref.id === option.ref.id)),
                  ...(event.target.checked ? [option.ref] : []),
                ])
              }
            />
            {option.title}
          </label>
        ))}
        {sourceRead.data?.length === 0 && <p>此位置暂无可选来源。</p>}
        <p className="caption">
          此类型已选 {selected.filter((ref) => ref.kind === kind).length}{' '}
          项。切换位置可继续选择，取消勾选只移除关联。
        </p>
      </fieldset>
      <div className="contacts-actions">
        <button
          type="submit"
          disabled={blocked || Boolean(sourceRead.error) || sourceRead.isFetching || !activeScope}
        >
          {pending ? '核对原提交' : '保存来源关联'}
        </button>
        <button type="button" disabled={blocked || Boolean(pending)} onClick={onCancel}>
          取消
        </button>
      </div>
    </form>
  );
}
