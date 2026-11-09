import { expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createAgentApplication } from '../../packages/application/src/agent-application';
import { createCaseLitePreloadApi } from '../../apps/desktop/src/preload/caselite-api';
import { agentRunSchema, type AgentRun } from '../../packages/contracts/src';
const customer = randomUUID(),
  other = randomUUID();
const scope = `contact:${customer}`;
const candidate = {
  kind: 'contact_record' as const,
  title: '合成沟通',
  channel: 'wechat' as const,
  occurred_on: null,
  summary: '唯一旧内容-MARKER-不应隐式发送',
};
function run(patch: Partial<AgentRun> = {}): AgentRun {
  return agentRunSchema.parse({
    id: randomUUID(),
    scope,
    provider: 'openai',
    model: 'gpt-4.1-mini',
    prompt: '记下来',
    output: JSON.stringify(candidate),
    status: 'succeeded',
    sequence: 2,
    message: '完成',
    usage: null,
    ...patch,
  });
}
function setup(initial: AgentRun[] = []) {
  const stored = new Map(initial.map((row) => [row.id, structuredClone(row)]));
  const start = vi.fn(
    (input: Parameters<Parameters<typeof createAgentApplication>[0]['runtime']['start']>[0]) => {
      input.onText(JSON.stringify(candidate));
      input.onEnd({ status: 'succeeded', usage: null, message: '合成完成' });
      return { cancel() {} };
    },
  );
  const app = createAgentApplication({
    credentials: {
      get: () => 'synthetic',
      set() {},
      clear() {},
      getDefaultModel: () => 'gpt-4.1-mini',
      setDefaultModel() {},
    },
    contact: { exists: (id) => [customer, other].includes(id) },
    taskExists: () => false,
    page: {
      read: () => ({
        title: '合成客户',
        text: '{"name":"合成客户","kind":"person"}',
        version: '1',
        archived: false,
      }),
    },
    history: {
      load: () => [...stored.values()],
      register: (r) => {
        stored.set(r.id, structuredClone(r));
        return { created: true, run: r };
      },
      save: (r) => {
        stored.set(r.id, structuredClone(r));
      },
    },
    runtime: { start },
  });
  const execute = async (request: Record<string, unknown>, owner = 'window') => {
    const result = await app.execute({ protocol_version: 1, ...request }, owner);
    if (!result.ok) throw Error(result.message);
    return result;
  };
  const send = async (
    prompt: string,
    reference?: string,
    selectedScope = scope,
    owner = 'window',
  ) => {
    const preview = await execute({ operation: 'preview_page', scope: selectedScope }, owner);
    return app.execute(
      {
        protocol_version: 1,
        operation: 'start',
        scope: selectedScope,
        run_id: randomUUID(),
        prompt,
        confirmed: true,
        page_context_id: preview.page_preview!.id,
        ...(reference ? { contact_record_context_id: reference } : {}),
      },
      owner,
    );
  };
  return { stored, start, app, execute, send };
}
it('projects one canonical DTO only for accessible complete customer candidates, without changing persisted runs', async () => {
  const valid = run(),
    invalid = run({ output: '普通回答', contact_record_candidate: candidate });
  const incomplete = run({ output_incomplete: true }),
    failed = run({ status: 'failed' }),
    outside = run({ scope: `contact:${other}` }),
    task = run({ scope: randomUUID(), contact_record_candidate: candidate });
  const s = setup([valid, invalid, incomplete, failed, outside, task]);
  const api = createCaseLitePreloadApi(async (_channel, request) =>
    s.app.execute(request, 'window'),
  );
  const response = await api.agent({ protocol_version: 1, operation: 'read', scope });
  expect(response.ok).toBe(true);
  if (!response.ok) throw Error(response.message);
  expect(response.runs.map((r) => r.id)).toEqual([valid.id, invalid.id, incomplete.id, failed.id]);
  expect(response.runs[0].contact_record_candidate).toEqual(candidate);
  expect(response.runs.slice(1).every((r) => r.contact_record_candidate === undefined)).toBe(true);
  expect(s.stored.get(valid.id)).toEqual(valid);
  expect(s.stored.get(invalid.id)).toEqual(invalid);
});
it('ordinary questions never send old candidates; explicit continuation stays scope and owner bound', async () => {
  const valid = run();
  const s = setup([valid]);
  for (const question of ['修改合同需要注意什么', '补充协议是什么意思']) {
    expect(await s.send(question)).toMatchObject({ ok: true });
    expect(s.start.mock.calls.at(-1)![0].prompt).not.toContain('MARKER');
  }
  expect(await s.send('把日期设为今天', valid.id)).toMatchObject({ ok: true });
  expect(s.start.mock.calls.at(-1)![0].prompt).toContain(candidate.summary);
  const count = s.start.mock.calls.length;
  expect(await s.send('引用旧候选', valid.id, `contact:${other}`)).toMatchObject({
    ok: false,
    code: 'INVALID_REQUEST',
  });
  expect(s.start).toHaveBeenCalledTimes(count);
  const generated = (await s.execute({ operation: 'read', scope })).runs.at(-1)!;
  expect(await s.send('引用别的窗口', generated.id, scope, 'other-window')).toMatchObject({
    ok: false,
    code: 'INVALID_REQUEST',
  });
  expect(s.start).toHaveBeenCalledTimes(count);
});
