import { useSyncExternalStore } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { Contact, ContactsRequest, ContactsResponse } from '../../../preload/caselite-api';

export const contactsKey = ['contacts', 'local'] as const;
export const contactKey = (id: string) => ['contacts', 'detail', id] as const;
export type ContactWrite = Exclude<ContactsRequest, { operation: 'read' | 'list' }>;
type Confirmed = Extract<ContactsResponse, { ok: true }>;
type State = { pending?: ContactWrite; busy: boolean; error: string };
type Ledger = { state: State; listeners: Set<() => void> };
// QueryClient限定工作区生命周期；卸载面板不丢原请求，不写浏览器存储或第二真源。
const ledgers = new WeakMap<QueryClient, Map<string, Ledger>>();
export function useContactsWrite(owner: string) {
  const client = useQueryClient();
  let workspace = ledgers.get(client);
  if (!workspace) ledgers.set(client, (workspace = new Map()));
  let ledger = workspace.get(owner);
  if (!ledger)
    workspace.set(owner, (ledger = { state: { busy: false, error: '' }, listeners: new Set() }));
  const active = ledger;
  const update = (patch: Partial<State>) => {
    active.state = { ...active.state, ...patch };
    active.listeners.forEach((listener) => listener());
  };
  const state = useSyncExternalStore(
    (listener) => {
      active.listeners.add(listener);
      return () => active.listeners.delete(listener);
    },
    () => active.state,
  );
  const write = async (request: ContactWrite): Promise<Confirmed | undefined> => {
    if (owner !== 'new' && request.contact_id !== owner) {
      update({ error: '提交不属于当前联系人，未发送。' });
      return;
    }
    if (active.state.busy) return;
    if (active.state.pending && JSON.stringify(active.state.pending) !== JSON.stringify(request)) {
      update({ error: '请先核对原提交，不能更换内容或提交身份。' });
      return;
    }
    // 拷贝原请求，后续表单和迟到回调不能修改未知提交的身份或正文。
    const original = active.state.pending ?? structuredClone(request);
    update({ pending: original, busy: true, error: '' });
    try {
      const response = await window.caselite.contacts(original);
      if (!response.ok) {
        update({
          error: response.message,
          ...(!['RESULT_UNKNOWN', 'UNAVAILABLE'].includes(response.code)
            ? { pending: undefined }
            : {}),
        });
        if (response.code === 'CONFLICT') {
          void client.invalidateQueries({ queryKey: contactsKey, exact: true });
          void client.invalidateQueries({
            queryKey: contactKey(original.contact_id),
            exact: true,
          });
        }
        return;
      }
      const contact = response.contacts.find((row) => row.id === original.contact_id);
      const entry =
        original.operation === 'save_entry'
          ? response.detail?.entries.find((row) => row.id === original.entry_id)
          : undefined;
      if (
        response.receipt !== original.receipt ||
        !contact ||
        (original.operation === 'save_entry'
          ? !entry ||
            entry.version <= original.expected_version ||
            entry.contact_id !== original.contact_id
          : contact.version <= original.expected_version) ||
        (original.operation !== 'save' && response.detail?.contact_id !== original.contact_id)
      )
        throw new Error('回执与原提交不符，请核对原提交。');
      // 先取消旧读取，再安装已确认版本；迟到响应不能覆盖刚落盘的记录。
      await client.cancelQueries({ queryKey: contactsKey, exact: true });
      await client.cancelQueries({ queryKey: contactKey(contact.id), exact: true });
      client.setQueryData<Contact[]>(contactsKey, (rows = []) => [
        ...rows.filter((row) => row.id !== contact.id),
        contact,
      ]);
      if (response.detail) client.setQueryData(contactKey(contact.id), response);
      else void client.invalidateQueries({ queryKey: contactKey(contact.id), exact: true });
      update({ pending: undefined, error: '' });
      return response;
    } catch (failure) {
      update({
        error: failure instanceof Error ? failure.message : '保存结果尚不确定，请核对原提交。',
      });
    } finally {
      update({ busy: false });
    }
  };
  return { write, ...state, clearError: () => update({ error: '' }) };
}
