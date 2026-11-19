import { describe, expect, it } from 'vitest';
import {
  DISPATCH_BARRIER_EXPECTED,
  dispatchBarrierCaseSchema,
  dispatchBarrierObservationSchema,
  dispatchBarrierViolations,
  type DispatchBarrierCase,
} from '@caselite/contracts';

const observation = (id: DispatchBarrierCase) => ({ case: id, ...DISPATCH_BARRIER_EXPECTED[id] });

describe('DEV-1759 dispatch barrier observation contract', () => {
  it('covers exactly the four negative paths and accepts their expected observations', () => {
    expect(dispatchBarrierCaseSchema.options).toEqual([
      'stop_before_dispatch',
      'stop_mid_tool',
      'unknown_tool',
      'late_event_new_run',
    ]);
    for (const id of dispatchBarrierCaseSchema.options)
      expect(dispatchBarrierViolations(observation(id))).toEqual([]);
  });

  it('never expects a tool effect, a post-stop mutation or a polluted next run', () => {
    for (const expected of Object.values(DISPATCH_BARRIER_EXPECTED)) {
      expect(expected.tool_effects).toBe(0);
      expect(expected.barrier_run_mutated_after_stop).toBe(false);
      expect(expected).toMatchObject({
        next_run_dispatches: 1,
        next_run_status: 'succeeded',
        next_run_output_is_own: true,
      });
      expect(expected.provider_dispatches).toBeLessThanOrEqual(1);
    }
    expect(DISPATCH_BARRIER_EXPECTED.stop_before_dispatch).toMatchObject({
      provider_dispatches: 0,
      barrier_run: 'not_registered',
    });
  });

  it.each([
    ['stop_before_dispatch', { provider_dispatches: 1 }, 'provider_dispatches'],
    ['stop_before_dispatch', { barrier_run: 'cancelled' }, 'barrier_run'],
    ['stop_mid_tool', { tool_effects: 1 }, 'tool_effects'],
    ['stop_mid_tool', { provider_dispatches: 2 }, 'provider_dispatches'],
    ['stop_mid_tool', { barrier_run: 'succeeded' }, 'barrier_run'],
    ['unknown_tool', { provider_dispatches: 2 }, 'provider_dispatches'],
    ['unknown_tool', { barrier_run: 'succeeded' }, 'barrier_run'],
    ['late_event_new_run', { barrier_run_mutated_after_stop: true }, 'mutated_after_stop'],
    ['late_event_new_run', { next_run_output_is_own: false }, 'next_run_output_is_own'],
    ['late_event_new_run', { next_run_status: 'cancelled' }, 'next_run_status'],
    ['late_event_new_run', { next_run_dispatches: 0 }, 'next_run_dispatches'],
  ] as const)('reports a %s regression for %o', (id, patch, field) => {
    const violations = dispatchBarrierViolations({ ...observation(id), ...patch });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain(`${id}.`);
    expect(violations[0]).toContain(field);
  });

  it.each([
    ['unknown case', { ...observation('unknown_tool'), case: 'retry_after_stop' }],
    ['extra field', { ...observation('unknown_tool'), dynamic_mcp: true }],
    ['missing field', { case: 'unknown_tool', provider_dispatches: 1 }],
    ['negative count', { ...observation('stop_mid_tool'), tool_effects: -1 }],
    ['fractional count', { ...observation('stop_mid_tool'), provider_dispatches: 0.5 }],
    ['unknown run status', { ...observation('stop_mid_tool'), barrier_run: 'stopped' }],
  ])('rejects an invalid observation: %s', (_label, input) => {
    expect(dispatchBarrierObservationSchema.safeParse(input).success).toBe(false);
    expect(dispatchBarrierViolations(input)).toEqual(['INVALID_OBSERVATION']);
  });
});
