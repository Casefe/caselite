import {
  LEGAL_CONSENT_CHANNEL,
  legalConsentRequestSchema,
  legalConsentResponseSchema,
  type LegalConsentRequest,
  type LegalConsentResponse,
} from '@caselite/contracts';

export function createLegalPreloadApi(
  invoke: (channel: string, input: unknown) => Promise<unknown>,
) {
  return {
    async execute(input: LegalConsentRequest): Promise<LegalConsentResponse> {
      const request = legalConsentRequestSchema.safeParse(input);
      if (!request.success) return { ok: false, message: '协议确认请求无效。' };
      try {
        return legalConsentResponseSchema.parse(await invoke(LEGAL_CONSENT_CHANNEL, request.data));
      } catch {
        return { ok: false, message: '无法连接协议确认窗口，请退出后重试。' };
      }
    },
  };
}
export type LegalPreloadApi = ReturnType<typeof createLegalPreloadApi>;
