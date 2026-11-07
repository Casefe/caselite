import { expect, it, vi } from 'vitest';
import { createTaskApplication } from '../../packages/application/src/task-application';
const query = {
  scope: { type: 'workspace' },
  text: '',
  status: null,
  priority: null,
  dates: 'all',
  from: null,
  to: null,
  body: 'all',
  sort: 'title',
  offset: 0,
};
it('rejects absent scope and arbitrary fields/orders, invalid date bounds and pagination before the Task port', () => {
  const execute = vi.fn(),
    app = createTaskApplication({ execute });
  for (const patch of [
    { scope: undefined },
    { scope: {} },
    { scope: { type: 'workspace', workspace_id: 'forged' } },
    { scope: { type: 'project', id: 'wrong' } },
    { sort: 'SQL' },
    { offset: -1 },
    { offset: 1.5 },
    { offset: 1000001 },
    { text: 'x'.repeat(161) },
    { priority: 5 },
    { from: '2026-02-30' },
    { from: '2026-02-01', to: '2026-01-01' },
    { dates: 'undated', from: '2026-01-01' },
    { status: 'approved' },
    { sql: 'SELECT *' },
  ])
    expect(
      app.execute({ protocol_version: 1, operation: 'list', query: { ...query, ...patch } }),
    ).toMatchObject({ ok: false, code: 'INVALID_REQUEST' });
  expect(execute).not.toHaveBeenCalled();
});
