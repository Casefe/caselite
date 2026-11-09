import type { BrowserWindow } from 'electron';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { createMaterialApplication } from '@caselite/application';
import {
  emptyDateChecks,
  emptyTaskCalendar,
  type AgentRequest,
  type AgentResponse,
  type MaterialRequest,
  type MaterialResponse,
  type TaskRequest,
  type TaskResponse,
  type DateConfirmRequest,
  type DateConfirmation,
} from '@caselite/contracts';
import { importantDateMockDispatches } from './important-date-mock';

// 隐藏窗口只调用产品typed IPC；此探针不操作GUI，也不访问真实Key或Provider。
export async function runImportantDateDemo(
  create: () => Promise<BrowserWindow>,
  root: string,
  phase: string,
  materials: ReturnType<typeof createMaterialApplication>,
) {
  const window = await create();
  const invoke = <T>(
    method: 'task' | 'material' | 'agent',
    request: TaskRequest | MaterialRequest | AgentRequest,
  ) =>
    window.webContents.executeJavaScript(
      `window.caselite.${method}(${JSON.stringify(request)})`,
    ) as Promise<T>;
  const task = (r: TaskRequest) => invoke<TaskResponse>('task', r),
    material = (r: MaterialRequest) => invoke<MaterialResponse>('material', r),
    agent = (r: AgentRequest) => invoke<AgentResponse>('agent', r);
  const good = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => {
    if (!r.ok) throw Error('Typed IPC rejected synthetic action');
    return r as Extract<T, { ok: true }>;
  };
  const identity = () => ({
    protocol_version: 1 as const,
    request_id: randomUUID(),
    idempotency_key: randomUUID(),
  });
  const checks = Object.fromEntries(
    Object.keys(emptyDateChecks).map((k) => [k, true]),
  ) as typeof emptyDateChecks;
  type Record = {
    sample: string;
    kind: string;
    task: string;
    run: string;
    source: string;
    hash: string;
    confirmation: DateConfirmation | null;
  };
  let stage = 'initialization';
  try {
    if (phase === 'important-date-read') {
      const records = JSON.parse(
        readFileSync(join(root, 'important-date-records.json'), 'utf8'),
      ) as Record[];
      for (const rec of records) {
        stage = `reopen-${rec.sample}-${rec.kind}`;
        const view = good(
          await agent({
            protocol_version: 1,
            operation: 'read_dates',
            scope: rec.task,
            run_id: rec.run,
          }),
        );
        if (
          rec.confirmation &&
          !view.date_confirmations?.some(
            (c) => JSON.stringify(c) === JSON.stringify(rec.confirmation),
          )
        )
          throw Error('Confirmation changed after restart');
        const source =
          rec.confirmation?.binding.sources[0] ?? view.runs[0].date_binding!.sources[0];
        const read = good(
          await material({
            protocol_version: 1,
            operation: 'read_fixed',
            scope: rec.task,
            source_id: source.source_id,
            derivation_id: source.derivation_id,
            asset_version_id: source.asset_version_id,
            sha256: source.sha256,
          }),
        );
        if (!read.data || createHash('sha256').update(read.data).digest('hex') !== rec.hash)
          throw Error('Fixed original changed');
      }
      if (importantDateMockDispatches() !== 0) throw Error('Restart dispatched a Provider');
      writeFileSync(
        join(root, 'important-date-read.json'),
        JSON.stringify({
          status: 'PASS_REAL',
          records: records.length,
          providerCalls: 0,
          originals: 'PASS_REAL',
          confirmations: 'PASS_REAL',
          legalAcceptance: 'NOT_RUN',
        }),
      );
      return;
    }
    const samples = JSON.parse(readFileSync(join(root, 'fixtures/samples.json'), 'utf8')) as {
      id: string;
      title: string;
      type_id: string;
      pdf: string;
      docx: string;
      expected: { mode: string; date?: string };
    }[];
    const manifest = JSON.parse(readFileSync(join(root, 'fixtures/manifest.json'), 'utf8')) as {
      path: string;
      sha256: string;
    }[];
    if (samples.length !== 10 || manifest.length !== 20) throw Error('Unexpected fixture manifest');
    const records: Record[] = [];
    for (const sample of samples)
      for (const kind of ['pdf', 'docx'] as const) {
        stage = `prepare-${sample.id}-${kind}`;
        const name = sample[kind];
        if (!/^\d{2}-.+-合成\.(pdf|docx)$/.test(name) || name.includes('/'))
          throw Error('Invalid synthetic fixture');
        const path = join(root, 'fixtures', name),
          hash = createHash('sha256').update(readFileSync(path)).digest('hex');
        if (manifest.find((f) => f.path === name)?.sha256 !== hash) throw Error('Fixture changed');
        let t = good(
          await task({
            ...identity(),
            operation: 'create',
            title: `日期测试${sample.id}-${kind} ${sample.title}`,
            objective: '合成通知条件测试，非律师法律接收',
          }),
        ).tasks[0];
        const schedule = {
          date: '2026-11-10',
          start: '09:30',
          end: '11:00',
          timezone: 'Asia/Shanghai',
        };
        t = good(
          await task({
            ...identity(),
            operation: 'update_calendar',
            task_id: t.id,
            expected_version: t.version,
            calendar: {
              ...emptyTaskCalendar,
              important: true,
              type_id: sample.type_id,
              attention_source: 'schedule',
              schedule,
            },
          }),
        ).tasks[0];
        const staged = good(await materials.stage(path, t.id)).staged!;
        good(
          await material({
            protocol_version: 1,
            operation: 'commit',
            scope: t.id,
            token: staged.token,
          }),
        );
        let source = good(await material({ protocol_version: 1, operation: 'list', scope: t.id }))
          .materials[0];
        if (!source?.page_count) throw Error('Missing native page/paragraph count');
        const instruction = '识别合成通知中的重要日期事实';
        const preview = good(
          await material({
            protocol_version: 1,
            operation: 'preview',
            scope: t.id,
            instruction,
            model: 'gpt-4.1-mini',
            selected: [
              {
                source_id: source.id,
                pages: Array.from({ length: source.page_count }, (_, i) => i + 1),
              },
            ],
            automatic: true,
            text_only: true,
          }),
        ).preview!;
        source = good(await material({ protocol_version: 1, operation: 'list', scope: t.id }))
          .materials[0];
        stage = `stream-${sample.id}-${kind}`;
        const run = randomUUID();
        good(
          await agent({
            protocol_version: 1,
            operation: 'start',
            scope: t.id,
            run_id: run,
            context_id: preview.id,
            model: 'gpt-4.1-mini',
            prompt: instruction,
            confirmed: true,
            purpose: 'important_dates',
            date_types: [sample.type_id],
            task_version: t.version,
          }),
        );
        let view = good(
          await agent({ protocol_version: 1, operation: 'read_dates', scope: t.id, run_id: run }),
        );
        for (let n = 0; view.runs[0]?.status === 'running' && n < 300; n++) {
          await new Promise((r) => setTimeout(r, 100));
          view = good(
            await agent({ protocol_version: 1, operation: 'read_dates', scope: t.id, run_id: run }),
          );
        }
        if (view.runs[0]?.status !== 'succeeded' || view.date_error)
          throw Error('Structured facts failed native verification');
        const reviewed = good(
          await agent({
            protocol_version: 1,
            operation: 'preview_date',
            scope: t.id,
            run_id: run,
            candidate_index: 0,
            expected_version: t.version,
            checks: sample.id === '07' ? { ...checks, conflict_resolved: false } : checks,
            timezone: 'Asia/Shanghai',
          }),
        );
        const candidate = reviewed.date_candidates?.[0];
        if (!candidate) throw Error('Missing date candidate');
        let confirmation: DateConfirmation | null = null;
        if (
          sample.expected.mode === 'explicit' ||
          sample.expected.mode === 'calculated_candidate'
        ) {
          if (candidate.status !== 'ready' || candidate.date !== sample.expected.date)
            throw Error('Date differed from conditional engineering expectation');
          stage = `confirm-${sample.id}-${kind}`;
          const request: DateConfirmRequest = {
            protocol_version: 1,
            operation: 'confirm_date',
            scope: t.id,
            run_id: run,
            candidate_index: 0,
            expected_version: t.version,
            checks,
            timezone: 'Asia/Shanghai',
            confirmed: true,
            idempotency_key: randomUUID(),
          };
          const saved = good(await agent(request)).date_saved!;
          const again = good(await agent(request)).date_saved!;
          if (
            JSON.stringify(saved) !== JSON.stringify(again) ||
            JSON.stringify(saved.task.calendar?.schedule) !== JSON.stringify(schedule) ||
            saved.task.calendar?.attention_date !== sample.expected.date
          )
            throw Error('Confirmation or preserved schedule mismatch');
          confirmation = saved.confirmation;
        } else if (candidate.status === 'ready')
          throw Error('Incomplete/conflicting source was confirmable');
        records.push({
          sample: sample.id,
          kind,
          task: t.id,
          run,
          source: source.id,
          hash,
          confirmation,
        });
        writeFileSync(join(root, 'important-date-records.json'), JSON.stringify(records, null, 2));
      }
    if (importantDateMockDispatches() !== 20) throw Error('Unexpected mock dispatch count');
    writeFileSync(
      join(root, 'important-date-write.json'),
      JSON.stringify({
        status: 'PASS_REAL',
        records: records.length,
        model: 'MOCK_ONLY',
        mockDispatches: 20,
        realProviderCalls: 0,
        originals: 'PASS_REAL',
        nativePdfDocxExtraction: 'PASS_REAL',
        sqlite: 'PASS_REAL',
        legalAcceptance: 'NOT_RUN',
      }),
    );
  } catch (e) {
    writeFileSync(
      join(root, 'important-date-failure.json'),
      JSON.stringify({ stage, error: e instanceof Error ? e.message : 'failed' }),
    );
    throw Error(`Important date probe failed at ${stage}`, { cause: e });
  } finally {
    window.destroy();
  }
}
