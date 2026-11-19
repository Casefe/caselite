import { describe, expect, it } from 'vitest';
import {
  applyDispatchBarrier,
  createDispatchBarrierState,
  dispatchReadTools,
  type DispatchBarrierState,
} from '../../packages/contracts/src/dispatch-barrier';
import { readToolPolicySchema } from '../../packages/contracts/src/agent-input';

const runA = '11111111-1111-4111-8111-111111111111';
const runB = '22222222-2222-4222-8222-222222222222';
const manifest = '33333333-3333-4333-8333-333333333333';

function open(state: DispatchBarrierState, run_id: string) {
  return applyDispatchBarrier(state, { type: 'open_run', run_id });
}

describe('DEV-1759 dispatch barrier negative paths', () => {
  it('reuses the 1654 read whitelist and rejects shell, sql and mcp by default', () => {
    expect(
      readToolPolicySchema.safeParse({
        manifest_id: manifest,
        tools: [...dispatchReadTools],
        allow_discovery: false,
        allow_effects: false,
      }).success,
    ).toBe(true);
    for (const name of ['bash', 'shell', 'sql', 'mcp']) {
      expect(dispatchReadTools).not.toContain(name);
      expect(
        readToolPolicySchema.safeParse({
          manifest_id: manifest,
          tools: [name],
          allow_discovery: false,
          allow_effects: false,
        }).success,
      ).toBe(false);
    }
  });

  it('keeps dispatch at 0 when Stop arrives before any model or tool dispatch', () => {
    let state = open(createDispatchBarrierState(), runA);
    state = applyDispatchBarrier(state, { type: 'stop', run_id: runA });
    expect(state.last_decision).toMatchObject({ accepted: true, code: 'stopped_before_dispatch' });
    expect(state.runs[runA]).toMatchObject({
      phase: 'terminal',
      status: 'cancelled',
      dispatch_count: 0,
      follow_up_dispatches: 0,
      tool_executed: false,
      output: '',
    });
    const stopped = state.runs[runA];
    state = applyDispatchBarrier(state, { type: 'dispatch_model', run_id: runA });
    state = applyDispatchBarrier(state, {
      type: 'tool_call',
      run_id: runA,
      name: 'read_selected_document',
    });
    state = applyDispatchBarrier(state, { type: 'model_event', run_id: runA, text: '不应写入' });
    expect(state.runs[runA]).toBe(stopped);
    expect(state.runs[runA]).toMatchObject({ dispatch_count: 0, output: '' });
    expect(state.last_decision.code).toBe('late_event');
  });

  it('does not continue or adopt a read after Stop during the tool', () => {
    let state = open(createDispatchBarrierState(), runA);
    state = applyDispatchBarrier(state, { type: 'dispatch_model', run_id: runA });
    state = applyDispatchBarrier(state, {
      type: 'tool_call',
      run_id: runA,
      name: 'read_selected_source',
    });
    expect(state.runs[runA]).toMatchObject({
      phase: 'tool_read',
      dispatch_count: 1,
      tool_executed: false,
    });
    state = applyDispatchBarrier(state, { type: 'stop', run_id: runA });
    const stopped = state.runs[runA];
    expect(stopped).toMatchObject({ status: 'cancelled', tool_executed: false, output: '' });
    state = applyDispatchBarrier(state, { type: 'continue_after_tool', run_id: runA });
    state = applyDispatchBarrier(state, { type: 'dispatch_model', run_id: runA });
    state = applyDispatchBarrier(state, { type: 'tool_result', run_id: runA, text: '不应采纳' });
    expect(state.runs[runA]).toBe(stopped);
    expect(state.runs[runA]).toMatchObject({
      dispatch_count: 1,
      follow_up_dispatches: 0,
      tool_executed: false,
      output: '',
    });
    expect(state.last_decision.code).toBe('late_event');
  });

  it('records one allowlisted read and still refuses a second dispatch', () => {
    let state = open(createDispatchBarrierState(), runA);
    state = applyDispatchBarrier(state, { type: 'dispatch_model', run_id: runA });
    state = applyDispatchBarrier(state, {
      type: 'tool_call',
      run_id: runA,
      name: 'read_selected_document',
    });
    const reading = state.runs[runA];
    state = applyDispatchBarrier(state, { type: 'continue_after_tool', run_id: runA });
    expect(state.last_decision.code).toBe('continuation_refused');
    expect(state.runs[runA]).toBe(reading);
    state = applyDispatchBarrier(state, {
      type: 'tool_result',
      run_id: runA,
      text: '已读固定摘录',
    });
    expect(state.runs[runA]).toMatchObject({
      status: 'closed',
      dispatch_count: 1,
      follow_up_dispatches: 0,
      tool_executed: true,
      output: '已读固定摘录',
    });
    const closed = state.runs[runA];
    state = applyDispatchBarrier(state, { type: 'dispatch_model', run_id: runA });
    state = applyDispatchBarrier(state, { type: 'continue_after_tool', run_id: runA });
    expect(state.runs[runA]).toBe(closed);
    expect(state.last_decision.code).toBe('continuation_refused');
  });

  it('rejects unknown tools without execution or a follow-up dispatch', () => {
    for (const name of ['bash', 'shell', 'sql', 'mcp', 'read_selected_document_extra']) {
      let state = open(createDispatchBarrierState(), runA);
      state = applyDispatchBarrier(state, { type: 'dispatch_model', run_id: runA });
      state = applyDispatchBarrier(state, { type: 'tool_call', run_id: runA, name });
      expect(state.last_decision).toMatchObject({ accepted: false, code: 'unknown_tool' });
      const rejected = state.runs[runA];
      expect(rejected).toMatchObject({
        phase: 'terminal',
        status: 'rejected',
        dispatch_count: 1,
        follow_up_dispatches: 0,
        tool_executed: false,
        output: '',
      });
      state = applyDispatchBarrier(state, { type: 'dispatch_model', run_id: runA });
      state = applyDispatchBarrier(state, { type: 'continue_after_tool', run_id: runA });
      state = applyDispatchBarrier(state, { type: 'tool_result', run_id: runA, text: '不应执行' });
      expect(state.runs[runA]).toBe(rejected);
    }
    let early = open(createDispatchBarrierState(), runA);
    const armed = early.runs[runA];
    early = applyDispatchBarrier(early, { type: 'tool_call', run_id: runA, name: 'bash' });
    expect(early.last_decision.code).toBe('tool_before_dispatch');
    expect(early.runs[runA]).toBe(armed);
    expect(early.runs[runA].dispatch_count).toBe(0);
  });

  it('drops late events so a new run does not receive the previous run', () => {
    let state = open(createDispatchBarrierState(), runA);
    state = applyDispatchBarrier(state, { type: 'dispatch_model', run_id: runA });
    state = applyDispatchBarrier(state, { type: 'model_event', run_id: runA, text: '部分输出' });
    state = applyDispatchBarrier(state, { type: 'open_run', run_id: runB });
    expect(state.last_decision.code).toBe('busy');
    expect(state.runs[runB]).toBeUndefined();
    expect(state.active_run_id).toBe(runA);
    state = applyDispatchBarrier(state, { type: 'stop', run_id: runA });
    expect(state.runs[runA]).toMatchObject({
      status: 'cancelled',
      output: '部分输出',
      dispatch_count: 1,
    });
    const finished = state.runs[runA];
    state = applyDispatchBarrier(state, { type: 'model_event', run_id: runA, text: '迟到内容' });
    state = applyDispatchBarrier(state, { type: 'tool_result', run_id: runA, text: '工具迟到' });
    expect(state.runs[runA]).toBe(finished);
    state = open(state, runB);
    expect(state.runs[runB]).toMatchObject({
      phase: 'armed',
      status: 'armed',
      dispatch_count: 0,
      follow_up_dispatches: 0,
      tool_executed: false,
      output: '',
    });
    const fresh = state.runs[runB];
    state = applyDispatchBarrier(state, { type: 'model_event', run_id: runA, text: '再迟到' });
    state = applyDispatchBarrier(state, { type: 'dispatch_model', run_id: runA });
    state = applyDispatchBarrier(state, {
      type: 'tool_call',
      run_id: runB,
      name: 'bash',
    });
    state = applyDispatchBarrier(state, { type: 'open_run', run_id: runA });
    expect(state.runs[runA]).toBe(finished);
    expect(state.runs[runA].output).toBe('部分输出');
    expect(state.runs[runB]).toBe(fresh);
    expect(state.runs[runB].output).toBe('');
    expect(JSON.stringify(state.runs[runB])).not.toContain('部分输出');
    expect(JSON.stringify(state.runs[runB])).not.toContain('迟到');
    expect(state.last_decision).toMatchObject({ accepted: false, code: 'conflict' });
  });

  it('rejects malformed events without creating or changing a run', () => {
    let state = open(createDispatchBarrierState(), runA);
    const armed = state.runs[runA];
    state = applyDispatchBarrier(state, {
      type: 'tool_call',
      run_id: runA,
      name: 'read_selected_document',
      arguments: { command: 'cat private' },
    });
    state = applyDispatchBarrier(state, { type: 'dispatch_model', run_id: runA, retry: 1 });
    state = applyDispatchBarrier(state, { type: 'model_event', run_id: 'not-a-run', text: 'x' });
    expect(state.last_decision.code).toBe('invalid_event');
    expect(state.runs[runA]).toBe(armed);
    expect(state.active_run_id).toBe(runA);
    expect(Object.keys(state.runs)).toEqual([runA]);
  });
});
