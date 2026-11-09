import { afterEach, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, mkdtempSync, rmSync, cpSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import {
  createAgentApplication,
  createImportantDateApplication,
  createMaterialApplication,
  createTaskApplication,
  type AgentRuntimePort,
} from '../../packages/application/src';
import { normalizedFactMatches } from '../../packages/application/src/important-date-rules';
import { openTaskStore } from '../../packages/local-db/src';
import { createMaterialFiles } from '../../apps/desktop/src/main/adapters/material-files';
import { mockImportantDateFacts } from '../../apps/desktop/src/main/important-date-mock';
import {
  defaultCalendarTypes,
  emptyDateChecks,
  emptyTaskCalendar,
  type AgentResponse,
  type TaskResponse,
  type DateConfirmRequest,
  type DateFactCandidate,
  type TextPage,
  type MaterialResponse,
} from '../../packages/contracts/src';
const fixture = resolve('tests/fixtures/important-dates'),
  migrations = resolve('packages/local-db/migrations');
const samples = JSON.parse(readFileSync(join(fixture, 'samples.json'), 'utf8')) as {
  id: string;
  title: string;
  type_id: string;
  paragraphs: string[];
  pdf: string;
  docx: string;
  expected: { date?: string; mode: string };
}[];
const roots: string[] = [],
  close: Array<() => void> = [];
afterEach(() => {
  close.splice(0).forEach((f) => f());
  roots.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true }));
});
const ok = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => {
  expect(r.ok).toBe(true);
  if (!r.ok) throw Error(JSON.stringify(r));
  return r as Extract<T, { ok: true }>;
};
const keys = () => ({
  protocol_version: 1 as const,
  request_id: randomUUID(),
  idempotency_key: randomUUID(),
});
const allChecks = Object.fromEntries(
  Object.keys(emptyDateChecks).map((k) => [k, true]),
) as typeof emptyDateChecks;
async function setup(sample = samples[0], kind: 'pdf' | 'docx' = 'pdf') {
  const root = mkdtempSync(join(tmpdir(), 'caselite-important-date-'));
  roots.push(root);
  const file = join(root, 'db.sqlite'),
    store = openTaskStore(file, migrations);
  close.push(store.close);
  const taskApp = createTaskApplication(store);
  if (sample.type_id.startsWith('custom-'))
    ok<TaskResponse>(
      taskApp.execute({
        ...keys(),
        operation: 'set_calendar_type',
        type: {
          id: sample.type_id,
          name: '合成自定义类型',
          version: 0,
          enabled: true,
          show_home: true,
        },
      }),
    );
  let task = ok<TaskResponse>(
    taskApp.execute({ ...keys(), operation: 'create', title: '合成日期任务', objective: '' }),
  ).tasks[0];
  task = ok<TaskResponse>(
    taskApp.execute({
      ...keys(),
      operation: 'update_attributes',
      task_id: task.id,
      expected_version: task.version,
      priority: 0,
      due_date: '2026-12-01',
    }),
  ).tasks[0];
  task = ok<TaskResponse>(
    taskApp.execute({
      ...keys(),
      operation: 'update_calendar',
      task_id: task.id,
      expected_version: task.version,
      calendar: {
        ...emptyTaskCalendar,
        important: true,
        type_id: sample.type_id,
        attention_source: 'schedule',
        schedule: { date: '2026-11-10', start: '09:30', end: '11:00', timezone: 'Asia/Shanghai' },
      },
    }),
  ).tasks[0];
  // Node测试注入已知解析页；原件暂存/hash/SQLite是真实，解析与Provider标MOCK_ONLY。打包探针另验真实PDF.js/Mammoth。
  const pages: TextPage[] = (
    kind === 'pdf' ? [sample.paragraphs.join('\n')] : sample.paragraphs
  ).map((text, i) => ({
    page: i + 1,
    text,
    origin: kind === 'pdf' ? 'pdf_text' : 'docx_text',
    blocks: [],
    width: 595,
    height: 842,
    rotation: 0,
  }));
  const processor = {
    configuration: 'synthetic-extraction-v1',
    inspect: async () => pages.length,
    process: async (_b: Uint8Array, input: { onPage(p: TextPage): void }) => {
      pages.forEach((p) => input.onPage(p));
    },
  };
  const material = createMaterialApplication({
    store: store.materials,
    files: createMaterialFiles(join(root, 'materials')),
    processor,
    docxProcessor: processor,
    id: randomUUID,
    hash: (t) => createHash('sha256').update(t).digest('hex'),
    taskExists: (id) => !!store.dates.task(id),
    createTask() {
      throw Error('No implicit Task in date test');
    },
  });
  const staged = ok<MaterialResponse>(
    await material.stage(join(fixture, sample[kind]), task.id),
  ).staged!;
  ok<MaterialResponse>(
    await material.execute({
      protocol_version: 1,
      operation: 'commit',
      scope: task.id,
      token: staged.token,
    }),
  );
  const instruction = '识别测试通知';
  const preview = ok<MaterialResponse>(
    await material.execute({
      protocol_version: 1,
      operation: 'preview',
      scope: task.id,
      model: 'gpt-4.1-mini',
      instruction,
      selected: [{ source_id: staged.token, pages: pages.map((p) => p.page) }],
      automatic: true,
      text_only: true,
    }),
  ).preview!;
  const dates = createImportantDateApplication(
    {
      ...store.dates,
      preview: (id, scope) => store.materials.preview(id, scope),
      source: store.materials.fixed,
      configuration: store.materials.configuration,
    },
    async (b) => {
      for (const s of b.sources)
        ok<MaterialResponse>(
          await material.execute({
            protocol_version: 1,
            operation: 'read_fixed',
            scope: b.task_id,
            source_id: s.source_id,
            derivation_id: s.derivation_id,
            asset_version_id: s.asset_version_id,
            sha256: s.sha256,
          }),
        );
    },
  );
  const facts = mockImportantDateFacts(staged.token, pages, sample[kind]);
  let handle: Parameters<AgentRuntimePort['start']>[0] | undefined;
  const runtime = {
    start: vi.fn((input: Parameters<AgentRuntimePort['start']>[0]) => {
      handle = input;
      return { cancel: vi.fn() };
    }),
  };
  const app = createAgentApplication({
    dates,
    history: store.agentHistory,
    runtime,
    credentials: {
      get: () => 'synthetic-only',
      set() {},
      clear() {},
      getDefaultModel: () => 'gpt-4.1-mini',
      setDefaultModel() {},
    },
    taskExists: (id) => !!store.dates.task(id),
    resolveContext: material.resolveContext,
  });
  const start = {
    protocol_version: 1 as const,
    operation: 'start' as const,
    scope: task.id,
    run_id: randomUUID(),
    context_id: preview.id,
    prompt: instruction,
    confirmed: true as const,
    purpose: 'important_dates' as const,
    date_types: [sample.type_id],
    task_version: task.version,
    model: 'gpt-4.1-mini' as const,
  };
  const send = async (output?: string) => {
    ok<AgentResponse>(await app.execute(start, 'window'));
    handle!.onText(output ?? JSON.stringify({ candidates: facts }));
    handle!.onEnd({ status: 'succeeded', usage: null, message: 'MOCK_ONLY' });
    return dates.review(task.id, start.run_id, allChecks);
  };
  const command = (index = 0): DateConfirmRequest => ({
    protocol_version: 1,
    operation: 'confirm_date',
    scope: task.id,
    run_id: start.run_id,
    candidate_index: index,
    expected_version: task.version,
    checks: allChecks,
    timezone: 'Asia/Shanghai',
    confirmed: true,
    idempotency_key: randomUUID(),
  });
  return {
    root,
    file,
    store,
    task,
    material,
    dates,
    app,
    start,
    send,
    command,
    runtime,
    pages,
    source: staged.token,
    preview,
    mutate(fn: (v: DateFactCandidate[]) => void) {
      fn(facts);
    },
    callbacks: () => handle!,
  };
}

it.each(samples.flatMap((s) => (['pdf', 'docx'] as const).map((kind) => ({ sample: s, kind }))))(
  'verifies fixed $kind sample $sample.id, persists only reviewed candidates and preserves schedule/due date',
  async ({ sample, kind }) => {
    const s = await setup(sample, kind);
    for (const c of mockImportantDateFacts(s.source, s.pages, sample[kind]))
      for (const key of ['date', 'time', 'trigger', 'period'] as const)
        if (c[key])
          expect(
            normalizedFactMatches(key, c[key]!),
            `${sample.id} ${kind} ${key}: ${c[key]!.quote}`,
          ).toBe(true);
    const view = await s.send();
    expect(view.error).toBeNull();
    expect(view.candidates.length).toBeGreaterThan(0);
    if (sample.expected.mode === 'needs_information')
      expect(view.candidates[0].status).toBeOneOf(['needs_information', 'unsupported']);
    else if (sample.expected.mode === 'conflict') {
      expect(s.dates.review(s.task.id, s.start.run_id).candidates[0].status).toBe('conflict');
      expect(s.store.dates.task(s.task.id)?.version).toBe(s.task.version);
    } else {
      expect(view.candidates[0]).toMatchObject({ status: 'ready', date: sample.expected.date });
      const request = s.command(),
        saved = ok<AgentResponse>(await s.app.execute(request, 'window')).date_saved!;
      expect(saved.task.calendar).toMatchObject({
        important: true,
        type_id: sample.type_id,
        attention_source: 'custom',
        attention_date: sample.expected.date,
        schedule: s.task.calendar!.schedule,
      });
      expect(saved.task.due_date).toBe('2026-12-01');
      if (sample.id === '09')
        expect(saved.task.calendar).toMatchObject({
          attention_time: '16:00',
          attention_timezone: 'Asia/Shanghai',
          schedule: { start: '09:30', end: '11:00' },
        });
      expect(ok<AgentResponse>(await s.app.execute(request, 'window')).date_saved).toEqual(saved);
      expect(s.store.dates.confirmations(s.task.id)).toHaveLength(1);
      expect(
        await s.app.execute(
          { ...request, checks: { ...request.checks, no_changes: false } },
          'window',
        ),
      ).toMatchObject({ ok: false, code: 'CONFLICT' });
    }
  },
);

it('verifies all 20 immutable fixture bytes and records that legal expected values remain conditional', () => {
  const manifest = JSON.parse(readFileSync(join(fixture, 'manifest.json'), 'utf8')) as {
    path: string;
    sha256: string;
    bytes: number;
  }[];
  expect(manifest).toHaveLength(20);
  for (const f of manifest) {
    const bytes = readFileSync(join(fixture, f.path));
    expect(bytes.length).toBe(f.bytes);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(f.sha256);
  }
  expect(samples.find((s) => s.id === '03')?.expected).toHaveProperty(
    'requires_human_confirmation',
  );
});

it.each(['date', 'period', 'quote', 'scope', 'capacity', 'json'] as const)(
  'blocks forged $0 before any Task write',
  async (mode) => {
    const s = await setup(mode === 'period' ? samples[2] : samples[1]);
    let output: string | undefined;
    s.mutate((f) => {
      if (mode === 'date') f[0].date!.value = '2026-11-10';
      if (mode === 'period') f[0].period!.value = '30';
      if (mode === 'quote') f[0].date!.quote = '原文不存在';
      if (mode === 'scope') f[0].date!.source_id = randomUUID();
      if (mode === 'capacity') f.push(...Array.from({ length: 25 }, () => f[0]));
    });
    if (mode === 'json') output = 'not json';
    const result = await s.send(output);
    expect(result.candidates).toEqual([]);
    expect(result.error).toBeTruthy();
    expect(await s.app.execute(s.command(), 'window')).toMatchObject({ ok: false });
    expect(s.store.dates.task(s.task.id)?.version).toBe(s.task.version);
  },
);

it('rejects wrong Task/window, stale Task/type, unreviewed evidence and changed source hash', async () => {
  const s = await setup(samples[2]);
  await s.send();
  expect(
    await s.app.execute(
      { ...s.command(), checks: { ...allChecks, evidence_55_56: false } },
      'window',
    ),
  ).toMatchObject({ ok: false, code: 'INVALID_REQUEST' });
  expect(await s.app.execute(s.command(), 'other-window')).toMatchObject({
    ok: false,
    code: 'NOT_FOUND',
  });
  expect(await s.app.execute({ ...s.command(), scope: randomUUID() }, 'window')).toMatchObject({
    ok: false,
    code: 'NOT_FOUND',
  });
  const type = s.store.dates.types().find((t) => t.id === 'evidence')!;
  ok<TaskResponse>(
    s.store.execute({
      ...keys(),
      operation: 'set_calendar_type',
      type: { ...type, name: '合成新名称' },
    }),
  );
  expect(await s.app.execute(s.command(), 'window')).toMatchObject({ ok: false, code: 'CONFLICT' });
  const db = new Database(s.file);
  db.prepare('UPDATE material_sources SET sha256=? WHERE id=?').run('0'.repeat(64), s.source);
  expect(await s.app.execute(s.command(), 'window')).toMatchObject({ ok: false });
  db.close();
  expect(s.store.dates.task(s.task.id)?.version).toBe(s.task.version);
});

it('stops a streaming run, ignores late completion and never confirms partial output', async () => {
  const s = await setup();
  ok<AgentResponse>(await s.app.execute(s.start, 'window'));
  const callback = s.callbacks();
  callback.onText('{"candidates":[');
  ok<AgentResponse>(
    await s.app.execute(
      { protocol_version: 1, operation: 'cancel', scope: s.task.id, run_id: s.start.run_id },
      'window',
    ),
  );
  callback.onText(JSON.stringify({ candidates: [] }));
  callback.onEnd({ status: 'succeeded', usage: null, message: '' });
  expect(s.store.dates.run(s.start.run_id, s.task.id)?.status).toBe('cancelled');
  expect(await s.app.execute(s.command(), 'window')).toMatchObject({ ok: false });
  expect(s.runtime.start).toHaveBeenCalledTimes(1);
});

it('rolls back Task/activity/receipt when confirmation insertion fails, then recovers original key and reopens fixed evidence', async () => {
  const s = await setup();
  await s.send();
  const request = s.command(),
    db = new Database(s.file);
  db.exec(
    "CREATE TRIGGER injected_date_failure BEFORE INSERT ON task_date_confirmations BEGIN SELECT RAISE(ABORT,'injected'); END;",
  );
  expect(await s.app.execute(request, 'window')).toMatchObject({ ok: false });
  expect(s.store.dates.task(s.task.id)?.version).toBe(s.task.version);
  expect(
    s.store.execute({
      protocol_version: 1,
      operation: 'status',
      idempotency_key: request.idempotency_key,
    }),
  ).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  db.exec('DROP TRIGGER injected_date_failure');
  db.close();
  const saved = ok<AgentResponse>(await s.app.execute(request, 'window')).date_saved!;
  const newDerivation = randomUUID();
  s.store.materials.begin(s.source, newDerivation, 'synthetic-extraction-v2', []);
  s.store.materials.checkpoint(s.source, newDerivation, 'ready', [
    { ...s.pages[0], text: '新OCR不能替代旧确认' },
  ]);
  expect(
    s.store.materials.fixed(s.source, saved.confirmation.binding.sources[0].derivation_id)?.pages[0]
      .text,
  ).toBe(s.pages[0].text);
  const reopened = openTaskStore(s.file, migrations);
  try {
    expect(reopened.dates.receipt(s.task.id, request.idempotency_key)).toEqual(saved);
    expect(reopened.dates.confirmations(s.task.id)[0].candidate.computation).toEqual(
      saved.confirmation.candidate.computation,
    );
    expect(reopened.dates.task(s.task.id)?.calendar?.attention_date).toBe('2026-11-10');
  } finally {
    reopened.close();
  }
});

it('upgrades a true complete 24-migration library without modifying the old SQL/hash or existing values', () => {
  const root = mkdtempSync(join(tmpdir(), 'caselite-date-old24-'));
  roots.push(root);
  const folder = join(root, 'old24');
  cpSync(migrations, folder, { recursive: true });
  const journal = JSON.parse(readFileSync(join(folder, 'meta/_journal.json'), 'utf8'));
  journal.entries = journal.entries.slice(0, 24);
  writeFileSync(join(folder, 'meta/_journal.json'), JSON.stringify(journal));
  unlinkSync(join(folder, 'meta/dual-history-1826.json'));
  // 原完整24项有双支tag，不能去掉marker冒充单支目录；直接按原24份DDL构建真实旧库。
  const file = join(root, 'old.sqlite'),
    db = new Database(file);
  db.exec(
    'CREATE TABLE __drizzle_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT,hash TEXT NOT NULL,created_at NUMERIC)',
  );
  for (const entry of journal.entries) {
    const sql = readFileSync(join(folder, entry.tag + '.sql'), 'utf8');
    db.exec(sql);
    db.prepare('INSERT INTO __drizzle_migrations(hash,created_at) VALUES(?,?)').run(
      createHash('sha256').update(sql).digest('hex'),
      entry.when,
    );
  }
  db.prepare('INSERT INTO toolchain_probe VALUES(?,?)').run('preserve', '旧24项值🙂');
  const before = db.prepare('SELECT * FROM __drizzle_migrations').all();
  db.close();
  const store = openTaskStore(file, migrations);
  store.close();
  const check = new Database(file);
  expect(check.prepare('SELECT * FROM __drizzle_migrations ORDER BY id LIMIT 24').all()).toEqual(
    before,
  );
  expect(check.prepare('SELECT count(*) n FROM __drizzle_migrations').get()).toEqual({ n: 25 });
  expect(check.prepare('SELECT value FROM toolchain_probe').get()).toEqual({ value: '旧24项值🙂' });
  expect(check.pragma('integrity_check', { simple: true })).toBe('ok');
  check.close();
});

it.each(['period', 'service', 'time'] as const)(
  'requires conflict resolution for distinct same-type %s facts, including null relative dates',
  async (mode) => {
    const sample =
      mode === 'time'
        ? {
            ...samples[6],
            paragraphs: samples[6].paragraphs.map((p) =>
              p.replace('2026年11月13日', '2026年11月12日'),
            ),
          }
        : {
            ...samples[2],
            paragraphs: [
              ...samples[2].paragraphs,
              '通知乙指定：自送达之日起三十日内提交证据。',
              '第二签收记录：2026年11月10日收到本举证通知。',
            ],
          };
    const s = await setup(sample);
    s.mutate((f) => {
      if (mode === 'time') {
        f[1].date!.value = '2026-11-12';
        return;
      }
      f[0].period!.quote = sample.paragraphs[2];
      f[0].trigger!.quote = sample.paragraphs[3];
      const second = structuredClone(f[0]);
      if (mode === 'period')
        second.period = {
          ...second.period!,
          value: '30',
          quote: '通知乙指定：自送达之日起三十日内提交证据。',
        };
      else
        second.trigger = {
          ...second.trigger!,
          value: '2026-11-10',
          quote: '第二签收记录：2026年11月10日收到本举证通知。',
        };
      f.push(second);
    });
    await s.send();
    const view = s.dates.review(s.task.id, s.start.run_id, {
      ...allChecks,
      conflict_resolved: false,
    });
    expect(view.candidates).toHaveLength(2);
    for (const c of view.candidates) {
      expect(c.status).toBe('conflict');
      expect(c.requires).toContain('conflict_resolved');
    }
    expect(
      await s.app.execute(
        { ...s.command(), checks: { ...allChecks, conflict_resolved: false } },
        'window',
      ),
    ).toMatchObject({ ok: false, code: 'INVALID_REQUEST' });
    expect(s.store.dates.task(s.task.id)?.version).toBe(s.task.version);
  },
);

it('stops while resolving a fixed input; unknown queries do not claim the preparing run is absent', async () => {
  const s = await setup();
  let release!: (text: string) => void;
  const wait = new Promise<string>((r) => {
    release = r;
  });
  const app = createAgentApplication({
    dates: s.dates,
    history: s.store.agentHistory,
    runtime: s.runtime,
    credentials: {
      get: () => 'synthetic-only',
      set() {},
      clear() {},
      getDefaultModel: () => 'gpt-4.1-mini',
      setDefaultModel() {},
    },
    taskExists: () => true,
    resolveContext: () => wait,
  });
  const pending = app.execute(s.start, 'window');
  expect(
    await app.execute(
      { protocol_version: 1, operation: 'read_dates', scope: s.task.id, run_id: s.start.run_id },
      'window',
    ),
  ).toMatchObject({ ok: false, code: 'RESULT_UNKNOWN' });
  ok<AgentResponse>(
    await app.execute(
      { protocol_version: 1, operation: 'cancel', scope: s.task.id, run_id: s.start.run_id },
      'window',
    ),
  );
  release('fixed context');
  expect(await pending).toMatchObject({ ok: false, code: 'CANCELLED' });
  expect(s.runtime.start).not.toHaveBeenCalled();
});

it('rejects a concurrent Task edit and competing confirmation key while the original receipt remains readable', async () => {
  const s = await setup();
  await s.send();
  const original = s.command();
  const saved = ok<AgentResponse>(await s.app.execute(original, 'window')).date_saved!;
  expect(await s.app.execute(s.command(), 'window')).toMatchObject({ ok: false, code: 'CONFLICT' });
  const updated = ok<TaskResponse>(
    s.store.execute({
      ...keys(),
      operation: 'change_status',
      task_id: s.task.id,
      expected_version: saved.task.version,
      status: 'in_progress',
    }),
  ).tasks[0];
  expect(ok<AgentResponse>(await s.app.execute(original, 'window')).date_saved).toEqual(saved);
  expect(s.store.dates.task(s.task.id)?.version).toBe(updated.version);
});

it('does not report a missing receipt while original file verification can still commit, and deduplicates the in-flight key', async () => {
  const s = await setup();
  await s.send();
  let release!: () => void;
  const wait = new Promise<void>((r) => {
    release = r;
  });
  const dates = createImportantDateApplication(
    {
      ...s.store.dates,
      preview: (id, scope) => s.store.materials.preview(id, scope),
      source: s.store.materials.fixed,
      configuration: s.store.materials.configuration,
    },
    () => wait,
  );
  const request = s.command(),
    pending = dates.confirm(request);
  expect(dates.status(s.task.id, request.idempotency_key)).toMatchObject({
    code: 'RESULT_UNKNOWN',
  });
  expect(await dates.confirm(request)).toMatchObject({ code: 'RESULT_UNKNOWN' });
  expect(await dates.confirm({ ...request, timezone: 'UTC' })).toMatchObject({ code: 'CONFLICT' });
  expect(s.store.dates.task(s.task.id)?.version).toBe(s.task.version);
  release();
  const saved = await pending;
  expect(saved).toHaveProperty('receipt', request.idempotency_key);
  expect(dates.status(s.task.id, request.idempotency_key)).toEqual(saved);
  expect(s.store.dates.confirmations(s.task.id)).toHaveLength(1);
});

it('rechecks Task after asynchronous original verification and rejects an old rule version without rewriting old confirmations', async () => {
  const s = await setup();
  await s.send();
  let release!: () => void;
  const wait = new Promise<void>((r) => {
    release = r;
  });
  const dates = createImportantDateApplication(
    {
      ...s.store.dates,
      preview: (id, scope) => s.store.materials.preview(id, scope),
      source: s.store.materials.fixed,
      configuration: s.store.materials.configuration,
    },
    () => wait,
  );
  const request = s.command(),
    pending = dates.confirm(request);
  ok<TaskResponse>(
    s.store.execute({
      ...keys(),
      operation: 'change_status',
      task_id: s.task.id,
      expected_version: s.task.version,
      status: 'in_progress',
    }),
  );
  release();
  expect(await pending).toMatchObject({ code: 'CONFLICT' });
  expect(dates.status(s.task.id, request.idempotency_key)).toBeUndefined();
  const old = s.store.dates.run(s.start.run_id, s.task.id)!;
  const older = {
    ...old,
    id: randomUUID(),
    date_binding: { ...old.date_binding!, rule_version: 'older-v0' },
  };
  s.store.agentHistory.register(older);
  const view = s.dates.review(s.task.id, older.id, allChecks);
  expect(view.candidates[0].status).toBe('needs_information');
  expect(view.candidates[0].messages.join('')).toContain('规则版本');
  expect(s.store.dates.confirmations(s.task.id)).toEqual([]);
});

it.each([...defaultCalendarTypes.map((t) => t.id), 'custom-synthetic'])(
  'extracts an explicit written date for selected type %s without granting it a relative formula',
  async (typeId) => {
    const sample = { ...samples[0], type_id: typeId };
    const s = await setup(sample);
    s.mutate((f) => {
      f[0].type_id = typeId;
    });
    const view = await s.send();
    expect(view.candidates[0]).toMatchObject({ status: 'ready', date: '2026-11-10' });
    const saved = ok<AgentResponse>(await s.app.execute(s.command(), 'window')).date_saved!;
    expect(saved.task.calendar?.type_id).toBe(typeId);
  },
);

it('does not accept a valid JSON fragment from a token-limited model completion', async () => {
  const s = await setup();
  ok<AgentResponse>(await s.app.execute(s.start, 'window'));
  const cb = s.callbacks();
  cb.onText(
    JSON.stringify({ candidates: mockImportantDateFacts(s.source, s.pages, samples[0].pdf) }),
  );
  cb.onEnd({ status: 'succeeded', usage: null, message: 'output limit', output_incomplete: true });
  expect(s.dates.review(s.task.id, s.start.run_id).error).toBeTruthy();
  expect(await s.app.execute(s.command(), 'window')).toMatchObject({ ok: false });
  expect(s.store.dates.task(s.task.id)?.version).toBe(s.task.version);
});

it('keeps date Runs in their owner history without crowding five ordinary conversation rounds', async () => {
  const s = await setup(samples[0], 'pdf');
  const normalIds: string[] = [];
  for (let i = 0; i < 5; i++) {
    const id = randomUUID();
    normalIds.push(id);
    ok<AgentResponse>(
      await s.app.execute(
        {
          protocol_version: 1,
          operation: 'start',
          scope: s.task.id,
          run_id: id,
          model: 'gpt-4.1-mini',
          prompt: `普通对话${i}`,
          confirmed: true,
        },
        'window',
      ),
    );
    s.callbacks().onText(`普通回答${i}`);
    s.callbacks().onEnd({ status: 'succeeded', usage: null, message: 'MOCK_ONLY' });
  }
  const dateIds: string[] = [];
  for (let i = 0; i < 6; i++) {
    const id = randomUUID();
    dateIds.push(id);
    ok<AgentResponse>(await s.app.execute({ ...s.start, run_id: id }, 'window'));
    s.callbacks().onText(
      JSON.stringify({ candidates: mockImportantDateFacts(s.source, s.pages, samples[0].pdf) }),
    );
    s.callbacks().onEnd({ status: 'succeeded', usage: null, message: 'MOCK_ONLY' });
  }
  const history = ok<AgentResponse>(
    await s.app.execute({ protocol_version: 1, operation: 'history' }, 'window'),
  );
  expect(history.runs).toHaveLength(5);
  expect(history.runs.map((r) => r.id).sort()).toEqual(normalIds.sort());
  const read = ok<AgentResponse>(
    await s.app.execute({ protocol_version: 1, operation: 'read', scope: s.task.id }, 'window'),
  );
  expect(read.runs).toHaveLength(11);
  expect(
    read.runs
      .filter((r) => r.purpose === 'important_dates')
      .map((r) => r.id)
      .sort(),
  ).toEqual(dateIds.sort());
  const dates = ok<AgentResponse>(
    await s.app.execute(
      { protocol_version: 1, operation: 'read_dates', scope: s.task.id, run_id: dateIds[0] },
      'window',
    ),
  );
  expect(dates.date_candidates).toHaveLength(1);
  expect(
    await s.app.execute(
      { protocol_version: 1, operation: 'pin_history', run_id: dateIds[0], pinned: true },
      'window',
    ),
  ).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  expect(s.store.agentHistory.load()).toHaveLength(11);
});
