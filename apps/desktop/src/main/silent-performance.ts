import { app, BrowserWindow, session } from 'electron';
import { writeFileSync } from 'node:fs';
import { sep } from 'node:path';
import { performance } from 'node:perf_hooks';

export async function runSilentPerformance(
  create: () => Promise<BrowserWindow>,
  root: string,
  output: string,
  marks: Record<string, number>,
  start: bigint,
) {
  const samples: unknown[] = [];
  let failure: string | undefined;
  const resources = [
    app.getPath('userData'),
    app.getPath('sessionData'),
    app.getPath('logs'),
    app.getPath('crashDumps'),
    session.defaultSession.storagePath,
  ];
  if (resources.some((path) => !path?.startsWith(root + sep)))
    throw new Error('Silent performance isolation rejected');
  const sample = () => {
    const windows = BrowserWindow.getAllWindows();
    if (windows.some((w) => w.isVisible() || w.isFocused())) {
      failure = 'Window became visible or focused';
      for (const window of windows) window.hide();
    }
    samples.push({
      ms: Number(process.hrtime.bigint() - start) / 1e6,
      windows: windows.map((w) => ({ visible: w.isVisible(), focused: w.isFocused() })),
      processes: app.getAppMetrics().map((p) => ({
        pid: p.pid,
        type: p.type,
        cpu: p.cpu,
        memory: p.memory,
        creationTime: p.creationTime,
      })),
    });
  };
  const interval = setInterval(sample, 500);
  try {
    const window = await create();
    marks.windowLoadedMs = Number(process.hrtime.bigint() - start) / 1e6;
    const deadline = performance.now() + 20000;
    let ready: unknown = null;
    while (performance.now() < deadline) {
      ready = await window.webContents.executeJavaScript(`(async () => {
        const input = document.querySelector('[data-testid="agent-input"]');
        const home = document.querySelector('[data-nav="home"]');
        if (!input || input.disabled || !home || document.querySelector('.loading-state')) return null;
        const result = await window.caselite.task({protocol_version:1,operation:'list'});
        if (!result.ok || result.tasks.length !== 10 || result.tasks.some((t) => !t.title.startsWith('合成静默性能任务'))) return null;
        return {taskCount:result.tasks.length,visibility:document.visibilityState,
          focused:document.hasFocus(),inputEnabled:!input.disabled,ipcRead:true};
      })()`);
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!ready) throw new Error('Silent first-screen readiness timed out');
    marks.firstScreenOperableMs = Number(process.hrtime.bigint() - start) / 1e6;
    sample();
    await new Promise((resolve) => setTimeout(resolve, 15000));
    sample();
    if (failure) throw new Error(failure);
    writeFileSync(
      output,
      JSON.stringify(
        {
          version: 1,
          status: 'PASS_REAL',
          scope: 'hidden-product-window',
          marks,
          ready,
          resources,
          samples,
          excluded: [
            'system credentials',
            'legal consent UI',
            'OS notifications',
            'visible paint and user input',
          ],
          backgroundThrottling: false,
        },
        null,
        2,
      ),
      { flag: 'wx' },
    );
  } finally {
    clearInterval(interval);
  }
}
