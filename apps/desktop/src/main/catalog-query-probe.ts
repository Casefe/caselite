import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { app, session, type BrowserWindow } from 'electron';
import type { createCatalogApplication, createTaskApplication } from '@caselite/application';

type Catalog = ReturnType<typeof createCatalogApplication>;
type Counts = { list: number; write: number; status: number; failedReads: number };
const mutation = () => {
  const id = randomUUID();
  return { protocol_version: 1, request_id: id, idempotency_key: id } as const;
};

export function createCatalogQueryProbe(catalog: Catalog) {
  const counts: Counts = { list: 0, write: 0, status: 0, failedReads: 0 };
  let failNextRead = false;
  let injectFailure = true;
  return {
    counts,
    application: {
      execute(input: unknown): ReturnType<Catalog['execute']> {
        // 隔离演练只统计受控入口，不记录目录内容或提交身份。
        const request = input as { operation?: unknown; project_properties?: unknown } | null;
        if (request?.operation === 'list' && !request.project_properties) {
          counts.list++;
          if (failNextRead) {
            failNextRead = false;
            counts.failedReads++;
            return { ok: false, code: 'UNAVAILABLE', message: '合成目录读取失败' };
          }
        }
        if (request?.operation === 'status') counts.status++;
        const result = catalog.execute(input);
        if (request?.operation === 'organize_document') {
          counts.write++;
          if (result.ok && injectFailure) {
            injectFailure = false;
            failNextRead = true;
          }
        }
        return result;
      },
    },
  };
}

export async function runCatalogQueryProbe(
  create: () => Promise<BrowserWindow>,
  root: string,
  tasks: ReturnType<typeof createTaskApplication>,
  catalog: Catalog,
  counts: Counts,
) {
  if (
    [app.getPath('userData'), session.defaultSession.storagePath].some(
      (p) => !p?.startsWith(root + sep),
    )
  )
    throw new Error('Catalog query probe requires an isolated workspace');
  session.defaultSession.webRequest.onBeforeRequest((request, done) =>
    done({ cancel: /^https?:/i.test(request.url) }),
  );
  const title = '合成目录验收项目';
  const taskTitle = '合成目录验收文档';
  const project = catalog.execute({ ...mutation(), operation: 'create_project', title });
  const task = tasks.execute({
    ...mutation(),
    operation: 'create',
    title: taskTitle,
    objective: '',
  });
  if (!project.ok || !task.ok) throw new Error('Catalog query seed failed');
  const id = task.tasks[0].document_id;
  const window = await create();
  const wc = window.webContents;
  wc.setBackgroundThrottling(false);
  const evaluate = (code: string) => wc.executeJavaScript(code);
  const wait = async (condition: string) => {
    for (let i = 0; i < 100; i++) {
      if (await evaluate(`Boolean(${condition})`)) return;
      await new Promise((done) => setTimeout(done, 50));
    }
    throw new Error('Catalog query probe timed out: ' + condition);
  };
  const nav = (page: string) => evaluate(`document.querySelector('[data-nav=${page}]').click()`);
  const button = (label: string) =>
    `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)} && !b.disabled)`;
  const click = async (label: string) => {
    await wait(button(label));
    await evaluate(`${button(label)}.click()`);
  };
  const row = (page: string) =>
    `document.querySelector('[data-collection=${page}] [data-document-id="${id}"]')`;
  const finance = `[...document.querySelectorAll('.finance-view select option')].some(e=>e.textContent===${JSON.stringify(title)})`;
  await wait("document.querySelector('[data-nav=documents]')");
  await nav('documents');
  await wait(row('documents'));
  const start = { ...counts };
  for (const page of ['knowledge', 'finance', 'documents', 'knowledge', 'finance', 'documents']) {
    await nav(page);
    await wait(
      page === 'finance'
        ? finance
        : page === 'documents'
          ? row(page)
          : "document.querySelector('[data-collection=knowledge] .catalog-empty')?.textContent.includes('暂无选定文档')",
    );
  }
  const afterVisits = { ...counts };
  await click('加入知识库');
  await wait(
    "document.querySelector('.catalog-view [role=alert]')?.textContent.includes('合成目录读取失败')",
  );
  const failed = { ...counts };
  if (failed.write - afterVisits.write !== 1 || failed.failedReads !== 1)
    throw new Error('Expected one committed write and one failed read');
  await click('刷新');
  await wait(button('移出知识库'));
  const recovered = { ...counts };
  if (
    recovered.write !== failed.write ||
    recovered.status !== failed.status ||
    recovered.list - failed.list !== 1
  )
    throw new Error('Refresh must only repeat the directory read');
  await nav('knowledge');
  await wait(row('knowledge'));
  await click('收藏文档');
  await wait(button('取消收藏'));
  await nav('finance');
  await wait(finance);
  await nav('documents');
  await wait(`${row('documents')}?.textContent.includes('★') && ${button('移出知识库')}`);
  if (counts.write - afterVisits.write !== 2) throw new Error('Unexpected repeated document write');
  writeFileSync(
    join(root, 'catalog-query-result.json'),
    JSON.stringify(
      {
        start,
        afterVisits,
        failed,
        recovered,
        final: counts,
        title: taskTitle,
        projectTitle: title,
      },
      null,
      2,
    ),
  );
}
