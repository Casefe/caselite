// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ImportantDates from './ImportantDates';
import type {
  AgentRequest,
  DateConfirmRequest,
  DateEvaluated,
  Task,
} from '../../../preload/caselite-api';
const taskId = '11111111-1111-4111-8111-111111111111',
  runId = '22222222-2222-4222-8222-222222222222',
  source = '33333333-3333-4333-8333-333333333333';
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it.each(['committed', 'rejected'] as const)(
  'recovers the original key for %s, and rereads only after a known ACK',
  async (mode) => {
    const task = {
      id: taskId,
      version: 1,
      title: '合成任务',
      due_date: '2026-12-01',
      calendar: {
        planned_date: null,
        schedule: { date: '2026-11-10', start: '09:30', end: '11:00', timezone: 'Asia/Shanghai' },
        important: true,
        type_id: 'hearing',
        attention_source: 'schedule',
        attention_date: null,
        attention_time: null,
      },
    } as Task;
    const binding = {
      version: 1 as const,
      rule_version: 'test-v1',
      task_id: taskId,
      task_version: 1,
      preview_id: source,
      type_ids: ['hearing'],
      type_versions: [{ id: 'hearing', version: 0 }],
      sources: [
        {
          source_id: source,
          derivation_id: source,
          asset_version_id: source,
          sha256: 'a'.repeat(64),
          configuration: 'test',
          pages: [1],
        },
      ],
    };
    const candidate: DateEvaluated = {
      index: 0,
      fact: {
        type_id: 'hearing',
        rule: 'explicit',
        date: { source_id: source, page: 1, quote: '2026年11月10日09:00开庭', value: '2026-11-10' },
        time: { source_id: source, page: 1, quote: '09:00开庭', value: '09:00' },
        trigger: null,
        period: null,
        time_semantics: 'event_start',
        context: [],
        missing: [],
      },
      status: 'needs_information',
      date: '2026-11-10',
      time: '09:00',
      requires: ['source_reviewed'],
      messages: [],
      computation: ['提取明确日期'],
      rule_version: 'test-v1',
      calendar_versions: [],
    };
    const run = {
      id: runId,
      scope: taskId,
      purpose: 'important_dates',
      date_binding: binding,
      status: 'succeeded',
      output: 'MOCK_ONLY',
      created_at: '2026-11-09T00:00:00Z',
    };
    let original: DateConfirmRequest | undefined,
      saved: unknown,
      reads = 0;
    const agent = vi.fn(async (r: AgentRequest) => {
      const base = {
        ok: true,
        configured: false,
        model: 'gpt-4.1-mini',
        providers: { openai: false, deepseek: false },
        runs: [run],
      };
      if (r.operation === 'date_rules')
        return {
          ...base,
          date_rules: {
            version: 'test-v1',
            checks: { source_reviewed: '核对原件' },
            types: [],
            laws: [],
            calendars: [],
          },
        };
      if (r.operation === 'read_dates')
        return { ...base, date_task: task, date_candidates: [candidate], date_confirmations: [] };
      if (r.operation === 'preview_date')
        return { ...base, date_task: task, date_candidates: [{ ...candidate, status: 'ready' }] };
      if (r.operation === 'confirm_date') {
        if (mode === 'rejected' && original) {
          expect(r.idempotency_key).toBe(original.idempotency_key);
          return { ok: false, code: 'CONFLICT', message: 'Task已变化，原请求已明确拒绝' };
        }
        original = r;
        saved = {
          task: {
            ...task,
            version: 2,
            calendar: {
              ...task.calendar,
              attention_source: 'custom',
              attention_date: '2026-11-10',
              attention_time: '09:00',
              attention_timezone: 'Asia/Shanghai',
            },
          },
          confirmation: {
            request: r,
            candidate: { ...candidate, status: 'ready' },
            binding,
            confirmed_at: '2026-11-09T00:00:00Z',
            task_version: 2,
          },
          receipt: r.idempotency_key,
        };
        return { ok: false, code: 'RESULT_UNKNOWN', message: '模拟回执丢失' };
      }
      if (r.operation === 'status_date') {
        expect(r.idempotency_key).toBe(original!.idempotency_key);
        return mode === 'rejected'
          ? { ok: false, code: 'NO_RECEIPT', message: '原键明确无回执' }
          : { ...base, date_saved: saved };
      }
      return base;
    });
    const apiTask = vi.fn(async (r: { operation: string }) => {
      if (r.operation === 'calendar_query')
        return {
          ok: true,
          calendar_types: [
            { id: 'hearing', name: '开庭', enabled: true, show_home: true, version: 0 },
          ],
          tasks: [],
        };
      if (++reads === 1) return { ok: false, code: 'READ_FAILED', message: '模拟读回失败' };
      return { ok: true, tasks: [{ ...task, version: 3 }], objective_state: null };
    });
    Object.defineProperty(window, 'caselite', {
      configurable: true,
      value: { agent, task: apiTask, material: vi.fn(async () => ({ ok: true, materials: [] })) },
    });
    const changed = vi.fn(),
      client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ImportantDates task={task} disabled={false} onBlocked={() => {}} onChanged={changed} />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByText('识别重要日期'));
    await screen.findByText('核对原件');
    fireEvent.click(screen.getByLabelText('核对原件'));
    fireEvent.change(screen.getByPlaceholderText('例如 Asia/Shanghai'), {
      target: { value: 'Asia/Shanghai' },
    });
    fireEvent.click(screen.getByText('核对条件与新旧字段'));
    await screen.findByLabelText('重要日期确认预览');
    expect(screen.getByText(/工作安排：2026-11-10 09:30–11:00/).textContent).toContain(
      '普通截止日：2026-12-01',
    );
    fireEvent.click(screen.getByText('确认写入此Task重要关注'));
    await screen.findByText('核对并恢复原确认');
    fireEvent.click(screen.getByText('核对并恢复原确认'));
    if (mode === 'rejected') {
      await screen.findByText('重试原确认');
      fireEvent.click(screen.getByText('重试原确认'));
      await screen.findByText('Task已变化，原请求已明确拒绝');
      await waitFor(() => expect(screen.queryByText('核对并恢复原确认')).toBeNull());
      expect(agent.mock.calls.filter(([r]) => r.operation === 'confirm_date')).toHaveLength(2);
      expect(reads).toBe(0);
      expect(changed).not.toHaveBeenCalled();
      client.clear();
      return;
    }
    await screen.findByText('重读已保存Task');
    fireEvent.click(screen.getByText('重读已保存Task'));
    await waitFor(() =>
      expect(changed).toHaveBeenCalledWith(
        expect.objectContaining({ id: taskId, version: 3 }),
        null,
      ),
    );
    expect(agent.mock.calls.filter(([r]) => r.operation === 'confirm_date')).toHaveLength(1);
    expect(agent.mock.calls.filter(([r]) => r.operation === 'status_date')).toHaveLength(1);
    expect(reads).toBe(2);
    client.clear();
  },
);

it.each(['close-during-prepare', 'stop-running'] as const)(
  'waits for delayed cancellation before restarting: %s',
  async (mode) => {
    const scope =
      mode === 'close-during-prepare'
        ? '44444444-4444-4444-8444-444444444444'
        : '55555555-5555-4555-8555-555555555555';
    const task = {
      id: scope,
      version: 1,
      title: '合成停止测试',
      calendar: { type_id: 'hearing' },
    } as Task;
    let releaseCancel!: () => void;
    const cancelled = new Promise<void>((resolve) => {
      releaseCancel = resolve;
    });
    let releasePreview!: () => void;
    const delayedPreview = new Promise<void>((resolve) => {
      releasePreview = resolve;
    });
    let previews = 0;
    const runs: { id: string; purpose: string; status: string; created_at: string }[] = [];
    const base = () => ({ ok: true, configured: false, model: 'gpt-4.1-mini', runs: [...runs] });
    const agent = vi.fn(async (r: AgentRequest) => {
      if (r.operation === 'date_rules')
        return { ...base(), date_rules: { checks: {}, types: [], laws: [], calendars: [] } };
      if (r.operation === 'start') {
        runs.push({
          id: r.run_id,
          purpose: 'important_dates',
          status: 'running',
          created_at: '2026-11-09T00:00:00Z',
        });
        return base();
      }
      if (r.operation === 'cancel') {
        await cancelled;
        const old = runs.find((v) => v.id === r.run_id);
        if (old) old.status = 'cancelled';
        return base();
      }
      return base();
    });
    const material = vi.fn(async (r: { operation: string }) => {
      if (r.operation === 'preview') {
        if (++previews === 1 && mode === 'close-during-prepare') await delayedPreview;
        return { ok: true, materials: [], preview: { id: source } };
      }
      if (r.operation === 'cancel_prepare') {
        await cancelled;
        return {
          ok: true,
          materials: [{ id: source, name: '合成通知.pdf', page_count: 1, sha256: 'a'.repeat(64) }],
        };
      }
      return {
        ok: true,
        materials: [{ id: source, name: '合成通知.pdf', page_count: 1, sha256: 'a'.repeat(64) }],
      };
    });
    Object.defineProperty(window, 'caselite', {
      configurable: true,
      value: {
        agent,
        material,
        task: vi.fn(async () => ({
          ok: true,
          tasks: [],
          calendar_types: [{ id: 'hearing', name: '开庭', enabled: true, version: 0 }],
        })),
      },
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ImportantDates task={task} disabled={false} onBlocked={() => {}} onChanged={() => {}} />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByText('识别重要日期'));
    fireEvent.click(await screen.findByLabelText(/合成通知.pdf · 固定版本/));
    fireEvent.click(screen.getByText('识别所选文书的重要日期'));
    if (mode === 'close-during-prepare') {
      await screen.findByText('正在本地准备固定文字与OCR…');
      fireEvent.click(screen.getByText('关闭'));
      const reopen = screen.getByText('识别重要日期') as HTMLButtonElement;
      expect(reopen.disabled).toBe(true);
      fireEvent.click(reopen);
      expect(screen.queryByText('从固定附件识别重要日期')).toBeNull();
      releasePreview();
      await waitFor(() => expect(previews).toBe(1));
      expect(agent.mock.calls.filter(([r]) => r.operation === 'start')).toHaveLength(0);
      releaseCancel();
      await waitFor(() => expect(reopen.disabled).toBe(false));
      fireEvent.click(reopen);
    } else {
      await waitFor(() => expect(runs).toHaveLength(1));
      fireEvent.click(await screen.findByText('停止识别'));
      const restart = screen.getByText('识别所选文书的重要日期') as HTMLButtonElement;
      expect(restart.disabled).toBe(true);
      fireEvent.click(restart);
      expect(runs).toHaveLength(1);
      await screen.findByText('正在停止原识别，请稍候…');
      releaseCancel();
    }
    await waitFor(() =>
      expect((screen.getByText('识别所选文书的重要日期') as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
    fireEvent.click(screen.getByText('识别所选文书的重要日期'));
    await waitFor(() => expect(runs).toHaveLength(mode === 'stop-running' ? 2 : 1));
    const cancels = agent.mock.calls.filter(([r]) => r.operation === 'cancel');
    expect(cancels).toHaveLength(mode === 'stop-running' ? 1 : 0);
    if (mode === 'stop-running') expect(cancels[0][0]).toMatchObject({ run_id: runs[0].id });
    expect(runs.at(-1)!.status).toBe('running');
    expect(screen.queryByText('正在停止原识别，请稍候…')).toBeNull();
    client.clear();
  },
);
