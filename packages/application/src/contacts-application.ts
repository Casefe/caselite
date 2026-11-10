import {
  contactsRequestSchema,
  type ContactsRequest,
  type ContactsResponse,
  type ContactSourceRef,
} from '@caselite/contracts';

type SourceAccess = (source: ContactSourceRef, owner: string) => Promise<boolean>;
export function createContactsApplication(port: {
  execute(request: ContactsRequest): ContactsResponse;
  exists?(id: string): boolean;
  replay?(
    request: Extract<ContactsRequest, { operation: 'set_source_links' }>,
  ): ContactsResponse | undefined;
}) {
  const run = (request: ContactsRequest): ContactsResponse => {
    try {
      return port.execute(request);
    } catch {
      return ['list', 'read'].includes(request.operation)
        ? { ok: false, code: 'UNAVAILABLE', message: '联系人目录暂不可用，请重新读取。' }
        : { ok: false, code: 'RESULT_UNKNOWN', message: '无法确认保存结果，请用原提交核对。' };
    }
  };
  const invalid = (): ContactsResponse => ({
    ok: false,
    code: 'INVALID_REQUEST',
    message: '请检查联系人资料、记录内容和关联对象。',
  });
  const hiddenSources = (response: ContactsResponse): ContactsResponse =>
    response.ok && response.detail
      ? {
          ...response,
          detail: {
            ...response.detail,
            source_links: [],
            sources_unavailable: Boolean(response.detail.source_links.length),
          },
        }
      : response;
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
      if (!parsed.success) return invalid();
      if (parsed.data.operation === 'set_source_links')
        return { ok: false, code: 'FORBIDDEN', message: '来源关联必须通过当前窗口的访问核验。' };
      return hiddenSources(run(parsed.data));
    },
    async executeForOwner(
      input: unknown,
      owner: string,
      allowed: SourceAccess,
    ): Promise<ContactsResponse> {
      const parsed = contactsRequestSchema.safeParse(input);
      if (!parsed.success) return invalid();
      const canRead = async (source: ContactSourceRef) => {
        try {
          return await allowed(source, owner);
        } catch {
          return false;
        }
      };
      const replay =
        parsed.data.operation === 'set_source_links' ? port.replay?.(parsed.data) : undefined;
      if (parsed.data.operation === 'set_source_links' && !replay) {
        // 先核验整组；任一来源不可访问时不替换关系，不把部分成功当作整组成功。
        const before = run({
          protocol_version: 1,
          operation: 'read',
          contact_id: parsed.data.contact_id,
        });
        if (!before.ok) return before;
        const request = parsed.data;
        const sources = [
          ...(before.detail?.source_links ?? []).filter((ref) => ref.kind === request.kind),
          ...request.source_refs,
        ];
        if ((await Promise.all(sources.map(canRead))).some((value) => !value))
          return { ok: false, code: 'FORBIDDEN', message: '部分来源暂不可访问，关联未修改。' };
      }
      const response = replay ?? run(parsed.data);
      if (!response.ok || !response.detail) return response;
      const access = await Promise.all(response.detail.source_links.map(canRead));
      return {
        ...response,
        detail: {
          ...response.detail,
          source_links: response.detail.source_links.filter((_, i) => access[i]),
          sources_unavailable: access.some((value) => !value),
        },
      };
    },
  };
}
