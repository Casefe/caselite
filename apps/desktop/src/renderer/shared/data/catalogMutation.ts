export const catalogMutation = <T extends object>(input: T) => ({
  ...input,
  protocol_version: 1 as const,
  request_id: crypto.randomUUID(),
  idempotency_key: crypto.randomUUID(),
});
