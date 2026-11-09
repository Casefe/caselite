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
type Strip<T> = T extends unknown
  ? Omit<T, 'protocol_version' | 'project_id' | 'request_id' | 'idempotency_key'>
  : never;
export type Draft = Strip<Write>;

export type FinanceCandidate = FinanceManagementSuccess['state']['candidates'][number];
export type FinancePrefill = { amount?: number; date?: string; reference?: string };
export type ContractSeed = FinancePrefill & {
  source?: { candidate_id: string; confirmed: true };
  sourceName?: string;
};
