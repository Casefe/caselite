import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { agentProviderFor, type AgentModel, type AgentProvider } from '@caselite/contracts';

export const realDemoId = 'DEV-1650-20261106-two-calls';
export const realDemoFreshId = 'DEV-1650-20261109-two-calls';
export type RealDemoAuthorization = typeof realDemoId | typeof realDemoFreshId;

export function validateRealDemoLaunch(input: {
  directory: string;
  temporaryRoot: string;
  approval: string | undefined;
  resume: string | undefined;
}): RealDemoAuthorization {
  if (
    input.directory === join(input.temporaryRoot, 'caselite-task-demo-dev1650-real-20261106') &&
    input.approval === realDemoId &&
    input.resume === 'resume-1'
  )
    return realDemoId;
  // 新授权使用独立、固定账本；不能借新授权恢复或清零已消费的旧批次。
  if (
    input.directory === join(input.temporaryRoot, 'caselite-task-demo-dev1650-real-20261109') &&
    input.approval === realDemoFreshId &&
    (input.resume === undefined || input.resume === 'resume-1')
  )
    return realDemoFreshId;
  throw new Error('Real validation launch is outside its approved batch');
}
export const realDemoPrompts = [
  '以下完全是虚构界面测试：样例甲公司向样例乙公司采购设备，总价120000元，已付80000元，约定2026-10-20交付，截至2026-11-01尚未交付。请用中文分已知事实、尚缺材料、下一步简短列项，不作法律结论；只回答，不执行工具或创建对象。',
  '只根据本轮附上的虚构PDF，用中文列出双方、合同总价、已付款、交付日、截至何日未交付，并原样输出Verification marker；列两项尚缺材料。不要作法律结论，不访问其他材料或历史。',
] as const;
export const realDemoPdfHash = 'fb59f0d58e887bbd3e30d77619c33fca9162e73dfa298efc29cc73ee5a049741';
export const realDemoMarker = 'CASELITE-MOCK-20261106-ALPHA';

export { readOnlyDemoCredentials } from './credential-preflight';

export const realDemoResumeId = 'resume-1';
const digest = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const originalNames = [
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
export function selectedCredentialReady(
  state: {
    model: AgentModel;
    configured: boolean;
    credential_errors?: Partial<Record<AgentProvider, 'UNAVAILABLE'>>;
  },
  expectedModel: AgentModel = 'deepseek-flash',
) {
  return (
    state.model === expectedModel &&
    state.configured &&
    !state.credential_errors?.[agentProviderFor(state.model)]
  );
}

export function inspectZeroDispatchResume(
  directory: string,
  dry = false,
  authorization: RealDemoAuthorization = realDemoId,
) {
  const names =
    authorization === realDemoFreshId
      ? originalNames.filter((name) => name !== 'validation-started.json')
      : originalNames;
  const approvalBytes = readFileSync(join(directory, 'resume-approval.json'));
  const approval = JSON.parse(approvalBytes.toString());
  const read = (name: string) => JSON.parse(readFileSync(join(directory, name), 'utf8'));
  if (
    approval.authorizationId !== authorization ||
    approval.resumeId !== realDemoResumeId ||
    approval.model !== 'deepseek-flash' ||
    approval.maximumDispatches !== 2 ||
    approval.consumedDispatches !== 0 ||
    approval.maxOutputTokens !== 2048 ||
    approval.maxRetries !== 0 ||
    !/^[a-f0-9]{64}$/.test(approval.sourceTreeSha256) ||
    !/^[a-f0-9]{64}$/.test(approval.bundleSha256)
  )
    throw new Error('Invalid reviewed resume approval');
  const check = approval.credentialCheck;
  if (
    !check ||
    check.classification !== (dry ? 'MOCK_ONLY' : 'PASS_REAL') ||
    check.model !== 'deepseek-flash' ||
    check.configured !== true ||
    check.unchanged !== true ||
    check.providerDispatches !== 0 ||
    check.runtimeAttempts !== 0 ||
    check.httpAttempts !== 0 ||
    check.refreshes > 1 ||
    !Number.isInteger(check.refreshes) ||
    check.refreshes < 0 ||
    !/^[a-f0-9]{64}$/.test(check.evidenceSha256)
  )
    throw new Error('Final selected credential check not approved');
  const readyBytes = readFileSync(join(directory, 'credential-ready.json'));
  const ready = JSON.parse(readyBytes.toString());
  if (
    digest(readyBytes) !== check.evidenceSha256 ||
    ready.model !== 'deepseek-flash' ||
    ready.configured !== true ||
    ready.credentialErrors?.deepseek ||
    ready.unchanged !== true ||
    ready.providerDispatches !== 0 ||
    ready.runtimeAttempts !== 0 ||
    ready.httpAttempts !== 0 ||
    ready.refreshes !== check.refreshes ||
    ['agent_runs', 'material_sources', 'material_previews'].some(
      (name) => approval.databaseCounts?.[name] !== 0,
    )
  )
    throw new Error('Selected credential or zero-database evidence mismatch');
  if (
    Object.keys(approval.originalFiles ?? {})
      .sort()
      .join('|') !== [...names].sort().join('|')
  )
    throw new Error('Incomplete original evidence seal');
  for (const name of names) {
    if (digest(readFileSync(join(directory, name))) !== approval.originalFiles[name])
      throw new Error('Original evidence changed');
  }
  // 只接受固定原库的审查指纹；不接受任意路径或跳过WAL，打开库前由Main再次核对。
  const databaseNames = ['caselite.sqlite', 'caselite.sqlite-wal', 'caselite.sqlite-shm'];
  if (
    Object.keys(approval.databaseFiles ?? {})
      .sort()
      .join('|') !== [...databaseNames].sort().join('|')
  )
    throw new Error('Incomplete database seal');
  for (const name of databaseNames) {
    const path = join(directory, 'userData', name);
    const actual = existsSync(path) ? digest(readFileSync(path)) : null;
    if (actual !== approval.databaseFiles[name]) throw new Error('Original database changed');
  }
  const oldPreflight = read('preflight.json'),
    oldResult = read('validation-result.json');
  if (authorization === realDemoFreshId) {
    if (
      read('build-manifest.json').authorizationId !== realDemoFreshId ||
      existsSync(join(directory, 'validation-started.json'))
    )
      throw new Error('New batch is not an unconsumed preflight failure');
  } else {
    const oldStart = read('validation-started.json');
    if (oldStart.id !== realDemoId || oldStart.maximumDispatches !== 2)
      throw new Error('Original validation authorization mismatch');
  }
  if (
    oldPreflight.model !== 'deepseek-flash' ||
    oldPreflight.configured !== false ||
    oldPreflight.runs !== 0 ||
    oldPreflight.realByok !== true ||
    oldPreflight.credentialErrors?.deepseek !== 'UNAVAILABLE' ||
    oldResult.passed !== false ||
    oldResult.classification !== 'BLOCKED' ||
    !Array.isArray(oldResult.results) ||
    oldResult.results.length
  )
    throw new Error('Original zero-dispatch preflight is inconsistent');
  const scan = (path: string) => {
    for (const item of readdirSync(path, { withFileTypes: true })) {
      if (
        /^(dispatch-|receipt-|provider-payload-|http-|context-|result-[12]\.|ui-send-)/.test(
          item.name,
        )
      )
        throw new Error(
          'Existing dispatch or ambiguous evidence consumes budget; zero-dispatch resume refused',
        );
      if (item.isSymbolicLink()) throw new Error('Unexpected linked resume evidence');
      if (item.isDirectory() && item.name.startsWith('resume-')) scan(join(path, item.name));
    }
  };
  scan(directory);
  if (existsSync(join(directory, 'resume-started.json')))
    throw new Error('Resume already consumed');
  return {
    authorizationId: authorization,
    approvalSha256: digest(approvalBytes),
    originalFiles: approval.originalFiles,
    consumedDispatches: 0,
    sourceTreeSha256: approval.sourceTreeSha256,
    bundleSha256: approval.bundleSha256,
  };
}

// 原预算始终留在固定根目录；恢复只追加引用，不重建起点或把进程重启当成新额度。
export function createRealDemoBudget(
  directory: string,
  resume?: { audit: ReturnType<typeof inspectZeroDispatchResume> },
  authorization: RealDemoAuthorization = realDemoId,
) {
  if (
    ![realDemoId, realDemoFreshId].includes(authorization) ||
    (resume && resume.audit.authorizationId !== authorization)
  )
    throw new Error('Invalid validation authorization');
  const durable = (name: string, value: unknown) => {
    const fd = openSync(join(directory, name), 'wx', 0o600);
    try {
      writeFileSync(fd, JSON.stringify(value, null, 2));
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  };
  if (resume) {
    if (
      (authorization === realDemoId && !existsSync(join(directory, 'validation-started.json'))) ||
      digest(readFileSync(join(directory, 'resume-approval.json'))) !==
        resume.audit.approvalSha256 ||
      resume.audit.consumedDispatches !== 0
    )
      throw new Error('Resume audit changed');
    for (const [name, expected] of Object.entries(resume.audit.originalFiles)) {
      if (!originalNames.includes(name) || digest(readFileSync(join(directory, name))) !== expected)
        throw new Error('Original evidence changed after audit');
    }
    if (
      readdirSync(directory).some((name) =>
        /^(dispatch-|receipt-|provider-payload-|http-|context-|result-[12]\.|ui-send-)/.test(name),
      )
    )
      throw new Error('Budget changed after audit');
    durable('resume-started.json', {
      resumeId: realDemoResumeId,
      ...resume.audit,
      cumulativeDispatches: resume.audit.consumedDispatches,
      maximumDispatches: 2,
      time: new Date().toISOString(),
    });
    if (authorization === realDemoFreshId)
      durable('validation-started.json', {
        id: authorization,
        maximumDispatches: 2,
        startedAt: new Date().toISOString(),
      });
  } else {
    if (existsSync(join(directory, 'validation-started.json')))
      throw new Error('Validation already started; reconcile existing receipts');
    durable('validation-started.json', {
      id: authorization,
      maximumDispatches: 2,
      startedAt: new Date().toISOString(),
    });
  }
  let count = resume?.audit.consumedDispatches ?? 0;
  return {
    reserve(runId: string, model: string, prompt: string) {
      const actual = readdirSync(directory).filter((name) => /^dispatch-/.test(name)).length;
      if (
        actual !== count ||
        count >= 2 ||
        prompt !== realDemoPrompts[count] ||
        ((resume || authorization === realDemoFreshId) && model !== 'deepseek-flash')
      )
        throw new Error('Outside authorized phase or budget changed');
      if (
        count &&
        JSON.parse(readFileSync(join(directory, 'receipt-1.json'), 'utf8')).status !== 'succeeded'
      )
        throw new Error('Previous receipt failed or unknown');
      const next = count + 1;
      durable(`dispatch-${next}.json`, {
        id: authorization,
        runId,
        model,
        phase: next === 1 ? 'text' : 'pdf',
        cumulativeDispatches: next,
        maxOutputTokens: 2048,
        maxRetries: 0,
        dispatchedAt: new Date().toISOString(),
      });
      count = next;
      return count;
    },
    settle(index: number, result: { status: string; [key: string]: unknown }) {
      if (index !== count || index < 1) throw new Error('Invalid receipt phase');
      durable(`receipt-${index}.json`, result);
    },
  };
}
