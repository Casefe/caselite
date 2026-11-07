import {
  contactsRequestSchema,
  type ContactsRequest,
  type ContactsResponse,
} from '@caselite/contracts';

export function createContactsApplication(port: {
  execute(request: ContactsRequest): ContactsResponse;
}) {
  return {
    execute(input: unknown): ContactsResponse {
      const parsed = contactsRequestSchema.safeParse(input);
      if (!parsed.success)
        return { ok: false, code: 'INVALID_REQUEST', message: '请检查姓名、邮箱和关联项目。' };
      try {
        return port.execute(parsed.data);
      } catch {
        return parsed.data.operation === 'list'
          ? { ok: false, code: 'UNAVAILABLE', message: '联系人目录暂不可用，请重新读取。' }
          : { ok: false, code: 'RESULT_UNKNOWN', message: '无法确认保存结果，请用原提交核对。' };
      }
    },
  };
}
