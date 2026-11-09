import type {
  CaseLitePreloadApi,
  FinanceRequest,
  FinanceResponse,
} from '../../../preload/caselite-api';
export type FinanceManagementRequest = Exclude<
  Parameters<CaseLitePreloadApi['finance']>[0],
  FinanceRequest
>;
export type FinanceManagementSuccess = Extract<FinanceResponse, { kind: 'management' }>;
export type FinanceRule = FinanceManagementSuccess['state']['rules'][number];
type Write = Exclude<FinanceRequest, { operation: 'read' | 'status' }>;
export type Draft =
  | Omit<
      Extract<Write, { operation: 'register_contract' }>,
      'protocol_version' | 'project_id' | 'request_id' | 'idempotency_key'
    >
  | { operation: 'record_payment'; installment_id: string; amount_cents: number }
  | { operation: 'reverse_payment'; payment_id: string };
