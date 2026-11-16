import { expect, it } from 'vitest';
import { createIntakeApplication } from './intake-application';

const id = '11111111-1111-4111-8111-111111111111';

it('rejects external intake fields before the port and replays a known receipt', () => {
  const seen: string[] = [];
  const app = createIntakeApplication({
    execute(request) {
      seen.push(request.operation);
      if (request.operation === 'receipt')
        return request.idempotency_key === id
          ? {
              ok: true,
              requests: [],
              receipt: id,
            }
          : { ok: false, code: 'NOT_FOUND', message: '尚未查到该提交；请保留输入并再次核对。' };
      return { ok: true, requests: [], receipt: request.idempotency_key };
    },
  });
  expect(
    app.execute({
      protocol_version: 1,
      operation: 'submit',
      request_id: id,
      idempotency_key: id,
      title: '外来邮件',
      text: '',
      source: 'email',
    }),
  ).toMatchObject({ ok: false, code: 'INVALID_REQUEST' });
  expect(seen).toEqual([]);
  expect(
    app.execute({
      protocol_version: 1,
      operation: 'accept_create',
      request_id: id,
      idempotency_key: id,
      work_request_id: id,
    }),
  ).toMatchObject({ ok: true, receipt: id });
  expect(seen).toEqual(['receipt', 'accept_create']);
});
