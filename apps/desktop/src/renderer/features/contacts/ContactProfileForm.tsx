import { useState } from 'react';
import type { Contact, ContactsRequest } from '../../../preload/caselite-api';
import type { ContactWrite } from './useContactsWrite';

export type ContactDraft = Pick<
  Contact,
  | 'name'
  | 'kind'
  | 'phone'
  | 'email'
  | 'wechat'
  | 'company'
  | 'position'
  | 'city'
  | 'relationship'
  | 'tags'
  | 'project_ids'
>;
const blank: ContactDraft = {
  name: '',
  kind: 'person',
  phone: '',
  email: '',
  wechat: '',
  company: '',
  position: '',
  city: '',
  relationship: '',
  tags: [],
  project_ids: [],
};
export default function ContactProfileForm({
  contact,
  projects,
  blocked,
  saveBlocked = false,
  pending,
  onSave,
  onCancel,
}: {
  contact?: Contact;
  projects: { id: string; title: string; archived_at?: string | null }[];
  blocked: boolean;
  saveBlocked?: boolean;
  pending?: ContactWrite;
  onSave(request: Extract<ContactsRequest, { operation: 'save' }>): void;
  onCancel(): void;
}) {
  const [expectedVersion] = useState(() => contact?.version ?? 0);
  const [identity] = useState(() => contact?.id ?? crypto.randomUUID());
  const [draft, setDraft] = useState<ContactDraft>(() =>
    contact
      ? (Object.fromEntries(
          Object.keys(blank).map((key) => [
            key,
            structuredClone(contact[key as keyof ContactDraft] ?? blank[key as keyof ContactDraft]),
          ]),
        ) as ContactDraft)
      : blank,
  );
  const [tagText, setTagText] = useState((contact?.tags ?? []).join('，'));
  const update = (key: keyof ContactDraft, value: string) =>
    setDraft((current) => ({ ...current, [key]: value }));
  return (
    <form
      className="customer-profile-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (pending?.operation === 'save') {
          onSave(pending);
          return;
        }
        onSave({
          protocol_version: 1,
          operation: 'save',
          contact_id: identity,
          expected_version: expectedVersion,
          receipt: crypto.randomUUID(),
          ...draft,
          tags: [
            ...new Set(
              tagText
                .split(/[,，]/u)
                .map((v) => v.trim())
                .filter(Boolean),
            ),
          ],
        });
      }}
    >
      <h2>{contact ? '编辑客户' : '新建客户'}</h2>
      <fieldset disabled={blocked || Boolean(pending)}>
        <label>
          姓名／名称
          <input
            aria-label="客户姓名"
            required
            maxLength={120}
            value={draft.name}
            onChange={(e) => update('name', e.target.value)}
          />
        </label>
        <label>
          类型
          <select value={draft.kind} onChange={(e) => update('kind', e.target.value)}>
            <option value="person">个人</option>
            <option value="organization">组织</option>
          </select>
        </label>
        {(
          [
            ['phone', '电话', 64],
            ['wechat', '微信', 80],
            ['email', '电子邮箱', 254],
            ['company', '单位', 160],
            ['position', '职务', 80],
            ['city', '城市', 80],
            ['relationship', '关系', 40],
          ] as const
        ).map(([key, label, max]) => (
          <label key={key}>
            {label}
            <input
              type={key === 'email' ? 'email' : key === 'phone' ? 'tel' : 'text'}
              maxLength={max}
              value={draft[key]}
              onChange={(e) => update(key, e.target.value)}
            />
          </label>
        ))}
        <label>
          标签
          <input
            aria-label="客户标签"
            value={tagText}
            onChange={(e) => setTagText(e.target.value)}
            placeholder="用逗号分隔"
          />
        </label>
        <label>
          关联项目
          <select
            multiple
            aria-label="关联项目"
            value={draft.project_ids}
            onChange={(e) =>
              setDraft({
                ...draft,
                project_ids: Array.from(e.target.selectedOptions, (v) => v.value),
              })
            }
          >
            {projects
              .filter((row) => !row.archived_at || draft.project_ids.includes(row.id))
              .map((row) => (
                <option key={row.id} value={row.id}>
                  {row.title}
                  {row.archived_at ? '（归档）' : ''}
                </option>
              ))}
          </select>
        </label>
      </fieldset>
      <div className="contacts-actions">
        <button type="submit" className="primary" disabled={blocked || (saveBlocked && !pending)}>
          {pending ? '核对原提交' : '保存客户'}
        </button>
        <button type="button" disabled={blocked || Boolean(pending)} onClick={onCancel}>
          取消
        </button>
      </div>
    </form>
  );
}
