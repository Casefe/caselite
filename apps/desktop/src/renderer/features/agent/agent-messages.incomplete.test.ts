import { expect, it } from 'vitest';
import type { AgentRun } from '../../../preload/caselite-api';
import { agentMessages } from './agent-messages';

it('projects each historical run’s own output completeness', () => {
  const run: AgentRun = {
    id: 'first',
    scope: 'home',
    model: 'gpt-4.1-mini',
    provider: 'openai',
    prompt: '问题',
    output: '部分回答',
    status: 'succeeded',
    sequence: 1,
    message: '达到输出上限',
    usage: null,
    output_incomplete: true,
  };
  const messages = agentMessages([
    run,
    { ...run, id: 'second', output_incomplete: false },
    { ...run, id: 'third', output_incomplete: undefined },
  ]);
  expect(messages[1].metadata?.custom?.run).toMatchObject({ output_incomplete: true });
  expect(messages[3].metadata?.custom?.run).toMatchObject({ output_incomplete: false });
  expect(messages[5].metadata?.custom?.run).toMatchObject({ output_incomplete: undefined });
});
