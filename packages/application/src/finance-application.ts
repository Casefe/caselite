import {
  financeRequestSchema,
  type FinanceRequest,
  type FinanceResponse,
} from '@caselite/contracts';

interface FinancePort {
  execute(request: FinanceRequest): FinanceResponse;
}

export function createFinanceApplication(port: FinancePort) {
  return {
    execute(input: unknown): FinanceResponse {
      const parsed = financeRequestSchema.safeParse(input);
      if (!parsed.success)
        return { ok: false, code: 'INVALID_REQUEST', message: '项目、合同、期款或金额格式无效。' };

      const request = parsed.data;
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
