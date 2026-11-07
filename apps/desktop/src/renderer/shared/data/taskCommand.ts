import type { TaskResponse } from '../../../preload/caselite-api';

export const mutation = () => ({
  protocol_version: 1 as const,
  request_id: crypto.randomUUID(),
  idempotency_key: crypto.randomUUID(),
});
export function check(result: TaskResponse) {
  if (!result.ok) throw new Error(result.message);
  return result;
}
