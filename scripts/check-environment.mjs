import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const rootDirectory = fileURLToPath(new URL('..', import.meta.url));
const packageJsonPath = new URL('../package.json', import.meta.url);
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
const checks = [];

function pass(name, detail) {
  checks.push({ name, detail, passed: true });
}

function fail(name, detail) {
  checks.push({ name, detail, passed: false });
}

function commandOutput(command, argumentsList) {
  try {
    return execFileSync(command, argumentsList, {
      cwd: rootDirectory,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    const reason = error.stderr?.toString().trim() || error.message;
    throw new Error(reason, { cause: error });
  }
}

function expectExactVersion(name, actual, expected) {
  if (actual === expected) {
    pass(name, actual);
  } else {
    fail(name, `需要 ${expected}，当前为 ${actual || '未检测到'}`);
  }
}

expectExactVersion('Node.js', process.version.replace(/^v/, ''), packageJson.engines.node);

try {
  expectExactVersion('pnpm', commandOutput('pnpm', ['--version']), packageJson.engines.pnpm);
} catch (error) {
  fail('pnpm', error.message);
}

try {
  pass('Git', commandOutput('git', ['--version']));
} catch (error) {
  fail('Git', error.message);
}

const expectedPackageManager = `pnpm@${packageJson.engines.pnpm}`;
if (packageJson.packageManager === expectedPackageManager) {
  pass('packageManager', packageJson.packageManager);
} else {
  fail(
    'packageManager',
    `需要 ${expectedPackageManager}，当前为 ${packageJson.packageManager || '未设置'}`,
  );
}

const npmrcPath = new URL('../.npmrc', import.meta.url);
if (existsSync(npmrcPath) && readFileSync(npmrcPath, 'utf8').includes('node-linker=hoisted')) {
  pass('.npmrc', 'node-linker=hoisted');
} else {
  fail('.npmrc', '缺少已验证的 node-linker=hoisted 配置');
}

if (process.platform === 'darwin') {
  try {
    pass('Xcode Command Line Tools', commandOutput('xcode-select', ['-p']));
  } catch (error) {
    fail('Xcode Command Line Tools', error.message);
  }
} else {
  fail('开发平台', `当前为 ${process.platform}；本阶段仅验证 macOS Apple Silicon 桌面构建`);
}

for (const check of checks) {
  console.log(`${check.passed ? 'PASS' : 'FAIL'} ${check.name}: ${check.detail}`);
}

if (checks.some((check) => !check.passed)) {
  process.exitCode = 1;
} else {
  console.log('开发环境检查通过。');
}
