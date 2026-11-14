import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const isolated = mkdtempSync(join(tmpdir(), 'caselite-task-demo-project-'));
const properties = process.argv.includes('--properties');
const lifecycle = process.argv.includes('--lifecycle');
const promotion = process.argv.includes('--promote');
const activity = process.argv.includes('--activity');
const files = process.argv.includes('--files') || activity;
copyFileSync(
  join(root, 'tests/fixtures/case-materials/development/contract-v1-text.pdf'),
  join(isolated, 'fixture.pdf'),
);
const output =
  process.env.CASELITE_PROJECT_DEMO_OUTPUT ??
  join(
    root,
    'artifacts/evidence',
    properties
      ? 'project-properties-demo'
      : activity
        ? 'project-activity-demo'
        : files
          ? 'project-files-demo'
          : promotion
            ? 'project-promotion-demo'
            : lifecycle
              ? 'project-lifecycle-demo'
              : 'project-demo',
  );
mkdirSync(output, { recursive: true });
const phases = [];
const requestedPhases = activity
  ? [
      'project-promote',
      'project-files',
      'project-files-read',
      'project-activity',
      'project-activity-read',
    ]
  : files
    ? ['project-promote', 'project-files', 'project-files-read']
    : promotion
      ? ['project-promote', 'project-promote-read']
      : lifecycle
        ? ['project-write', 'project-edit', 'project-restore']
        : ['project-write', 'project-read'];
for (const phase of requestedPhases) {
  const result = spawnSync(
    process.env.CASELITE_PROJECT_DEMO_APP ??
      join(root, 'apps/desktop/out/CaseLite-darwin-arm64/CaseLite.app/Contents/MacOS/CaseLite'),
    [],
    {
      cwd: root,
      env: {
        ...process.env,
        ...(properties ? { CASELITE_PROJECT_PROPERTIES: 'test' } : {}),
        CASELITE_TASK_DEMO: phase,
        CASELITE_TASK_DEMO_DIR: isolated,
      },
      encoding: 'utf8',
      timeout: properties ? 90_000 : 45_000,
      killSignal: 'SIGKILL',
    },
  );
  phases.push({ phase, exitCode: result.status, signal: result.signal, stderr: result.stderr });
  writeFileSync(
    join(output, 'result.json'),
    JSON.stringify(
      {
        commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
        dirty:
          execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()
            .length > 0,
        appAsarSha256: createHash('sha256')
          .update(
            readFileSync(
              join(
                process.env.CASELITE_PROJECT_DEMO_APP
                  ? resolve(process.env.CASELITE_PROJECT_DEMO_APP, '../../Resources/app.asar')
                  : resolve(
                      root,
                      'apps/desktop/out/CaseLite-darwin-arm64/CaseLite.app/Contents/Resources/app.asar',
                    ),
              ),
            ),
          )
          .digest('hex'),
        isolated,
        phases,
        network: 'HTTP(S) blocked in the test session; physical network remains connected',
        status: phases.some((p) => p.exitCode !== 0)
          ? 'FAIL'
          : phases.length === requestedPhases.length
            ? 'PASS_REAL'
            : 'NOT_COMPLETE',
        unverified: [
          'Human experience acceptance',
          'System IME candidate selection',
          'Power or device loss',
        ],
      },
      null,
      2,
    ),
  );
  if (result.status !== 0) throw new Error(`Project ${phase} failed; inspect ${isolated}`);
}
for (const name of properties
  ? [
      'properties-expected.json',
      'properties-write.json',
      'properties-read.json',
      'properties-native-date.json',
      'properties-reopened.png',
      ...['create', 'sidebar', 'save'].flatMap((view) =>
        [1440, 640].flatMap((width) =>
          ['light', 'dark'].map((theme) => `properties-${view}-${width}-${theme}.png`),
        ),
      ),
      'properties-save-failed.png',
    ]
  : activity
    ? [
        'project-files-list.png',
        'project-files-missing.png',
        'project-files-recovered.png',
        'project-files-reopened.png',
        'files-expected.json',
        'document-workspace-layout.json',
        'document-workspace-1580.png',
        'document-workspace-640.png',
        'document-workspace-original.png',
        'document-workspace-version.png',
        'project-activity-save-failed.png',
        'project-activity-saved.png',
        'project-activity-reopened.png',
        'project-activity-original-task.png',
        'activity-expected.json',
        'dev-1802-project-graph.json',
        'dev-1802-project-graph.png',
        'dev-1802-project-graph-dragged.png',
        'dev-1802-project-graph-preview.png',
        'dev-1802-project-graph-sample.png',
      ]
    : files
      ? [
          'project-files-list.png',
          'project-files-missing.png',
          'project-files-recovered.png',
          'project-files-reopened.png',
          'files-expected.json',
          'project-files.json',
          'project-files-read.json',
          'document-workspace-layout.json',
          'document-workspace-1580.png',
          'document-workspace-640.png',
          'document-workspace-original.png',
          'document-workspace-version.png',
          'dev-1802-project-graph.json',
          'dev-1802-project-graph.png',
          'dev-1802-project-graph-dragged.png',
          'dev-1802-project-graph-preview.png',
          'dev-1802-project-graph-sample.png',
        ]
      : promotion
        ? [
            'project-from-task.png',
            'project-task-linked.png',
            'project-original-task-reopened.png',
            'project-overview-summary.png',
            'project-sections.png',
            'promotion-expected.json',
          ]
        : [
            'project-create.png',
            'project-created.png',
            'project-reopened.png',
            'project-expected.json',
            ...(lifecycle
              ? ['project-edited.png', 'project-archived.png', 'project-restored.png']
              : []),
          ])
  copyFileSync(join(isolated, name), join(output, name));
if (process.env.CASELITE_PROJECT_CREATE_UI === '1')
  for (const name of [
    'create-ui-layout.json',
    'create-ui-filled.png',
    ...[1440, 640].flatMap((width) =>
      ['dark', 'light'].map((theme) => `create-ui-${width}-${theme}.png`),
    ),
  ])
    copyFileSync(join(isolated, name), join(output, name));
process.stdout.write(`Project create/reopen passed; evidence ${output}\n`);
