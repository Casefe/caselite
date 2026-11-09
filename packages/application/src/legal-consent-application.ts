import {
  legalBundleSchema,
  legalConsentRequestSchema,
  legalReceiptSchema,
  type LegalBundle,
  type LegalConsentResponse,
  type LegalReceipt,
} from '@caselite/contracts';

export type LegalAcceptancePort = {
  read(): LegalReceipt | null;
  write(receipt: LegalReceipt): void;
};

export function createLegalConsentApplication(
  port: LegalAcceptancePort,
  documents: LegalBundle,
  now: () => Date = () => new Date(),
) {
  const bundle = legalBundleSchema.parse(documents);
  if (bundle.documents[0].id !== 'license' || bundle.documents[1].id !== 'eula')
    throw new Error('Invalid legal document order');
  const matches = (receipt: LegalReceipt | null): boolean =>
    receipt !== null &&
    receipt.document_set_hash === bundle.document_set_hash &&
    receipt.license_sha256 === bundle.documents[0].sha256 &&
    receipt.eula_sha256 === bundle.documents[1].sha256;
  return {
    execute(input: unknown): LegalConsentResponse {
      const request = legalConsentRequestSchema.safeParse(input);
      if (!request.success) return { ok: false, message: '协议确认请求无效。' };
      try {
        if (request.data.operation === 'decline') return { ok: true, accepted: false, bundle };
        const prior = port.read();
        if (request.data.operation === 'accept') {
          if (request.data.document_set_hash !== bundle.document_set_hash)
            return { ok: false, message: '协议内容已变化，请重新阅读后确认。' };
          // 只在明确确认当前两份正文后落盘；保存失败不能打开工作台。
          if (!matches(prior)) {
            const receipt = legalReceiptSchema.parse({
              version: 1,
              document_set_hash: bundle.document_set_hash,
              license_sha256: bundle.documents[0].sha256,
              eula_sha256: bundle.documents[1].sha256,
              accepted_at: now().toISOString(),
            });
            port.write(receipt);
          }
          if (!matches(port.read()))
            return { ok: false, message: '协议同意记录尚未保存，请重试。' };
          return { ok: true, accepted: true, bundle };
        }
        return { ok: true, accepted: matches(prior), bundle };
      } catch {
        return { ok: false, message: '无法读取或保存协议同意记录，请重试或联系支持。' };
      }
    },
  };
}
