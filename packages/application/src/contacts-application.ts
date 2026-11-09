import {
  contactsRequestSchema,
  type ContactsRequest,
  type ContactsResponse,
} from '@caselite/contracts';

export function createContactsApplication(port: {
  execute(request: ContactsRequest): ContactsResponse;
  exists?(id: string): boolean;
}) {
  return {
    exists(id: string): boolean {
      if (
        !contactsRequestSchema.safeParse({ protocol_version: 1, operation: 'read', contact_id: id })
          .success
      )
        return false;
      return (
        port.exists?.(id) ??
        port.execute({ protocol_version: 1, operation: 'read', contact_id: id }).ok
      );
    },
    execute(input: unknown): ContactsResponse {
      const parsed = contactsRequestSchema.safeParse(input);
      if (!parsed.success)
        return {
          ok: false,
          code: 'INVALID_REQUEST',
          message: '请检查客户资料、记录内容和关联对象。',
        };
      try {
        return port.execute(parsed.data);
      } catch {
        return ['list', 'read'].includes(parsed.data.operation)
          ? { ok: false, code: 'UNAVAILABLE', message: '客户目录暂不可用，请重新读取。' }
          : { ok: false, code: 'RESULT_UNKNOWN', message: '无法确认保存结果，请用原提交核对。' };
      }
    },
  };
}
