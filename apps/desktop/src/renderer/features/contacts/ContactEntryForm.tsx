import { useState } from 'react';
import * as Y from 'yjs';
import type { ContactEntry, ContactsRequest } from '../../../preload/caselite-api';
import { draftDoc } from '../../editors/editor-state';
import type { ContactWrite } from './useContactsWrite';

export const contactChannels = {
  phone: '电话',
  wechat: '微信',
  email: '邮件',
  meeting: '当面',
  other: '其他',
} as const;
export function contactBody(text: string) {
  const doc = draftDoc({ text, state: null });
  try {
    return Array.from(Y.encodeStateAsUpdate(doc));
  } finally {
    doc.destroy();
  }
}
export default function ContactEntryForm({
  contactId,
  kind,
  entry,
  pending,
  blocked,
  onSave,
  onCancel,
}: {
  contactId: string;
  kind: 'communication' | 'note';
  entry?: ContactEntry;
  pending?: ContactWrite;
  blocked: boolean;
  onSave(request: Extract<ContactsRequest, { operation: 'save_entry' }>): void;
  onCancel(): void;
}) {
  const [identity] = useState(() => entry?.id ?? crypto.randomUUID());
  const [title, setTitle] = useState(entry?.title ?? '');
  const [content, setContent] = useState(entry?.content ?? '');
  const [channel, setChannel] = useState(entry?.channel ?? 'other');
  const [date, setDate] = useState(entry?.occurred_on ?? '');
  return (
    <form
      className="customer-entry-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (pending?.operation === 'save_entry') {
          onSave(pending);
          return;
        }
        onSave({
          protocol_version: 1,
          operation: 'save_entry',
          contact_id: contactId,
          entry_id: identity,
          receipt: crypto.randomUUID(),
          expected_version: entry?.version ?? 0,
          kind,
          title,
          channel,
          occurred_on: date || null,
          state: contactBody(content),
          ...(entry?.source_run_id ? { source_run_id: entry.source_run_id } : {}),
        });
      }}
    >
      <fieldset disabled={blocked || Boolean(pending)}>
        <label>
          标题
          <input
            required
            maxLength={120}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        {kind === 'communication' && (
          <>
            <label>
              沟通方式
              <select
                value={channel}
                onChange={(e) => setChannel(e.target.value as typeof channel)}
              >
                {Object.entries(contactChannels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              联系日期
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
          </>
        )}
        <label>
          {kind === 'note' ? '备注内容' : '沟通内容'}
          <textarea
            required
            rows={5}
            maxLength={8000}
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
        </label>
      </fieldset>
      <div className="contacts-actions">
        <button type="submit" className="primary" disabled={blocked}>
          {pending ? '核对原提交' : '保存记录'}
        </button>
        <button type="button" disabled={blocked || Boolean(pending)} onClick={onCancel}>
          取消
        </button>
      </div>
    </form>
  );
}
