import { expect, it } from 'vitest';
import {
  assessAgentInput,
  agentUtf8Bytes,
  AGENT_SYSTEM_TEXT,
  AGENT_TEXT_MAX_BYTES,
  AGENT_REQUEST_MAX_BYTES,
  AGENT_PROTOCOL_RESERVE,
  AGENT_OUTPUT_RESERVE,
} from './agent-input-budget';
const capability = {
  provider: 'deepseek',
  model: 'deepseek-flash',
  baseUrl: 'https://api.deepseek.com',
  contextWindow: 1_000_000,
  input: ['text'],
};
it('counts UTF8 separately from an explicitly named engineering proxy, with all reserves', () => {
  const text = '中文english😀'.repeat(5000) + '末页全文_END';
  const b = assessAgentInput({ text, model: 'deepseek-flash', capability });
  expect(b.accepted).toBe(true);
  expect(b.visible_utf8_bytes).toBe(agentUtf8Bytes(text + AGENT_SYSTEM_TEXT));
  expect(b.estimated_input_tokens).toBe(b.visible_utf8_bytes + 8192);
  expect(b.output_reserve_tokens).toBe(2048);
  expect(b.policy).toBe('utf8-byte-proxy-v1');
});

it('separates legacy body eligibility, visible system text and serialized protocol resources', () => {
  const input = {
    text: 'a'.repeat(32_000),
    model: 'gpt-4.1-mini' as const,
    systemText: '系统文字',
  };
  expect(assessAgentInput(input)).toMatchObject({
    accepted: true,
    visible_utf8_bytes: 32_000 + agentUtf8Bytes(input.systemText),
  });
  expect(assessAgentInput({ ...input, text: input.text + 'a' }).accepted).toBe(false);
  const exact = assessAgentInput({ ...input, serializedRequestBytes: AGENT_REQUEST_MAX_BYTES });
  expect(exact.accepted).toBe(true);
  expect(exact.visible_utf8_bytes).toBe(assessAgentInput(input).visible_utf8_bytes);
  expect(exact.estimated_input_tokens).toBe(assessAgentInput(input).estimated_input_tokens);
  expect(
    assessAgentInput({ ...input, serializedRequestBytes: AGENT_REQUEST_MAX_BYTES + 1 }),
  ).toMatchObject({ accepted: false, message: expect.stringContaining('2 MiB') });
  expect(
    assessAgentInput({ ...input, systemText: 'a'.repeat(AGENT_TEXT_MAX_BYTES) }).accepted,
  ).toBe(false);
});
it('accepts the exact visible-byte resource boundary, rejects +1, and reserves actual window headroom', () => {
  const text = 'a'.repeat(AGENT_TEXT_MAX_BYTES - agentUtf8Bytes(AGENT_SYSTEM_TEXT));
  expect(assessAgentInput({ text, model: 'deepseek-flash', capability }).accepted).toBe(true);
  expect(assessAgentInput({ text: text + 'a', model: 'deepseek-flash', capability }).accepted).toBe(
    false,
  );
  const minWindow = AGENT_TEXT_MAX_BYTES + AGENT_PROTOCOL_RESERVE + AGENT_OUTPUT_RESERVE;
  expect(
    assessAgentInput({
      text,
      model: 'deepseek-flash',
      capability: { ...capability, contextWindow: minWindow },
    }).accepted,
  ).toBe(true);
  expect(
    assessAgentInput({
      text,
      model: 'deepseek-flash',
      capability: { ...capability, contextWindow: minWindow - 1 },
    }).accepted,
  ).toBe(false);
});
it('refuses long unknown/mismatched/image inputs, retaining short-model behavior', () => {
  const text = 'a'.repeat(33_000);
  for (const change of [
    { provider: 'other' },
    { model: 'deepseek-v4-pro' },
    { baseUrl: 'https://untrusted.example' },
    { input: ['image'] },
    { contextWindow: NaN },
  ])
    expect(
      assessAgentInput({ text, model: 'deepseek-flash', capability: { ...capability, ...change } })
        .accepted,
    ).toBe(false);
  expect(
    assessAgentInput({ text, model: 'deepseek-flash', capability, imageCount: 1 }).accepted,
  ).toBe(false);
  expect(assessAgentInput({ text, model: 'gpt-4.1-mini', capability }).accepted).toBe(false);
  expect(assessAgentInput({ text: '短输入', model: 'gpt-4.1-mini', imageCount: 12 }).accepted).toBe(
    true,
  );
});
