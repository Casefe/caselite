import { app, session, type BrowserWindow } from 'electron';
import { writeFileSync, existsSync } from 'node:fs';
import { join, sep } from 'node:path';

const title = 'DEV-1793 合成收费项目';

export async function runFinanceDemo(
  createWindow: (show: boolean) => Promise<BrowserWindow>,
  root: string,
  phase: 'finance-write' | 'finance-reverse' | 'finance-read' | 'finance-preview',
) {
  const paths = [
    app.getPath('userData'),
    app.getPath('sessionData'),
    session.defaultSession.storagePath,
  ];
  if (paths.some((path) => !path?.startsWith(root + sep)))
    throw new Error('Finance demo requires isolated user data');
  session.defaultSession.webRequest.onBeforeRequest((details, callback) =>
    callback({ cancel: /^https?:/i.test(details.url) }),
  );
  const window = await createWindow(phase === 'finance-preview');
  window.webContents.setBackgroundThrottling(false);
  const evaluate = (source: string) => window.webContents.executeJavaScript(source);
  const literal = (value: string) => JSON.stringify(value);
  const wait = async (condition: string) => {
    for (let i = 0; i < 100; i++) {
      if (await evaluate(`Boolean(${condition})`)) return;
      await new Promise((done) => setTimeout(done, 100));
    }
    throw new Error('Finance demo timed out: ' + condition);
  };
  const click = async (expression: string) => {
    await wait(`(${expression}) && !(${expression}).disabled`);
    await evaluate(`(${expression}).click()`);
  };
  const button = (label: string) =>
    click(
      `Array.from(document.querySelectorAll('button')).find(e => e.textContent.trim() === ${literal(label)})`,
    );
  const query = (selector: string) => `document.querySelector(${literal(selector)})`;
  const fill = (selector: string, value: string) =>
    evaluate(`(() => {
    const field = ${query(selector)};
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, ${literal(value)});
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  const screenshot = async (file: string) => {
    const debug = window.webContents.debugger;
    debug.attach('1.3');
    try {
      const { data } = await debug.sendCommand('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(root, file), Buffer.from(data, 'base64'));
    } finally {
      debug.detach();
    }
  };
  const showBalance = async (outstanding: string, due: string) => {
    await wait(`${query('[data-testid=finance-outstanding]')}?.textContent === ${literal(outstanding)}
      && ${query('[data-testid=finance-due]')}?.textContent === ${literal(due)}`);
  };
  const openFromProjects = async (expected: string) => {
    await click(query('[data-nav=projects]'));
    const balance = `Array.from(document.querySelectorAll('[data-project-id] button')).find(e =>
      e.getAttribute('aria-label')?.startsWith(${literal('查看 ' + title + ' 的待收款 ')}))`;
    await wait(`(${balance})?.textContent.trim() === ${literal(expected)}`);
    if (phase === 'finance-write' && expected === '70,000.00')
      await screenshot('project-list-70000.png');
    await click(balance);
  };

  const projectId = (await evaluate(`(async () => {
    const catalog = await window.caselite.catalog({ protocol_version: 1, operation: 'list' });
    if (!catalog.ok) throw new Error('Catalog read failed');
    const existing = catalog.projects.find(p => p.title === ${literal(title)});
    if (existing) return existing.id;
    if (!${phase === 'finance-write' || phase === 'finance-preview'}) throw new Error('Project missing after restart');
    const result = await window.caselite.catalog({
      protocol_version: 1, operation: 'create_project', title: ${literal(title)},
      request_id: crypto.randomUUID(), idempotency_key: crypto.randomUUID(),
    });
    if (!result.ok || !result.target_id) throw new Error('Synthetic project creation failed');
    return result.target_id;
  })()`)) as string;

  if (phase === 'finance-preview') {
    window.setTitle('CaseLite · DEV-1793 隔离合成验收');
    return;
  }
  if (phase === 'finance-write') {
    await openFromProjects('—');
    await button('添加分期');
    await fill('input[name=number]', 'SYNTH-100000');
    await fill('input[name=amount]', '100000');
    await fill('.finance-fields:nth-of-type(1) input[inputmode=decimal]', '60000');
    await fill('.finance-fields:nth-of-type(1) input[type=date]', '2020-01-01');
    await fill('.finance-fields:nth-of-type(2) input[inputmode=decimal]', '40000');
    await fill('.finance-fields:nth-of-type(2) input[type=date]', '2099-01-01');
    await button('确认登记合同');
    await showBalance('100,000.00', '60,000.00');
    await evaluate(`(() => {
      const select = ${query('select[name=installment]')};
      select.selectedIndex = 1;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await fill('input[name=amount]', '30000');
    await button('确认登记收款');
    await showBalance('70,000.00', '30,000.00');
    const totals = query('[aria-label="筛选结果总览"]');
    await wait(`${totals}?.textContent.includes('70,000.00')`);
    await fill('.finance-filters input[type=search]', '无匹配合成项目');
    await wait("document.body.textContent.includes('没有符合筛选条件的项目。')");
    await showBalance('70,000.00', '30,000.00');
    await button('清除筛选');
    await wait(`${totals}?.textContent.includes('70,000.00')`);
    await screenshot('finance-70000.png');
    await openFromProjects('70,000.00');
    await showBalance('70,000.00', '30,000.00');
  } else if (phase === 'finance-reverse') {
    await openFromProjects('70,000.00');
    await showBalance('70,000.00', '30,000.00');
    await button('冲回这笔收款');
    await button('确认冲回原收款');
    await showBalance('100,000.00', '60,000.00');
    await wait(`${query('.finance-payments')}?.textContent.includes('已冲回')`);
  } else {
    await openFromProjects('100,000.00');
    await showBalance('100,000.00', '60,000.00');
    await wait(`${query('.finance-payments')}?.textContent.includes('已冲回')`);
    await screenshot('finance-reopened-reversal.png');
  }
  if (existsSync(join(root, 'unexpected-runtime.txt')))
    throw new Error('Unexpected Provider dispatch');
  writeFileSync(
    join(root, phase + '.json'),
    JSON.stringify(
      {
        projectId,
        phase,
        isolated: true,
        providerDispatches: 0,
        outstanding: phase === 'finance-write' ? 70000 : 100000,
        due: phase === 'finance-write' ? 30000 : 60000,
      },
      null,
      2,
    ),
  );
}
