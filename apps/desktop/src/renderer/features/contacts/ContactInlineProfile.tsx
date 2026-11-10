import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Contact, ContactsRequest } from '../../../preload/caselite-api';
import type { ContactWrite } from './useContactsWrite';

type Save = Extract<ContactsRequest, { operation: 'save' }>;
type Field =
  'name' | 'kind' | 'company' | 'position' | 'phone' | 'wechat' | 'email' | 'address' | 'tags';
const labels: Record<Field, string> = {
  name: '姓名／名称',
  kind: '类型',
  company: '单位',
  position: '职务',
  phone: '电话',
  wechat: '微信',
  email: '邮箱',
  address: '地址',
  tags: '标签',
};
const limits: Partial<Record<Field, number>> = {
  name: 120,
  phone: 64,
  wechat: 80,
  email: 254,
  company: 160,
  position: 80,
  address: 500,
};
const fields = Object.keys(labels) as Field[];
export function profileRequest(contact: Contact): Save {
  return {
    protocol_version: 1,
    operation: 'save',
    contact_id: contact.id,
    expected_version: contact.version,
    receipt: crypto.randomUUID(),
    name: contact.name,
    kind: contact.kind,
    address: contact.address,
    phone: contact.phone,
    email: contact.email,
    wechat: contact.wechat,
    company: contact.company,
    position: contact.position,
    city: contact.city,
    relationship: contact.relationship,
    tags: [...contact.tags],
    project_ids: [...contact.project_ids],
  };
}
function text(contact: Contact, field: Field) {
  return field === 'tags' ? contact.tags.join('，') : contact[field];
}
export default function ContactInlineProfile({
  contact,
  disabled,
  busy,
  pending,
  identityTarget,
  onDirty,
  onSave,
  onCancel,
}: {
  contact: Contact;
  disabled: boolean;
  busy: boolean;
  pending?: ContactWrite;
  identityTarget?: HTMLElement | null;
  onDirty(value: boolean): void;
  onSave(request: Save): Promise<Contact | undefined>;
  onCancel(): void;
}) {
  const [edit, setEdit] = useState<{ field: Field; snapshot: Contact; value: string }>();
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [affiliationOpen, setAffiliationOpen] = useState(false);
  const submitting = useRef(false);
  const composing = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const triggers = useRef(new Map<Field, HTMLButtonElement>());
  const isEditing = Boolean(edit);
  useEffect(() => {
    onDirty(isEditing);
    return () => onDirty(false);
  }, [isEditing, onDirty]);
  const start = (field: Field, snapshot = contact) => {
    if (disabled || busy || pending || edit) return;
    setError('');
    setSaved('');
    setEdit({ field, snapshot: structuredClone(snapshot), value: text(snapshot, field) });
  };
  const cancel = () => {
    if (!edit || busy || pending || submitting.current) return;
    const field = edit.field;
    setEdit(undefined);
    setError('');
    onCancel();
    requestAnimationFrame(() => triggers.current.get(field)?.focus({ preventScroll: true }));
  };
  const commit = async (next?: Field) => {
    if (!edit || busy || pending || disabled || composing.current || submitting.current) return;
    const field = edit.field;
    const value = edit.value.trim();
    if (value === text(edit.snapshot, field)) {
      setEdit(undefined);
      setError('');
      onCancel();
      requestAnimationFrame(() =>
        triggers.current.get(next ?? field)?.focus({ preventScroll: true }),
      );
      return;
    }
    const request = profileRequest(edit.snapshot);
    if (field === 'tags')
      request.tags = [
        ...new Set(
          value
            .split(/[,，]/u)
            .map((v) => v.trim())
            .filter(Boolean),
        ),
      ];
    else if (field === 'kind') request.kind = value as Contact['kind'];
    else request[field] = value;
    const invalid =
      value.includes('\0') ||
      (field === 'name' && !value) ||
      (field === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value)) ||
      (field === 'tags' &&
        (request.tags!.length > 20 || request.tags!.some((tag) => tag.length > 40))) ||
      (limits[field] !== undefined && value.length > limits[field]!);
    if (invalid) {
      setError(
        field === 'email'
          ? '请输入有效邮箱，或清空此项。'
          : field === 'tags'
            ? '最多20个标签，每个不超过40字。'
            : `请检查${labels[field]}，姓名不能为空，内容不能超出长度限制。`,
      );
      return;
    }
    submitting.current = true;
    try {
      const savedContact = await onSave(request);
      if (!savedContact) return;
      setError('');
      setSaved(`${labels[field]}已保存`);
      if (next)
        setEdit({
          field: next,
          snapshot: structuredClone(savedContact),
          value: text(savedContact, next),
        });
      else {
        setEdit(undefined);
        requestAnimationFrame(() => triggers.current.get(field)?.focus({ preventScroll: true }));
      }
    } finally {
      submitting.current = false;
    }
  };
  const cell = (field: Field, content?: ReactNode) =>
    edit?.field === field ? (
      <form
        className="customer-inline-editor"
        aria-label={`编辑${labels[field]}`}
        onSubmit={(event) => {
          event.preventDefault();
          void commit();
        }}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) void commit();
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.keyCode === 229 || composing.current) return;
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            cancel();
          }
          if (event.key === 'Tab' && !event.shiftKey) {
            event.preventDefault();
            void commit(fields[(fields.indexOf(field) + 1) % fields.length]);
          }
        }}
      >
        <div className="customer-inline-controls">
          {field === 'kind' ? (
            <select
              autoFocus
              aria-label={labels[field]}
              value={edit.value}
              disabled={busy || Boolean(pending)}
              onChange={(event) => setEdit({ ...edit, value: event.target.value })}
            >
              <option value="person">个人</option>
              <option value="organization">组织</option>
            </select>
          ) : (
            <input
              autoFocus
              aria-label={labels[field]}
              value={edit.value}
              type={field === 'email' ? 'email' : field === 'phone' ? 'tel' : 'text'}
              maxLength={limits[field]}
              disabled={busy || Boolean(pending)}
              onCompositionStart={() => {
                composing.current = true;
              }}
              onCompositionEnd={() => {
                composing.current = false;
              }}
              onKeyDown={(event) => {
                if (
                  event.key === 'Enter' &&
                  (event.nativeEvent.isComposing || event.keyCode === 229 || composing.current)
                )
                  event.preventDefault();
              }}
              onChange={(event) => {
                setError('');
                setEdit({ ...edit, value: event.target.value });
              }}
            />
          )}
          <button
            type="submit"
            aria-label={`保存${labels[field]}`}
            disabled={disabled || busy || Boolean(pending)}
          >
            ✓
          </button>
          <button
            type="button"
            aria-label={`取消编辑${labels[field]}`}
            disabled={busy || Boolean(pending)}
            onClick={cancel}
          >
            ×
          </button>
        </div>
        <small className="caption">{busy ? '正在保存…' : 'Enter 保存 · Esc 取消'}</small>
        {error && <p role="alert">{error}</p>}
        {contact.version !== edit.snapshot.version && !pending && (
          <div className="customer-inline-conflict" role="status">
            最新{labels[field]}：{text(contact, field) || '未设置'}。本地输入已保留。
            <button
              type="button"
              disabled={busy || disabled}
              onClick={() => {
                setEdit({ ...edit, snapshot: structuredClone(contact) });
                onCancel();
              }}
            >
              保留我的输入，采用最新版本继续
            </button>
          </div>
        )}
      </form>
    ) : (
      <button
        type="button"
        className="customer-inline-value"
        aria-label={`编辑${labels[field]}`}
        ref={(element) => {
          if (element) triggers.current.set(field, element);
          else triggers.current.delete(field);
        }}
        disabled={disabled || busy || Boolean(pending) || Boolean(edit)}
        onClick={() => start(field)}
      >
        {content ?? (text(contact, field) || <span className="caption">添加{labels[field]}</span>)}
        <span className="customer-inline-pencil" aria-hidden="true">
          ✎
        </span>
      </button>
    );
  const identity = (
    <>
      <header className="customer-identity">
        <span className="customer-avatar" aria-hidden="true">
          {contact.name.slice(0, 1)}
        </span>
        <div>
          <h2>{cell('name')}</h2>
          <div className="customer-identity-types">
            {cell(
              'kind',
              <span className="customer-pill">{contact.kind === 'person' ? '个人' : '组织'}</span>,
            )}
          </div>
        </div>
      </header>
      <details
        className="customer-affiliation"
        open={affiliationOpen || edit?.field === 'company' || edit?.field === 'position'}
        onToggle={(event) => setAffiliationOpen(event.currentTarget.open)}
      >
        <summary>单位与职务{contact.company ? ` · ${contact.company}` : '（选填）'}</summary>
        <div>
          {cell('company')}
          <span aria-hidden="true"> · </span>
          {cell('position')}
        </div>
      </details>
    </>
  );
  return (
    <div ref={root} className="customer-inline-profile">
      {identityTarget ? createPortal(identity, identityTarget) : identity}
      {identityTarget && (
        <h2 className="customer-profile-heading">
          联系人资料 <small>点击内容直接编辑</small>
        </h2>
      )}
      <dl className="customer-facts">
        {(['phone', 'wechat', 'email', 'address'] as const).map((field) => (
          <div key={field}>
            <dt>{labels[field]}</dt>
            <dd>{cell(field)}</dd>
            {contact[field] && (
              <button
                type="button"
                title={`复制${labels[field]}`}
                aria-label={`复制${labels[field]}`}
                onClick={() => void navigator.clipboard.writeText(contact[field]).catch(() => {})}
              >
                ⧉
              </button>
            )}
          </div>
        ))}
      </dl>
      <div className="customer-tags">
        <span>标签</span>
        {cell(
          'tags',
          <>
            {contact.tags.map((tag) => (
              <span className="customer-pill" key={tag}>
                {tag}
              </span>
            ))}
            <span aria-hidden="true">＋</span>
          </>,
        )}
      </div>
      <span className="customer-inline-status" role="status">
        {saved}
      </span>
    </div>
  );
}
