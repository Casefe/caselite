import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const binary = join(
  root,
  'apps/desktop/out/CaseLite-darwin-arm64/CaseLite.app/Contents/MacOS/CaseLite',
);
if (!existsSync(binary)) throw new Error('请先运行 pnpm package。');
const directory = mkdtempSync(join(tmpdir(), 'caselite-task-demo-interactive-'));
const fixture = join(root, 'artifacts/research/agent-console-2026-11-06/caselite-agent-mock.pdf');
if (existsSync(fixture)) copyFileSync(fixture, join(directory, 'caselite-agent-mock.pdf'));
const child = spawn(binary, [], {
  cwd: root,
  env: { ...process.env, CASELITE_TASK_DEMO: 'agent-preview', CASELITE_TASK_DEMO_DIR: directory },
  detached: true,
  stdio: 'ignore',
});
child.once('error', () => {
  process.stderr.write('无法启动 mock 验收应用。\n');
  process.exitCode = 1;
});
child.unref();
process.stdout.write(
  `MOCK_ONLY 离线验收应用已启动；不读取正式工作区或真实 Key。\n隔离数据与 mock PDF：${directory}\n输入文字发送，再拖入该目录的 mock PDF＋文字发送；固定合成输出仅验证流程。\n`,
);
