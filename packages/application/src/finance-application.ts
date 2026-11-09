import { extractFinanceSuggestions } from './finance-source-parser';
import {
  financeRequestSchema,
  financeManagementRequestSchema,
  type FinanceRequest,
  type FinanceManagementRequest,
  type FinanceResponse,
} from '@caselite/contracts';

interface FinancePort {
  execute(request: FinanceRequest): FinanceResponse;
  management?: {
    execute(
      request: FinanceManagementRequest,
      parse?: (text: string) => ReturnType<typeof extractFinanceSuggestions>,
    ): FinanceResponse;
  };
}

export function createFinanceApplication(port: FinancePort) {
  return {
    execute(input: unknown): FinanceResponse {
      const management = financeManagementRequestSchema.safeParse(input);
      if (management.success) {
        try {
          return (
            port.management?.execute(management.data, extractFinanceSuggestions) ?? {
              ok: false,
              code: 'UNAVAILABLE',
              message: '财务设置暂不可用。',
            }
          );
        } catch {
          return {
            ok: false,
            code: 'UNAVAILABLE',
            message: '无法确认财务操作，请保留原提交并核对。',
          };
        }
      }
      const parsed = financeRequestSchema.safeParse(input);
      if (!parsed.success)
        return { ok: false, code: 'INVALID_REQUEST', message: '项目、合同、期款或金额格式无效。' };

      const request = parsed.data;
      if (request.operation === 'record_payment' && request.source && !request.occurred_on)
        return { ok: false, code: 'INVALID_REQUEST', message: '请核对来源凭证的实际收款日期。' };
      if (request.operation === 'register_contract') {
        const total = request.installments.reduce((sum, row) => sum + BigInt(row.amount_cents), 0n);
        if (total !== BigInt(request.amount_cents))
          return { ok: false, code: 'INVALID_REQUEST', message: '分期合计必须等于合同金额。' };
      }
      try {
        return port.execute(request);
      } catch {
        return {
          ok: false,
          code: 'UNAVAILABLE',
          message:
            request.operation === 'read' || request.operation === 'status'
              ? '无法读取项目账本。'
              : '无法确认写入结果，请先核对原提交。',
        };
      }
    },
  };
}
