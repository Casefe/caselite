import type { BrowserWindow } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { createMaterialBatchApplication } from '@caselite/application';
import type { MaterialBatchResponse } from '@caselite/contracts';
import { scanMaterialBatch } from './adapters/material-batch-files';

export async function runMaterialBatchDemo(
  create: () => Promise<BrowserWindow>,
  directory: string,
  phase: string,
  batches: ReturnType<typeof createMaterialBatchApplication>,
) {
  const read = phase === 'materials-batch-read';
  if (!read) {
    // 保留一份旧批次，验证撤下界面后不会显示清单或错误，也不删除已有数据。
    const preview = await batches.create(
      'home',
      '合成旧批次',
      await scanMaterialBatch([join(directory, 'batch-input')], true),
    );
    if (!preview.ok || !preview.batch) throw new Error('Legacy batch fixture failed');
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
  for (let i = 0; i < 150; i++) {
    if (await evaluate("Boolean(document.querySelector('.material-menu-trigger'))")) break;
    await new Promise((done) => setTimeout(done, 200));
  }
  const trigger = await evaluate("Boolean(document.querySelector('.material-menu-trigger'))");
  if (!trigger) throw new Error('Upload composer unavailable');
  await evaluate("document.querySelector('.material-menu-trigger').click()");
  const ui = await evaluate(`({
    actions: [...document.querySelectorAll('[role=menuitem]')].map(el=>el.textContent.trim()),
    batchPanel: Boolean(document.querySelector('[aria-label=材料批次]')),
    batchError: document.body.textContent.includes('批次请求无效')
  })`);
  if (
    ui.batchPanel ||
    ui.batchError ||
    ui.actions.some((text: string) => text.includes('批量保存文件') || text.includes('保存文件夹'))
  )
    throw new Error('Retired batch UI is still mounted');
  if (!ui.actions.some((text: string) => text.includes('PDF / DOCX')))
    throw new Error('Normal file upload missing');
  await evaluate('new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))');
  const shot = await window.webContents.debugger.sendCommand('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
  });
  writeFileSync(
    join(directory, read ? 'upload-menu-reopened.png' : 'upload-menu-clean.png'),
    Buffer.from(shot.data, 'base64'),
  );
  const result = (await evaluate(
    "window.caselite.materialBatch({protocol_version:1,operation:'list',scope:'home'})",
  )) as MaterialBatchResponse;
  if (!result.ok || !result.batch) throw new Error('Existing batch data was removed');
  if (read) {
    const before = JSON.parse(readFileSync(join(directory, 'batch-ui-removed-write.json'), 'utf8'));
    if (JSON.stringify(before.batch) !== JSON.stringify(result.batch))
      throw new Error('Legacy batch changed during UI removal');
  }
  writeFileSync(
    join(directory, read ? 'batch-ui-removed-read.json' : 'batch-ui-removed-write.json'),
    JSON.stringify(
      {
        phase,
        ui,
        batch: result.batch,
        nativeUI: 'PASS_REAL',
        nativePicker: 'NOT_RUN',
        providerCalls: 0,
      },
      null,
      2,
    ),
  );
  window.webContents.debugger.detach();
}
