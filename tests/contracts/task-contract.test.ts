import { describe, expect, it } from 'vitest';
import { taskRequestSchema } from '../../packages/contracts/src/task';
import { createTaskApplication } from '../../packages/application/src/task-application';

describe('Task boundary', () => {
  const key = '11111111-1111-4111-8111-111111111111';
  const command = {
    operation: 'create',
    protocol_version: 1,
    request_id: key,
    idempotency_key: key,
    title: '内部沟通',
    objective: '',
  };
  it('rejects renderer-supplied identity, arbitrary paths and empty names', () => {
    for (const bad of [
      { ...command, actor: 'admin' },
      { ...command, path: '/tmp/a' },
      { ...command, title: '  ' },
      { ...command, protocol_version: 2 },
      { ...command, objective_state: [256] },
      { ...command, objective_state: [] },
    ])
      expect(taskRequestSchema.safeParse(bad).success).toBe(false);
  });
  it('does not reach storage on invalid input or expose storage errors', () => {
    let calls = 0;
    const app = createTaskApplication({
      execute() {
        calls++;
        throw new Error('sensitive path');
      },
    });
    expect(app.execute({}).ok).toBe(false);
    expect(calls).toBe(0);
    expect(app.execute(command)).toEqual({
      ok: false,
      code: 'WRITE_FAILED',
      message: expect.not.stringContaining('sensitive'),
    });
  });
});
