import { useState } from 'react';
import type { AgentRun } from '../../../preload/caselite-api';
import { contactBody, contactChannels } from './ContactEntryForm';
import type { ContactWrite } from './useContactsWrite';

export default function ContactRecordCard({
  run,
  contactId,
  saved,
  blocked,
  pending,
  onSave,
  onContinue,
}: {
  run: AgentRun;
  contactId: string;
  saved: boolean;
  blocked: boolean;
  pending?: ContactWrite;
  onSave(request: ContactWrite): Promise<boolean>;
  onContinue?(): void;
}) {
  const [error, setError] = useState('');
  const [request, setRequest] = useState<ContactWrite>();
  const candidate = run.contact_record_candidate;
  if (!candidate || run.status !== 'succeeded' || run.output_incomplete) return null;
  const original =
    pending?.operation === 'save_entry' && pending.source_run_id === run.id ? pending : undefined;
  return (
    <article className="customer-record-card" aria-label="AI联系记录候选">
      <header>
        <strong>{candidate.title}</strong>
        <span className="customer-pill">{saved ? '已保存' : '待保存'}</span>
      </header>
      <p className="caption">
        {contactChannels[candidate.channel]} · {candidate.occurred_on ?? '日期未注明'}
      </p>
      <p>{candidate.summary}</p>
      {error && <p role="alert">{error}</p>}
      <button
        type="button"
        className="primary"
        disabled={saved || blocked || Boolean(pending && !original)}
        onClick={async () => {
          const next = original ??
            request ?? {
              protocol_version: 1 as const,
              operation: 'save_entry' as const,
              contact_id: contactId,
              entry_id: run.id,
              receipt: crypto.randomUUID(),
              expected_version: 0,
              kind: 'communication' as const,
              title: candidate.title,
              channel: candidate.channel,
              occurred_on: candidate.occurred_on,
              state: contactBody(candidate.summary),
              source_run_id: run.id,
            };
          setRequest(next);
          if (!(await onSave(next))) setError('尚未确认保存，请核对原提交。');
          else setError('');
        }}
      >
        {saved ? '已保存为联系记录' : original ? '核对原提交' : '保存为联系记录'}
      </button>
      <button
        type="button"
        disabled={blocked || Boolean(pending) || !onContinue}
        onClick={onContinue}
      >
        继续修改
      </button>
      {!saved && <small>可继续对话补充或修改；保存后出现在联系记录中。</small>}
    </article>
  );
}
