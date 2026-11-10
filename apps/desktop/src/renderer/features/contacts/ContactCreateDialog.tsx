import { useEffect, useRef, useState } from 'react';
import type { Contact, Matter } from '../../../preload/caselite-api';
import { Icon } from '../../shared/ui/Icon';
import { useContactsWrite } from './useContactsWrite';
import type { ContactDraft } from './ContactProfileForm';

export default function ContactCreateDialog({
  projects,
  catalogReady,
  onRetryProjects,
  onCreated,
  onCancel,
}: {
  projects: Matter[];
  catalogReady: boolean;
  onRetryProjects(): void;
  onCreated(contact: Contact): void;
  onCancel(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const composing = useRef(false);
  const actions = useContactsWrite('new');
  const original = actions.pending?.operation === 'save' ? actions.pending : undefined;
  const [identity] = useState(() => original?.contact_id ?? crypto.randomUUID());
  const [draft, setDraft] = useState<ContactDraft>(() => ({
    name: original?.name ?? '',
    kind: original?.kind ?? 'person',
    phone: original?.phone ?? '',
    wechat: original?.wechat ?? '',
    email: original?.email ?? '',
    address: original?.address ?? '',
    company: original?.company ?? '',
    position: original?.position ?? '',
    city: original?.city ?? '',
    relationship: original?.relationship ?? '',
    tags: original?.tags ?? [],
    project_ids: original?.project_ids ?? [],
  }));
  const [tagText, setTagText] = useState(() => (original?.tags ?? []).join('，'));
  const [discarding, setDiscarding] = useState(false);
  const locked = actions.busy || Boolean(actions.pending);
  const tags = [
    ...new Set(
      tagText
        .split(/[,，]/u)
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  ];
  const invalidTags = tags.length > 20 || tags.some((tag) => tag.length > 40);
  const dirty =
    draft.kind !== 'person' ||
    draft.project_ids.length > 0 ||
    Boolean(tagText) ||
    Object.entries(draft).some(
      ([key, value]) => !['kind', 'tags', 'project_ids'].includes(key) && Boolean(value),
    );
  const update = (key: keyof ContactDraft, value: string) =>
    setDraft((current) => ({ ...current, [key]: value }));
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement;
    element?.showModal();
    element?.querySelector('input')?.focus();
    return () => {
      element?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  const dismiss = () => {
    if (locked) return;
    actions.clearError();
    onCancel();
  };
  const cancel = () => {
    if (locked || composing.current) return;
    if (discarding) setDiscarding(false);
    else if (dirty) setDiscarding(true);
    else dismiss();
  };
  return (
    <dialog
      ref={dialog}
      className="contact-create-dialog"
      aria-labelledby="contact-create-title"
      onCancel={(event) => {
        event.preventDefault();
        cancel();
      }}
    >
      <form
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
        }}
        onKeyDown={(event) => {
          if (
            event.key === 'Enter' &&
            (composing.current || event.nativeEvent.isComposing || event.keyCode === 229)
          )
            event.preventDefault();
        }}
        onSubmit={async (event) => {
          event.preventDefault();
          if (composing.current || actions.busy || discarding) return;
          if (!actions.pending && (!draft.name.trim() || invalidTags || !catalogReady)) return;
          // 未知结果只核对原请求；关闭浮层或列表刷新不能换掉提交身份。
          const request = actions.pending ?? {
            protocol_version: 1 as const,
            operation: 'save' as const,
            contact_id: identity,
            expected_version: 0,
            receipt: crypto.randomUUID(),
            ...draft,
            name: draft.name.trim(),
            tags,
          };
          const response = await actions.write(request);
          const saved = response?.contacts.find((row) => row.id === request.contact_id);
          if (saved) onCreated(saved);
        }}
      >
        <header className="contact-create-header">
          <div className="contact-create-context">
            <span>工作区</span>
            <Icon name="chevron" size={13} />
            <span>
              <Icon name="person" size={15} /> 联系人
            </span>
          </div>
          <button type="button" aria-label="关闭新建联系人" disabled={locked} onClick={cancel}>
            ×
          </button>
        </header>
        <div className="contact-create-content">
          <h2 id="contact-create-title" className="sr-only">
            新建联系人
          </h2>
          <fieldset disabled={locked || discarding}>
            <div className="contact-create-identity">
              <span className="contact-create-avatar" aria-hidden="true">
                {draft.name.trim().slice(0, 1) || <Icon name="person" size={25} />}
              </span>
              <label>
                <span className="sr-only">联系人姓名</span>
                <input
                  aria-label="联系人姓名"
                  required
                  maxLength={120}
                  value={draft.name}
                  placeholder="姓名／名称"
                  onChange={(event) => update('name', event.target.value)}
                />
              </label>
            </div>
            <div className="contact-create-kind">
              <label>
                <span className="sr-only">联系人类型</span>
                <select value={draft.kind} onChange={(event) => update('kind', event.target.value)}>
                  <option value="person">个人</option>
                  <option value="organization">组织</option>
                </select>
              </label>
              <span>填写姓名即可创建，其余资料可稍后补充</span>
            </div>
            <div className="contact-create-fields">
              {(
                [
                  ['phone', '电话', '填写电话号码', 64],
                  ['wechat', '微信', '填写微信号', 80],
                  ['email', '电子邮箱', '填写电子邮箱', 254],
                  ['address', '地址', '填写联系地址', 500],
                ] as const
              ).map(([key, label, placeholder, maxLength]) => (
                <label key={key}>
                  {label}
                  <input
                    type={key === 'email' ? 'email' : key === 'phone' ? 'tel' : 'text'}
                    value={draft[key]}
                    maxLength={maxLength}
                    placeholder={placeholder}
                    onChange={(event) => update(key, event.target.value)}
                  />
                </label>
              ))}
            </div>
            <details
              className="contact-create-affiliation"
              open={Boolean(original?.company || original?.position) || undefined}
            >
              <summary>
                单位与职务 <span>选填</span>
              </summary>
              <div className="contact-create-fields">
                <label>
                  单位
                  <input
                    maxLength={160}
                    value={draft.company}
                    placeholder="填写单位名称"
                    onChange={(event) => update('company', event.target.value)}
                  />
                </label>
                <label>
                  职务
                  <input
                    maxLength={80}
                    value={draft.position}
                    placeholder="填写职务"
                    onChange={(event) => update('position', event.target.value)}
                  />
                </label>
              </div>
            </details>
            <div className="contact-create-properties">
              <label>
                标签 <span className="contact-create-optional">选填</span>
                <input
                  aria-label="联系人标签"
                  value={tagText}
                  placeholder="用逗号分隔"
                  aria-invalid={invalidTags || undefined}
                  onChange={(event) => setTagText(event.target.value)}
                />
              </label>
              <details className="contact-create-projects">
                <summary>
                  <Icon name="folder" size={15} />
                  关联项目
                  <span>
                    {draft.project_ids.length ? `已选 ${draft.project_ids.length} 项` : '可选'}
                  </span>
                </summary>
                <div className="contact-create-project-options" role="group" aria-label="关联项目">
                  {projects
                    .filter((row) => !row.archived_at || draft.project_ids.includes(row.id))
                    .map((project) => (
                      <label key={project.id}>
                        <input
                          type="checkbox"
                          value={project.id}
                          checked={draft.project_ids.includes(project.id)}
                          disabled={
                            locked ||
                            discarding ||
                            (!draft.project_ids.includes(project.id) &&
                              draft.project_ids.length >= 100)
                          }
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              project_ids: event.target.checked
                                ? [...current.project_ids, project.id]
                                : current.project_ids.filter((id) => id !== project.id),
                            }))
                          }
                        />
                        {project.title}
                        {project.archived_at ? '（归档）' : ''}
                      </label>
                    ))}
                  {catalogReady && !projects.some((row) => !row.archived_at) && (
                    <p>暂无可关联项目，创建后可再添加。</p>
                  )}
                </div>
              </details>
            </div>
          </fieldset>
          {invalidTags && <p role="alert">最多 20 个标签，每个标签不超过 40 字。</p>}
          {!catalogReady && (
            <p role="status">
              项目列表暂未就绪，已保留输入。
              <button type="button" disabled={actions.busy} onClick={onRetryProjects}>
                重新读取
              </button>
            </p>
          )}
          {actions.error && (
            <p role="alert" className="contact-create-error">
              {actions.error}
            </p>
          )}
        </div>
        <footer className="contact-create-footer">
          <p role="status">
            {discarding
              ? '放弃尚未创建的联系人？'
              : actions.busy
                ? '正在保存联系人…'
                : actions.pending
                  ? '结果待核对，原提交与输入已保留。'
                  : '仅保存在此设备'}
          </p>
          <div>
            {discarding ? (
              <>
                <button type="button" onClick={() => setDiscarding(false)}>
                  继续编辑
                </button>
                <button type="button" className="contact-create-discard" onClick={dismiss}>
                  放弃创建
                </button>
              </>
            ) : (
              <>
                <button type="button" disabled={locked} onClick={cancel}>
                  取消
                </button>
                <button
                  type="submit"
                  className="primary"
                  disabled={
                    actions.busy ||
                    (!actions.pending && (!draft.name.trim() || invalidTags || !catalogReady))
                  }
                >
                  {actions.pending ? '核对原提交' : '创建联系人'}
                </button>
              </>
            )}
          </div>
        </footer>
      </form>
    </dialog>
  );
}
