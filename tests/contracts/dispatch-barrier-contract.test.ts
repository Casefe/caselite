import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  armDispatchBarrier,
  createDispatchBarrierSession,
  dispatchBarrierAudit,
  forkDispatchBarrierRun,
  ingestDispatchBarrierEvent,
  stopDispatchBarrier,
  tryModelDispatch,
  tryReadTool,
} from '../../packages/contracts/src/dispatch-barrier';
import { readToolPolicySchema } from '../../packages/contracts/src/agent-input';

const here = dirname(fileURLToPath(import.meta.url));
const runA = '11111111-1111-4111-8111-111111111111';
const runB = '22222222-2222-4222-8222-222222222222';
const policy = readToolPolicySchema.parse(
  JSON.parse(
    readFileSync(join(here, '../fixtures/pi-law/dev-1759-dispatch-barrier-policy.json'), 'utf8'),
  ),
);

describe('DEV-1759 PLH-04 dispatch-barrier negative regressions', () => {
  it('keeps dispatch_count at 0 when Stop happens before the first model dispatch', () => {
    const session = createDispatchBarrierSession(runA, policy);
    expect(armDispatchBarrier(session)).toEqual({ ok: true });
    expect(stopDispatchBarrier(session, 'stop_before_dispatch')).toEqual({ ok: true });
    expect(tryModelDispatch(session)).toEqual({ ok: false, code: 'STOPPED' });
    expect(dispatchBarrierAudit(session.ledger)).toMatchObject({
      dispatch_count: 0,
      tool_calls: 0,
      stop_reason: 'stop_before_dispatch',
      phase: 'terminal',
    });
  });

  it('stops mid-tool without starting another tool continuation', () => {
    const session = createDispatchBarrierSession(runA, policy);
    armDispatchBarrier(session);
    tryModelDispatch(session);
    expect(tryReadTool(session, 'read_selected_document')).toEqual({ ok: true });
    stopDispatchBarrier(session, 'stop_mid_tool');
    expect(tryReadTool(session, 'read_selected_source')).toEqual({ ok: false, code: 'STOPPED' });
    expect(tryModelDispatch(session)).toEqual({ ok: false, code: 'STOPPED' });
    expect(dispatchBarrierAudit(session.ledger)).toMatchObject({
      dispatch_count: 1,
      tool_calls: 1,
      stop_reason: 'stop_mid_tool',
    });
  });

  it('rejects unknown tools against the 1654 read whitelist', () => {
    const session = createDispatchBarrierSession(runA, policy);
    armDispatchBarrier(session);
    tryModelDispatch(session);
    expect(tryReadTool(session, 'shell')).toEqual({ ok: false, code: 'UNKNOWN_TOOL' });
    expect(tryReadTool(session, 'read_selected_task_message')).toEqual({
      ok: false,
      code: 'UNKNOWN_TOOL',
    });
    expect(dispatchBarrierAudit(session.ledger)).toMatchObject({ tool_calls: 0 });
  });

  it('drops late events after terminal and isolates a new Run identity', () => {
    const session = createDispatchBarrierSession(runA, policy);
    armDispatchBarrier(session);
    tryModelDispatch(session);
    stopDispatchBarrier(session, 'stop_mid_tool');
    expect(
      ingestDispatchBarrierEvent(session, {
        kind: 'text_delta',
        run_id: runA,
        sequence: 1,
        text: '迟到正文',
      }),
    ).toEqual({ ok: false, code: 'LATE_EVENT' });
    expect(dispatchBarrierAudit(session.ledger)).toMatchObject({
      output_bytes: 0,
      dropped_late_events: 1,
    });

    const next = forkDispatchBarrierRun(session, runB);
    armDispatchBarrier(next);
    tryModelDispatch(next);
    expect(
      ingestDispatchBarrierEvent(next, {
        kind: 'text_delta',
        run_id: runA,
        sequence: 2,
        text: '旧Run迟到',
      }),
    ).toEqual({ ok: false, code: 'WRONG_RUN' });
    expect(
      ingestDispatchBarrierEvent(next, {
        kind: 'text_delta',
        run_id: runB,
        sequence: 0,
        text: '新Run正文',
      }),
    ).toEqual({ ok: true });
    expect(dispatchBarrierAudit(next.ledger)).toMatchObject({
      run_id: runB,
      output_bytes: '新Run正文'.length,
      dropped_late_events: 0,
    });
  });
});
