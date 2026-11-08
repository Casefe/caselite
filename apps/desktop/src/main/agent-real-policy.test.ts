import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createRealDemoBudget,
  readOnlyDemoCredentials,
  realDemoPrompts,
  realDemoId,
  inspectZeroDispatchResume,
  selectedCredentialReady,
  validateRealDemoLaunch,
  realDemoFreshId,
} from './agent-real-policy';
const directories: string[] = [];
const directory = () => {
  const p = mkdtempSync(join(tmpdir(), 'caselite-real-policy-'));
  directories.push(p);
  return p;
};
afterEach(() => {
  for (const p of directories.splice(0)) rmSync(p, { recursive: true, force: true });
});
it('exposes only credential reads and never forwards mutations', () => {
  const port = {
    get: vi.fn(() => 'synthetic'),
    getDefaultModel: vi.fn(() => 'deepseek-flash' as const),
    set: vi.fn(),
    clear: vi.fn(),
    setDefaultModel: vi.fn(),
  };
  const readonly = readOnlyDemoCredentials(port);
  expect(readonly.get('deepseek')).toBe('synthetic');
  expect(readonly.getDefaultModel()).toBe('deepseek-flash');
  expect(() => readonly.set('replacement')).toThrow();
  expect(() => readonly.clear()).toThrow();
  expect(() => readonly.setDefaultModel('gpt-4.1-mini')).toThrow();
  expect(port.set).not.toHaveBeenCalled();
  expect(port.clear).not.toHaveBeenCalled();
  expect(port.setDefaultModel).not.toHaveBeenCalled();
});
it('persists run identity before dispatch and rejects a restart even before a receipt', () => {
  const root = directory();
  const budget = createRealDemoBudget(root);
  budget.reserve('run-one', 'deepseek-flash', realDemoPrompts[0]);
  expect(JSON.parse(readFileSync(join(root, 'dispatch-1.json'), 'utf8'))).toMatchObject({
    runId: 'run-one',
    cumulativeDispatches: 1,
    maxRetries: 0,
  });
  expect(() => createRealDemoBudget(root)).toThrow('already started');
  expect(() => budget.reserve('run-two', 'deepseek-flash', realDemoPrompts[1])).toThrow();
});
it.each(['failed', 'cancelled', 'interrupted'])(
  'stops on %s without spending a second call',
  (status) => {
    const budget = createRealDemoBudget(directory());
    budget.reserve('one', 'gpt-4.1-mini', realDemoPrompts[0]);
    budget.settle(1, { status });
    expect(() => budget.reserve('two', 'gpt-4.1-mini', realDemoPrompts[1])).toThrow();
  },
);
it('allows exactly two ordered authorized inputs and rejects a third or substituted input', () => {
  const budget = createRealDemoBudget(directory());
  expect(() => budget.reserve('x', 'gpt-4.1-mini', 'different')).toThrow();
  budget.reserve('one', 'gpt-4.1-mini', realDemoPrompts[0]);
  budget.settle(1, { status: 'succeeded' });
  expect(() => budget.reserve('x', 'gpt-4.1-mini', realDemoPrompts[0])).toThrow();
  budget.reserve('two', 'gpt-4.1-mini', realDemoPrompts[1]);
  budget.settle(2, { status: 'succeeded' });
  expect(() => budget.reserve('three', 'gpt-4.1-mini', realDemoPrompts[0])).toThrow();
});

it('binds each real authorization to its fixed directory and resume policy', () => {
  const temporaryRoot = directory();
  const fresh = {
    temporaryRoot,
    directory: join(temporaryRoot, 'caselite-task-demo-dev1650-real-20261109'),
    approval: realDemoFreshId,
    resume: undefined,
  };
  expect(validateRealDemoLaunch(fresh)).toBe(realDemoFreshId);
  expect(() => validateRealDemoLaunch({ ...fresh, approval: realDemoId })).toThrow();
  expect(() => validateRealDemoLaunch({ ...fresh, directory: temporaryRoot })).toThrow();
  expect(validateRealDemoLaunch({ ...fresh, resume: 'resume-1' })).toBe(realDemoFreshId);
  expect(() => validateRealDemoLaunch({ ...fresh, resume: 'resume-2' })).toThrow();
  const old = {
    ...fresh,
    directory: join(temporaryRoot, 'caselite-task-demo-dev1650-real-20261106'),
    approval: realDemoId,
    resume: 'resume-1',
  };
  expect(validateRealDemoLaunch(old)).toBe(realDemoId);
  expect(() => validateRealDemoLaunch({ ...old, resume: undefined })).toThrow();
  expect(() => validateRealDemoLaunch({ ...old, approval: realDemoFreshId })).toThrow();
});

it('keeps the new authorization separate, model-pinned and spent after restart or failure', () => {
  const old = directory();
  const original = createRealDemoBudget(old);
  original.reserve('old-one', 'deepseek-flash', realDemoPrompts[0]);
  const seal = readFileSync(join(old, 'dispatch-1.json'));
  const root = directory();
  const budget = createRealDemoBudget(root, undefined, realDemoFreshId);
  expect(() => budget.reserve('wrong-model', 'gpt-4.1-mini', realDemoPrompts[0])).toThrow();
  budget.reserve('new-one', 'deepseek-flash', realDemoPrompts[0]);
  expect(JSON.parse(readFileSync(join(root, 'dispatch-1.json'), 'utf8')).id).toBe(realDemoFreshId);
  expect(() => createRealDemoBudget(root, undefined, realDemoFreshId)).toThrow();
  expect(() => budget.reserve('no-receipt', 'deepseek-flash', realDemoPrompts[1])).toThrow();
  budget.settle(1, { status: 'failed' });
  expect(() => budget.reserve('after-failure', 'deepseek-flash', realDemoPrompts[1])).toThrow();
  expect(readFileSync(join(old, 'dispatch-1.json'))).toEqual(seal);
});

it('does not permit more than two calls under the new authorization', () => {
  const budget = createRealDemoBudget(directory(), undefined, realDemoFreshId);
  budget.reserve('one', 'deepseek-flash', realDemoPrompts[0]);
  budget.settle(1, { status: 'succeeded' });
  budget.reserve('two', 'deepseek-flash', realDemoPrompts[1]);
  budget.settle(2, { status: 'succeeded' });
  expect(() => budget.reserve('three', 'deepseek-flash', realDemoPrompts[0])).toThrow();
});

it('forwards explicit read-only refresh without forwarding writes or changing budgets', async () => {
  const port = {
    get: () => 'synthetic',
    getDefaultModel: () => 'deepseek-flash' as const,
    refresh: vi.fn(async () => {}),
    set: vi.fn(),
    clear: vi.fn(),
    setDefaultModel: vi.fn(),
  };
  const readonly = readOnlyDemoCredentials(port);
  expect(port.refresh).not.toHaveBeenCalled();
  await readonly.refresh!();
  expect(port.refresh).toHaveBeenCalledTimes(1);
  expect(() => readonly.set('synthetic')).toThrow();
  expect(() => readonly.clear()).toThrow();
  expect(() => readonly.setDefaultModel('gpt-4.1-mini')).toThrow();
  expect(port.set).not.toHaveBeenCalled();
  expect(port.clear).not.toHaveBeenCalled();
  expect(port.setDefaultModel).not.toHaveBeenCalled();
});

// 合成旧失败账本验证追加恢复，不使用真实凭据/SQLite或本机真实费用目录。
function resumeFixture(root: string) {
  const names = [
    'build-manifest.json',
    'caselite-agent-mock.pdf',
    'credential-origin.json',
    'diagnostic.txt',
    'failure-ui.txt',
    'preflight.json',
    'process.json',
    'runner-started',
    'stage.json',
    'validation-failure.png',
    'validation-result.json',
    'validation-started.json',
  ];
  for (const name of names) writeFileSync(join(root, name), 'synthetic old evidence');
  writeFileSync(
    join(root, 'validation-started.json'),
    JSON.stringify({ id: realDemoId, maximumDispatches: 2 }),
  );
  writeFileSync(
    join(root, 'preflight.json'),
    JSON.stringify({
      model: 'deepseek-flash',
      configured: false,
      runs: 0,
      realByok: true,
      credentialErrors: { deepseek: 'UNAVAILABLE' },
    }),
  );
  writeFileSync(
    join(root, 'validation-result.json'),
    JSON.stringify({ passed: false, classification: 'BLOCKED', results: [] }),
  );
  const ready = {
    model: 'deepseek-flash',
    configured: true,
    credentialErrors: { openai: 'UNAVAILABLE' },
    unchanged: true,
    providerDispatches: 0,
    runtimeAttempts: 0,
    httpAttempts: 0,
    refreshes: 1,
  };
  writeFileSync(join(root, 'credential-ready.json'), JSON.stringify(ready));
  const hash = (file: string) =>
    createHash('sha256')
      .update(readFileSync(join(root, file)))
      .digest('hex');
  const approval = {
    authorizationId: realDemoId,
    resumeId: 'resume-1',
    model: 'deepseek-flash',
    maximumDispatches: 2,
    consumedDispatches: 0,
    maxOutputTokens: 2048,
    maxRetries: 0,
    sourceTreeSha256: 'a'.repeat(64),
    bundleSha256: 'b'.repeat(64),
    originalFiles: Object.fromEntries(names.map((name) => [name, hash(name)])),
    databaseFiles: {
      'caselite.sqlite': null,
      'caselite.sqlite-wal': null,
      'caselite.sqlite-shm': null,
    },
    databaseCounts: { agent_runs: 0, material_sources: 0, material_previews: 0 },
    credentialCheck: {
      ...ready,
      classification: 'PASS_REAL',
      evidenceSha256: hash('credential-ready.json'),
    },
  };
  const save = () => writeFileSync(join(root, 'resume-approval.json'), JSON.stringify(approval));
  save();
  return { approval, save, hash };
}
it('preserves the original start and failure evidence while adding exactly two original-budget dispatches', () => {
  const root = directory();
  const fixture = resumeFixture(root);
  const before = fixture.hash('validation-started.json');
  const audit = inspectZeroDispatchResume(root);
  const budget = createRealDemoBudget(root, { audit });
  expect(fixture.hash('validation-started.json')).toBe(before);
  expect(JSON.parse(readFileSync(join(root, 'resume-started.json'), 'utf8'))).toMatchObject({
    authorizationId: realDemoId,
    cumulativeDispatches: 0,
    maximumDispatches: 2,
  });
  budget.reserve('one', 'deepseek-flash', realDemoPrompts[0]);
  budget.settle(1, { status: 'succeeded' });
  budget.reserve('two', 'deepseek-flash', realDemoPrompts[1]);
  budget.settle(2, { status: 'succeeded' });
  expect(() => budget.reserve('three', 'deepseek-flash', realDemoPrompts[0])).toThrow();
  expect(() => inspectZeroDispatchResume(root)).toThrow();
  expect(
    JSON.parse(readFileSync(join(root, 'validation-result.json'), 'utf8')).classification,
  ).toBe('BLOCKED');
});
it.each([
  'dispatch-1.json',
  'receipt-1.json',
  'provider-payload-1.json',
  'http-1.json',
  'context-1.json',
])('rejects original zero-resume when %s exists, even without a receipt', (name) => {
  const root = directory();
  resumeFixture(root);
  writeFileSync(join(root, name), 'synthetic unknown attempt');
  expect(() => inspectZeroDispatchResume(root)).toThrow();
});
it('rejects a nested unknown attempt, a changed original seal, a changed database, and nonzero counts', () => {
  const root = directory();
  const f = resumeFixture(root);
  mkdirSync(join(root, 'resume-old'));
  writeFileSync(join(root, 'resume-old', 'http-1.json'), 'unknown');
  expect(() => inspectZeroDispatchResume(root)).toThrow();
  rmSync(join(root, 'resume-old'), { recursive: true });
  writeFileSync(join(root, 'failure-ui.txt'), 'changed');
  expect(() => inspectZeroDispatchResume(root)).toThrow();
  f.approval.originalFiles['failure-ui.txt'] = f.hash('failure-ui.txt');
  f.save();
  mkdirSync(join(root, 'userData'));
  writeFileSync(join(root, 'userData', 'caselite.sqlite'), 'unexpected database');
  expect(() => inspectZeroDispatchResume(root)).toThrow();
  rmSync(join(root, 'userData'), { recursive: true });
  f.approval.databaseCounts.agent_runs = 1;
  f.save();
  expect(() => inspectZeroDispatchResume(root)).toThrow();
});
it.each([
  'classification',
  'configured',
  'model',
  'providerDispatches',
  'httpAttempts',
  'refreshes',
  'hash',
] as const)('rejects a stale or nonselected credential approval: %s', (field) => {
  const root = directory();
  const f = resumeFixture(root);
  if (field === 'classification') f.approval.credentialCheck.classification = 'MOCK_ONLY';
  if (field === 'configured') f.approval.credentialCheck.configured = false;
  if (field === 'model') f.approval.credentialCheck.model = 'gpt-4.1-mini';
  if (field === 'providerDispatches') f.approval.credentialCheck.providerDispatches = 1;
  if (field === 'httpAttempts') f.approval.credentialCheck.httpAttempts = 1;
  if (field === 'refreshes') f.approval.credentialCheck.refreshes = 2;
  if (field === 'hash') f.approval.credentialCheck.evidenceSha256 = 'f'.repeat(64);
  f.save();
  expect(() => inspectZeroDispatchResume(root)).toThrow();
});
it('rejects reuse, model substitution and changed budget between audit and reserve', () => {
  const root = directory();
  resumeFixture(root);
  const audit = inspectZeroDispatchResume(root);
  const budget = createRealDemoBudget(root, { audit });
  expect(() => createRealDemoBudget(root, { audit })).toThrow();
  expect(() => budget.reserve('x', 'gpt-4.1-mini', realDemoPrompts[0])).toThrow();
  writeFileSync(join(root, 'dispatch-2.json'), 'unknown');
  expect(() => budget.reserve('x', 'deepseek-flash', realDemoPrompts[0])).toThrow();
});
it('uses only the selected Provider status and keeps the model fixed', () => {
  expect(
    selectedCredentialReady({
      model: 'deepseek-flash',
      configured: true,
      credential_errors: { openai: 'UNAVAILABLE' },
    }),
  ).toBe(true);
  expect(
    selectedCredentialReady({
      model: 'deepseek-flash',
      configured: true,
      credential_errors: { deepseek: 'UNAVAILABLE' },
    }),
  ).toBe(false);
  expect(selectedCredentialReady({ model: 'gpt-4.1-mini', configured: true })).toBe(false);
});

function freshResumeFixture(root: string) {
  const fixture = resumeFixture(root);
  fixture.approval.authorizationId = realDemoFreshId;
  delete fixture.approval.originalFiles['validation-started.json'];
  rmSync(join(root, 'validation-started.json'));
  writeFileSync(
    join(root, 'build-manifest.json'),
    JSON.stringify({ authorizationId: realDemoFreshId }),
  );
  fixture.approval.originalFiles['build-manifest.json'] = fixture.hash('build-manifest.json');
  fixture.save();
  return fixture;
}

it('resumes the new zero-dispatch failure once in the same budget without overwriting its evidence', () => {
  const root = directory();
  freshResumeFixture(root);
  const before = readFileSync(join(root, 'validation-result.json'));
  expect(() => inspectZeroDispatchResume(root)).toThrow();
  const audit = inspectZeroDispatchResume(root, false, realDemoFreshId);
  expect(() => createRealDemoBudget(root, { audit })).toThrow();
  const budget = createRealDemoBudget(root, { audit }, realDemoFreshId);
  expect(() => inspectZeroDispatchResume(root, false, realDemoFreshId)).toThrow();
  expect(() => createRealDemoBudget(root, { audit }, realDemoFreshId)).toThrow();
  budget.reserve('one', 'deepseek-flash', realDemoPrompts[0]);
  expect(JSON.parse(readFileSync(join(root, 'dispatch-1.json'), 'utf8')).id).toBe(realDemoFreshId);
  expect(readFileSync(join(root, 'validation-result.json'))).toEqual(before);
});

it.each(['dispatch-1.json', 'receipt-1.json', 'http-1.json', 'context-1.json'])(
  'rejects the new resume with any prior or ambiguous attempt: %s',
  (name) => {
    const root = directory();
    freshResumeFixture(root);
    writeFileSync(join(root, name), 'synthetic unknown attempt');
    expect(() => inspectZeroDispatchResume(root, false, realDemoFreshId)).toThrow();
  },
);

it('rejects new resume on changed source evidence or nonzero database state', () => {
  const root = directory();
  const fixture = freshResumeFixture(root);
  writeFileSync(join(root, 'failure-ui.txt'), 'changed');
  expect(() => inspectZeroDispatchResume(root, false, realDemoFreshId)).toThrow();
  fixture.approval.originalFiles['failure-ui.txt'] = fixture.hash('failure-ui.txt');
  fixture.approval.databaseCounts.agent_runs = 1;
  fixture.save();
  expect(() => inspectZeroDispatchResume(root, false, realDemoFreshId)).toThrow();
});
