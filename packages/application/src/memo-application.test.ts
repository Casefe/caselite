import { expect, it } from 'vitest';
import type { MemoResponse } from '@caselite/contracts';
import { createMemoApplication } from './memo-application';

const memo = {
  id: '00000000-0000-4000-8000-000000000001',
  text: '合成备忘',
  status: 'active' as const,
  version: 1,
  created_at: '2026-11-15T00:00:00.000Z',
  updated_at: '2026-11-15T00:00:00.000Z',
  deleted_at: null,
};
function create(text = '合成备忘') {
  return {
    protocol_version: 1 as const,
    operation: 'create' as const,
    request_id: crypto.randomUUID(),
    idempotency_key: crypto.randomUUID(),
    memo_id: crypto.randomUUID(),
    text,
  };
}
it('rejects task, matter, date and empty text before the port', () => {
  let calls = 0;
  const app = createMemoApplication({
    execute() {
      calls += 1;
      throw new Error('port');
    },
  });
  const request = create();
  for (const extra of [
    { task_id: crypto.randomUUID() },
    { matter_id: crypto.randomUUID() },
    { date: '2026-11-16' },
    { planned_date: '2026-11-16' },
    { due_date: '2026-11-16' },
    { text: '   ' },
    { text: '备忘\0原文' },
    { text: 'a'.repeat(4001) },
  ])
    expect(app.execute({ ...request, ...extra })).toMatchObject({
      ok: false,
      code: 'INVALID_REQUEST',
    });
  expect(app.execute({ protocol_version: 1, operation: 'list', view: 'tomorrow' })).toMatchObject({
    ok: false,
    code: 'INVALID_REQUEST',
  });
  expect(calls).toBe(0);
});
it('reports an unknown save when the port throws and a read failure for list or receipt', () => {
  const app = createMemoApplication({
    execute() {
      throw new Error('synthetic disk');
    },
  });
  expect(app.execute(create())).toMatchObject({ ok: false, code: 'RESULT_UNKNOWN' });
  expect(app.execute({ protocol_version: 1, operation: 'list', view: 'active' })).toMatchObject({
    ok: false,
    code: 'READ_FAILED',
  });
  expect(
    app.execute({
      protocol_version: 1,
      operation: 'receipt',
      idempotency_key: crypto.randomUUID(),
    }),
  ).toMatchObject({ ok: false, code: 'READ_FAILED' });
});
it('keeps one overlapping write and rejects a different body on the same key', () => {
  let writes = 0;
  const app = createMemoApplication({
    execute(request) {
      if (request.operation !== 'create') throw new Error('unexpected');
      writes += 1;
      const again = app.execute({ ...request, request_id: crypto.randomUUID() });
      const other = app.execute({
        ...request,
        request_id: crypto.randomUUID(),
        text: '另一条备忘',
      });
      expect(again).toMatchObject({ ok: false, code: 'RESULT_UNKNOWN' });
      expect(other).toMatchObject({ ok: false, code: 'CONFLICT' });
      const result: MemoResponse = {
        ok: true,
        memos: [{ ...memo, id: request.memo_id, text: request.text }],
        receipt: request.idempotency_key,
      };
      return result;
    },
  });
  expect(app.execute(create())).toMatchObject({ ok: true, memos: [{ text: '合成备忘' }] });
  expect(writes).toBe(1);
});
