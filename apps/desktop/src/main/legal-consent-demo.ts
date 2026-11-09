import type { BrowserWindow } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// 只由既有校验过的合成临时目录调用；自动点击不代表律师本人或机构签署。
export async function observeLegalConsentDemo(window: BrowserWindow, root: string, phase: string) {
  if (phase === 'legal-preview') return;
  if (phase === 'legal-read') throw new Error('Saved legal acceptance did not bypass the prompt');
  const evaluate = (source: string) => window.webContents.executeJavaScript(source);
  const waitFor = async (expression: string) => {
    for (let i = 0; i < 100; i++) {
      if (await evaluate(expression)) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('Legal UI demo timed out');
  };
  await waitFor(
    "typeof window.caseliteLegal?.execute === 'function' && !!document.querySelector('#legal-document')",
  );
  if (phase === 'legal-corrupt') {
    await waitFor("document.querySelector('#legal-error')?.hidden === false");
    if (!(await evaluate("document.querySelector('#legal-accept').disabled && !window.caselite")))
      throw new Error('Corrupt legal record did not fail closed');
    window.close();
    return;
  }
  await waitFor(
    "document.querySelector('#legal-document')?.textContent?.includes('专有软件许可证')",
  );
  if (
    !(await evaluate(
      "document.querySelector('#legal-accept').disabled && !document.querySelector('#legal-confirm').checked && !window.caselite",
    ))
  )
    throw new Error('Legal consent was not explicit');
  if (phase.startsWith('legal-'))
    writeFileSync(join(root, 'legal-before.png'), (await window.webContents.capturePage()).toPNG());
  if (phase === 'legal-reject') {
    await evaluate("document.querySelector('#legal-decline').click()");
    return;
  }
  if (phase === 'legal-close') {
    window.close();
    return;
  }
  for (const id of ['license', 'eula']) {
    await evaluate(
      `{ document.querySelector('#legal-tab-${id}').click(); const panel = document.querySelector('#legal-document'); panel.scrollTop = panel.scrollHeight; panel.dispatchEvent(new Event('scroll')); }`,
    );
    await waitFor("document.querySelector('#legal-mark-read').disabled === false");
    await evaluate("document.querySelector('#legal-mark-read').click()");
  }
  await evaluate("document.querySelector('#legal-confirm').click()");
  await waitFor("document.querySelector('#legal-accept').disabled === false");
  if (phase.startsWith('legal-'))
    writeFileSync(join(root, 'legal-ready.png'), (await window.webContents.capturePage()).toPNG());
  if (phase === 'legal-write-failure') mkdirSync(join(root, 'userData/legal-acceptance.json'));
  await evaluate("document.querySelector('#legal-accept').click()");
  if (phase === 'legal-write-failure') {
    await waitFor("document.querySelector('#legal-error')?.hidden === false");
    if (!(await evaluate('!window.caselite')))
      throw new Error('Business API exposed before consent');
    writeFileSync(
      join(root, 'legal-save-error.png'),
      (await window.webContents.capturePage()).toPNG(),
    );
    window.close();
  }
}
