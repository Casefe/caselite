import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const output = process.env.CASELITE_FORGE_OUT_DIR
  ? resolve(process.env.CASELITE_FORGE_OUT_DIR)
  : join(root, 'apps/desktop/out');
const binary = join(output, 'CaseLite-darwin-arm64/CaseLite.app/Contents/MacOS/CaseLite');
if (!existsSync(binary)) throw new Error('请先在隔离验证副本打包。');
const directory = mkdtempSync(join(tmpdir(), 'caselite-task-demo-reminder-interactive-'));
const child = spawn(binary, [], {
  cwd: root,
  env: {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    LANG: process.env.LANG,
    CASELITE_TASK_DEMO: 'reminder-preview',
    CASELITE_TASK_DEMO_DIR: directory,
  },
  detached: true,
  stdio: 'ignore',
});
child.once('error', () => {
  process.stderr.write('无法启动本机提醒验收。\n');
  process.exitCode = 1;
});
child.unref();
process.stdout.write(
  `合成工作区已打开：正式提醒代码/SQLite/OS通知，零Provider派发。\n隔离数据：${directory}\n“提醒”→当前计划→合成提醒验收→改期/取消；或返回原任务，在属性栏设置提醒。退出、关机或休眠期间不保证准时。系统显示/权限及律师接收另验。\n`,
);
