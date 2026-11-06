import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  writeFileSync,
  openSync,
  closeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, relative } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dry = process.argv.includes('--dry');
const resume = process.argv.includes('--resume-zero');
const credentialUi = process.argv.includes('--credential-ui');
if (credentialUi && (dry || resume || process.argv.includes('--approved-two-calls')))
  throw new Error('Credential UI is a separate zero-API check.');
if (!credentialUi && !dry && (!resume || !process.argv.includes('--approved-two-calls')))
  throw new Error(
    'Real mode requires --resume-zero --approved-two-calls after independent review.',
  );
const appRoot = process.env.CASELITE_FORGE_OUT_DIR
  ? resolve(process.env.CASELITE_FORGE_OUT_DIR, 'CaseLite-darwin-arm64/CaseLite.app')
  : join(root, 'apps/desktop/out/CaseLite-darwin-arm64/CaseLite.app');
const binary = join(appRoot, 'Contents/MacOS/CaseLite');
if (!existsSync(binary)) throw new Error('Package the reviewed source first.');
const fixed = join(realpathSync(tmpdir()), 'caselite-task-demo-dev1650-real-20261106');
const directory = credentialUi
  ? mkdtempSync(join(tmpdir(), 'caselite-task-demo-credential-final-'))
  : dry
    ? mkdtempSync(join(tmpdir(), 'caselite-task-demo-real-dry-'))
    : fixed;
const digest = (data) => createHash('sha256').update(data).digest('hex');
const expected = 'fb59f0d58e887bbd3e30d77619c33fca9162e73dfa298efc29cc73ee5a049741';
const fixture = join(root, 'tests/fixtures/case-materials/development/agent-console-mock.pdf');
if (digest(readFileSync(fixture)) !== expected) throw new Error('Fixture changed.');
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
// dry在自己的临时目录模拟旧零派发失败，绝不打开或修改真实费用账本。
if (dry && resume) {
  for (const name of originalNames)
    writeFileSync(join(directory, name), 'synthetic original preflight evidence');
  writeFileSync(
    join(directory, 'validation-started.json'),
    JSON.stringify({ id: 'DEV-1650-20261106-two-calls', maximumDispatches: 2 }),
  );
  writeFileSync(
    join(directory, 'preflight.json'),
    JSON.stringify({
      model: 'deepseek-flash',
      configured: false,
      runs: 0,
      realByok: true,
      credentialErrors: { deepseek: 'UNAVAILABLE' },
    }),
  );
  writeFileSync(
    join(directory, 'validation-result.json'),
    JSON.stringify({ passed: false, classification: 'BLOCKED', results: [] }),
  );
  copyFileSync(fixture, join(directory, 'caselite-agent-mock.pdf'));
}
const evidence = resume ? join(directory, 'resume-1') : directory;
if (!dry && !credentialUi) {
  if (!existsSync(join(directory, 'resume-approval.json')))
    throw new Error('Independent zero-dispatch and final credential approval is missing.');
  const oldProcess = JSON.parse(readFileSync(join(directory, 'process.json'), 'utf8'));
  try {
    process.kill(oldProcess.pid, 0);
    throw new Error('Original test PID is still present; reconcile before resume.');
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}
if (resume) mkdirSync(evidence, { mode: 0o700 });
// 每个恢复尝试仅排他追加；不移除原runner/validation标记，不自动重试或另建真实目录。
closeSync(openSync(join(evidence, 'runner-started'), 'wx', 0o600));
if (!resume && !credentialUi) copyFileSync(fixture, join(directory, 'caselite-agent-mock.pdf'));
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
  cwd: root,
  encoding: 'utf8',
})
  .trim()
  .split('\n');
const source = Object.fromEntries(
  files
    .filter((file) => existsSync(join(root, file)))
    .map((file) => [file, digest(readFileSync(join(root, file)))]),
);
const bundle = {};
function fingerprint(path) {
  for (const item of readdirSync(path, { withFileTypes: true })) {
    const p = join(path, item.name);
    if (item.isDirectory()) fingerprint(p);
    else if (item.isFile()) bundle[relative(appRoot, p)] = digest(readFileSync(p));
  }
}
fingerprint(appRoot);
const build = {
  head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  source,
  bundle,
  sourceTreeSha256: digest(JSON.stringify(source)),
  bundleSha256: digest(JSON.stringify(bundle)),
  fixtureSha256: expected,
  appRoot,
  dry,
  credentialUi,
  resume,
};
writeFileSync(join(evidence, 'build-manifest.json'), JSON.stringify(build, null, 2));
if (dry && resume) {
  const ready = {
    model: 'deepseek-flash',
    configured: true,
    credentialErrors: { openai: 'UNAVAILABLE' },
    unchanged: true,
    refreshes: 1,
    providerDispatches: 0,
    runtimeAttempts: 0,
    httpAttempts: 0,
  };
  writeFileSync(join(directory, 'credential-ready.json'), JSON.stringify(ready));
  const approval = {
    authorizationId: 'DEV-1650-20261106-two-calls',
    resumeId: 'resume-1',
    model: 'deepseek-flash',
    maximumDispatches: 2,
    consumedDispatches: 0,
    maxOutputTokens: 2048,
    maxRetries: 0,
    sourceTreeSha256: build.sourceTreeSha256,
    bundleSha256: build.bundleSha256,
    originalFiles: Object.fromEntries(
      originalNames.map((name) => [name, digest(readFileSync(join(directory, name)))]),
    ),
    databaseFiles: {
      'caselite.sqlite': null,
      'caselite.sqlite-wal': null,
      'caselite.sqlite-shm': null,
    },
    databaseCounts: { agent_runs: 0, material_sources: 0, material_previews: 0 },
    credentialCheck: {
      ...ready,
      classification: 'MOCK_ONLY',
      evidenceSha256: digest(readFileSync(join(directory, 'credential-ready.json'))),
    },
  };
  writeFileSync(join(directory, 'resume-approval.json'), JSON.stringify(approval, null, 2));
}
if (resume) {
  const approval = JSON.parse(readFileSync(join(directory, 'resume-approval.json'), 'utf8'));
  if (
    approval.sourceTreeSha256 !== build.sourceTreeSha256 ||
    approval.bundleSha256 !== build.bundleSha256
  )
    throw new Error('Reviewed source or bundle changed.');
}
const child = spawn(binary, [], {
  cwd: root,
  detached: !dry,
  stdio: ['ignore', 'ignore', 'ignore'],
  env: {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    LANG: process.env.LANG,
    CASELITE_TASK_DEMO: credentialUi
      ? 'credential-preflight-ui'
      : dry
        ? 'real-agent-dry'
        : 'real-agent',
    CASELITE_TASK_DEMO_DIR: directory,
    ...(resume ? { CASELITE_REAL_AGENT_RESUME: 'resume-1' } : {}),
    ...(!dry && !credentialUi
      ? { CASELITE_REAL_AGENT_APPROVAL: 'DEV-1650-20261106-two-calls' }
      : {}),
  },
});
writeFileSync(
  join(evidence, 'process.json'),
  JSON.stringify(
    {
      pid: child.pid,
      directory,
      evidence,
      binary,
      dry,
      credentialUi,
      resume,
      startedAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);
process.stdout.write(
  `Isolated ${credentialUi ? 'CREDENTIAL UI; zero API' : dry ? 'MOCK_ONLY' : 'REAL; original total maximum two dispatches'}: ${evidence}\n`,
);
let exited = false;
child.once('error', () => {
  exited = true;
});
child.once('exit', () => {
  exited = true;
});
if (credentialUi) {
  child.unref();
  process.stdout.write(
    'Use the actual settings refresh button at most once; leave the instance for observation if blocked.\n',
  );
  process.exit(0);
}
for (let i = 0; i < 1000; i++) {
  const result = join(evidence, 'validation-result.json');
  if (existsSync(result)) {
    const outcome = JSON.parse(readFileSync(result, 'utf8'));
    process.stdout.write(
      `Validation ${outcome.passed ? 'passed' : 'stopped'}; evidence: ${evidence}\n`,
    );
    if (!dry) child.unref();
    else if (!exited) await new Promise((done) => child.once('exit', done));
    process.exit(outcome.passed ? 0 : 1);
  }
  if (exited) {
    process.stderr.write(`Validation process exited; reconcile ${evidence}; no retry.\n`);
    process.exit(1);
  }
  await new Promise((done) => setTimeout(done, 200));
}
child.unref();
process.stderr.write(`Unknown receipt; do not retry. Check ${evidence}\n`);
process.exitCode = 1;
