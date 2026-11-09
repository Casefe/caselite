import type { BrowserWindow } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { createMaterialBatchApplication } from '@caselite/application';
import type { MaterialBatchResponse, MaterialResponse } from '@caselite/contracts';
import { scanMaterialBatch } from './adapters/material-batch-files';

export async function runMaterialBatchDemo(
  create: () => Promise<BrowserWindow>,
  directory: string,
  phase: string,
  batches: ReturnType<typeof createMaterialBatchApplication>,
) {
  const read = phase === 'materials-batch-read';
  if (!read) {
    // 固定合成临时目录替代系统选择器；保存/回读仍走真实Renderer→Preload→IPC→Application。
    const preview = await batches.create(
      'home',
      '合成补件批次',
      await scanMaterialBatch([join(directory, 'batch-input')], true),
    );
    if (!preview.ok || !preview.batch) throw new Error('Batch preview failed');
  }
  const window = await create();
  window.webContents.debugger.attach('1.3');
  await window.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const evaluate = (code: string) => window.webContents.executeJavaScript(code);
  async function waitFor(code: string) {
    for (let i = 0; i < 150; i++) {
      if (await evaluate(code)) return;
      await new Promise((done) => setTimeout(done, 200));
    }
    throw new Error('Batch UI timeout: ' + code);
  }
  async function capture(name: string) {
    await evaluate('new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))');
    const shot = await window.webContents.debugger.sendCommand('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
    });
    writeFileSync(join(directory, name + '.png'), Buffer.from(shot.data, 'base64'));
  }
  await waitFor("Boolean(document.querySelector('[aria-label=材料批次] li'))");
  await capture(read ? 'batch-reopened' : 'batch-preview');
  if (!read) {
    await evaluate(
      "[...document.querySelectorAll('button')].find(el=>el.textContent==='保存本批材料').click()",
    );
    await waitFor(
      "document.querySelector('[aria-label=材料批次]').textContent.includes('已保存 2 项') && document.querySelector('[aria-label=材料批次]').textContent.includes('继续保存未完成项')",
    );
  }
  const result = (await evaluate(
    "window.caselite.materialBatch({protocol_version:1,operation:'list',scope:'home'})",
  )) as MaterialBatchResponse;
  const materials = (await evaluate(
    "window.caselite.material({protocol_version:1,operation:'list',scope:'home'})",
  )) as MaterialResponse;
  if (
    !result.ok ||
    !result.batch ||
    !materials.ok ||
    materials.materials.length !== 2 ||
    result.batch.items.filter((item) => item.state === 'failed').length !== 1 ||
    result.batch.items.filter((item) => item.state === 'skipped').length !== 1
  )
    throw new Error('Batch mixed result mismatch');
  const ids = materials.materials.map((item) => item.id);
  if (read) {
    const before = JSON.parse(readFileSync(join(directory, 'batch-write.json'), 'utf8'));
    if (JSON.stringify(ids) !== JSON.stringify(before.ids))
      throw new Error('Saved source identity changed after restart');
    await evaluate(
      `[...document.querySelectorAll('button')].find(el=>el.textContent==='继续保存未完成项').click()`,
    );
    await waitFor(
      "document.querySelector('[aria-label=材料批次]').textContent.includes('重新选择原文件')",
    );
  }
  await capture(read ? 'batch-recovery' : 'batch-partial');
  writeFileSync(
    join(directory, read ? 'batch-read.json' : 'batch-write.json'),
    JSON.stringify(
      {
        phase,
        ids,
        batch: result.batch,
        rawFilePersistence: 'PASS_REAL',
        nativePicker: 'NOT_RUN',
        providerCalls: 0,
      },
      null,
      2,
    ),
  );
  await window.webContents.debugger.detach();
}
