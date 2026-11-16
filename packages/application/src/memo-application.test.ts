import { expect, it, vi } from 'vitest';
import { createMemoApplication } from './memo-application';

const id = '5af8361e-05c9-487f-8c51-878118277875';
const create = {
  protocol_version: 1 as const,
  operation: 'create' as const,
  request_id: id,
  idempotency_key: id,
  memo_id: id,
  text: '合成备忘：核对保全条款',
  expected_version: 0 as const,
};

it('rejects unknown fields before the port', () => {
  const execute = vi.fn();
  const app = createMemoApplication({ execute });
  expect(app.execute({ ...create, extra: true })).toMatchObject({
    ok: false,
    code: 'INVALID_REQUEST',
  });
  expect(execute).not.toHaveBeenCalled();
});

it('replays a stored receipt before attempting another write', () => {
  const stored = { ok: true as const, memos: [], receipt: id };
  const execute = vi.fn((request) =>
    request.operation === 'receipt' || request.operation === 'create'
      ? stored
      : { ok: false as const, code: 'WRITE_FAILED' as const, message: 'unexpected' },
  );
  const app = createMemoApplication({ execute });
  expect(app.execute(create)).toEqual(stored);
  expect(execute).toHaveBeenCalledTimes(2);
  expect(execute.mock.calls[0]?.[0]).toMatchObject({ operation: 'receipt', idempotency_key: id });
});
