import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type {
  AgentRequest,
  AgentResponse,
  AgentRun,
  DateChecks,
  DateConfirmRequest,
  DateConfirmation,
  DateEvaluated,
  Material,
  Task,
} from '../../../preload/caselite-api';
import { isDocx, pageRange, useMaterials } from '../../ui/useMaterials';
import { DocxOriginalReader } from '../../ui/DocxOriginalReader';
import {
  calendarQuery,
  useCalendar,
  attentionDate,
  attentionTime,
  invalidateCalendar,
} from './calendar-query';
const PdfReader = lazy(() => import('../../ui/PdfReader'));
type Success = Extract<AgentResponse, { ok: true }>;
type Start = Extract<AgentRequest, { operation: 'start' }>;
const starts = new Map<string, Start>();
const confirmations = new Map<
  string,
  { request: DateConfirmRequest; saved?: Success['date_saved'] }
>();
const emptyChecks: DateChecks = {
  source_reviewed: false,
  ordinary_civil: false,
  applicable_party: false,
  valid_service: false,
  current_notice: false,
  no_changes: false,
  evidence_55_56: false,
  boundary: false,
  conflict_resolved: false,
};
const statuses = {
  ready: '可供人工确认',
  needs_information: '待补充／核对',
  unsupported: '当前不支持此公式',
  invalid: '核对失败',
  conflict: '日期冲突待核对',
};
function calendarText(task: Task) {
  return `重要关注：${attentionDate(task) ?? '未设置'} ${attentionTime(task) ?? ''} ${task.calendar?.attention_source === 'schedule' ? task.calendar.schedule?.timezone : (task.calendar?.attention_timezone ?? '')}；类型 ${task.calendar?.type_id ?? '未设置'}`;
}
function workText(task: Task) {
  const s = task.calendar?.schedule;
  return `工作安排：${s ? `${s.date} ${s.start}–${s.end} ${s.timezone}` : '未设置'}；普通截止日：${task.due_date ?? '未设置'}`;
}
export default function ImportantDates({
  task,
  disabled,
  onBlocked,
  onChanged,
}: {
  task: Task;
  disabled: boolean;
  onBlocked(value: boolean): void;
  onChanged(task: Task, state: number[] | null): void;
}) {
  const materials = useMaterials(task.id, true, false),
    types = useCalendar(calendarQuery('types')),
    client = useQueryClient();
  const [open, setOpen] = useState(false),
    dialog = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState<Record<string, string>>({}),
    [typeIds, setTypeIds] = useState<string[]>(
      task.calendar?.type_id ? [task.calendar.type_id] : [],
    );
  const [runs, setRuns] = useState<AgentRun[]>([]),
    [runId, setRunId] = useState(''),
    [model, setModel] = useState<Success['model']>('gpt-4.1-mini');
  const [rules, setRules] = useState<Success['date_rules']>(),
    [result, setResult] = useState<Success>(),
    [error, setError] = useState('');
  const [busy, setBusy] = useState(false),
    [preparing, setPreparing] = useState(false),
    [unknownStart, setUnknownStart] = useState(starts.has(task.id));
  const [confirmPhase, setConfirmPhase] = useState<'idle' | 'unknown' | 'read'>(
    confirmations.has(task.id) ? 'unknown' : 'idle',
  );
  const [checks, setChecks] = useState<Record<number, DateChecks>>({}),
    [timezone, setTimezone] = useState(''),
    [preview, setPreview] = useState<DateEvaluated>();
  const [startAbsent, setStartAbsent] = useState(false),
    [confirmAbsent, setConfirmAbsent] = useState(false);
  const [currentTask, setCurrentTask] = useState(task);
  const [reader, setReader] = useState<{
      data: Uint8Array;
      material: Material;
      page: number;
    } | null>(null),
    readerDialog = useRef<HTMLDialogElement>(null);
  const generation = useRef(0),
    alive = useRef(true),
    activeRun = useRef(''),
    preparingRef = useRef(false);
  const running = runs.some((r) => r.status === 'running');
  useEffect(() => {
    onBlocked(open || confirmPhase !== 'idle');
    return () => onBlocked(false);
  }, [open, confirmPhase, onBlocked]);
  useEffect(() => {
    alive.current = true;
    const cleanupGeneration = generation;
    return () => {
      alive.current = false;
      cleanupGeneration.current++;
      if (preparingRef.current)
        void window.caselite.material({
          protocol_version: 1,
          operation: 'cancel_prepare',
          scope: task.id,
        });
      if (activeRun.current)
        void window.caselite.agent({
          protocol_version: 1,
          operation: 'cancel',
          scope: task.id,
          run_id: activeRun.current,
        });
    };
  }, [task.id]);
  useEffect(() => {
    if (!open || !dialog.current) return;
    const d = dialog.current,
      focus = document.activeElement;
    d.showModal();
    return () => {
      if (d.open) d.close();
      if (focus instanceof HTMLElement && focus.isConnected) focus.focus();
    };
  }, [open]);
  useEffect(() => {
    if (reader && readerDialog.current) {
      const d = readerDialog.current;
      d.showModal();
      return () => {
        if (d.open) d.close();
      };
    }
  }, [reader]);
  useEffect(() => {
    if (!open) return;
    let stopped = false,
      timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const r = await window.caselite.agent({
          protocol_version: 1,
          operation: 'read',
          scope: task.id,
        });
        if (stopped) return;
        if (!r.ok) throw Error(r.message);
        const found = r.runs.filter((v) => v.purpose === 'important_dates');
        setRuns(found);
        setModel(r.model);
        const active = found.find((v) => v.status === 'running');
        activeRun.current = active?.id ?? '';
        if (!runId && found.length) setRunId(found.at(-1)!.id);
        if (runId) {
          const view = await window.caselite.agent({
            protocol_version: 1,
            operation: 'read_dates',
            scope: task.id,
            run_id: runId,
          });
          if (!stopped) {
            if (view.ok) setResult(view);
            else setError(view.message);
          }
        }
      } catch (e) {
        if (!stopped) setError(e instanceof Error ? e.message : '运行读取失败');
      } finally {
        if (!stopped) timer = setTimeout(() => void poll(), 600);
      }
    }
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [open, runId, task.id]);
  async function show() {
    setOpen(true);
    setError('');
    try {
      const r = await window.caselite.agent({ protocol_version: 1, operation: 'date_rules' });
      if (!r.ok) throw Error(r.message);
      setRules(r.date_rules);
    } catch {
      setError('日期规则暂不可读取');
    }
  }
  async function dispatch(request: Start) {
    const r = await window.caselite.agent(request);
    if (!alive.current) return;
    if (!r.ok) {
      if (['RESULT_UNKNOWN', 'INTERNAL', 'IPC_TIMEOUT', 'BUSY'].includes(r.code)) {
        setUnknownStart(true);
        throw Error('原运行受理状态未知，请核对原运行，不要另发');
      }
      starts.delete(task.id);
      setUnknownStart(false);
      throw Error(r.message);
    }
    if (!r.runs.some((v) => v.id === request.run_id)) throw Error('未获得原运行回执，请核对');
    starts.delete(task.id);
    setUnknownStart(false);
    setRunId(request.run_id);
    setRuns(r.runs.filter((v) => v.purpose === 'important_dates'));
    activeRun.current = r.runs.find((v) => v.status === 'running')?.id ?? '';
  }
  async function start() {
    if (busy || running || unknownStart || confirmPhase !== 'idle') return;
    setBusy(true);
    setPreparing(true);
    preparingRef.current = true;
    setError('');
    setPreview(undefined);
    setChecks({});
    const token = ++generation.current;
    try {
      const chosen = Object.entries(selected).map(([id, range]) => {
        const s = materials.items.find((v) => v.id === id);
        const pages = s && pageRange(range, s.page_count);
        if (!s || !pages?.length) throw Error('请核对已选文件的物理页／Word提取段范围');
        return { source_id: id, pages };
      });
      if (!chosen.length || !typeIds.length) throw Error('请选择本轮文书与重要类型');
      const instruction =
        '识别本轮所选重要类型的明确日期或有依据的相对期间事实；不自行计算法律日期。';
      const r = await window.caselite.material({
        protocol_version: 1,
        operation: 'preview',
        scope: task.id,
        instruction,
        model,
        selected: chosen,
        automatic: true,
        text_only: true,
      });
      if (!alive.current || generation.current !== token) return;
      if (!r.ok) throw Error(r.message);
      if (!r.preview) throw Error('固定材料未准备完成');
      const request: Start = {
        protocol_version: 1,
        operation: 'start',
        scope: task.id,
        run_id: crypto.randomUUID(),
        model,
        prompt: instruction,
        confirmed: true,
        context_id: r.preview.id,
        purpose: 'important_dates',
        date_types: typeIds,
        task_version: task.version,
      };
      starts.set(task.id, request);
      activeRun.current = request.run_id;
      setUnknownStart(true);
      await dispatch(request);
    } catch (e) {
      if (alive.current && generation.current === token)
        setError(e instanceof Error ? e.message : '识别未启动');
    } finally {
      if (alive.current && generation.current === token) {
        setBusy(false);
        setPreparing(false);
      }
      preparingRef.current = false;
    }
  }
  async function stop() {
    generation.current++;
    setPreparing(false);
    preparingRef.current = false;
    setBusy(false);
    await materials.cancelPreparation();
    const id = activeRun.current || starts.get(task.id)?.run_id;
    if (id)
      await window.caselite.agent({
        protocol_version: 1,
        operation: 'cancel',
        scope: task.id,
        run_id: id,
      });
    setPreview(undefined);
  }
  async function recoverStart(retry = false) {
    const original = starts.get(task.id);
    if (!original) return;
    setBusy(true);
    setError('');
    try {
      const r = await window.caselite.agent({
        protocol_version: 1,
        operation: 'read_dates',
        scope: task.id,
        run_id: original.run_id,
      });
      if (r.ok) {
        starts.delete(task.id);
        setUnknownStart(false);
        setRunId(original.run_id);
        setResult(r);
      } else if (r.code === 'NO_RUN') {
        setStartAbsent(true);
        if (retry) {
          setStartAbsent(false);
          await dispatch(original);
        } else throw Error('原运行明确未登记，可重试原请求或放弃未发送请求');
      } else throw Error(r.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : '原运行尚未核对');
    } finally {
      setBusy(false);
    }
  }
  async function evaluate(c: DateEvaluated) {
    setBusy(true);
    setError('');
    try {
      const r = await window.caselite.agent({
        protocol_version: 1,
        operation: 'preview_date',
        scope: task.id,
        run_id: runId,
        candidate_index: c.index,
        expected_version: task.version,
        checks: checks[c.index] ?? emptyChecks,
        timezone: timezone || null,
      });
      if (!r.ok) throw Error(r.message);
      setPreview(r.date_candidates?.[0]);
      if (r.date_task) setCurrentTask(r.date_task);
    } catch (e) {
      setError(e instanceof Error ? e.message : '候选核对失败');
    } finally {
      setBusy(false);
    }
  }
  async function refreshSaved(
    saved: NonNullable<Success['date_saved']>,
    request: DateConfirmRequest,
  ) {
    if (
      saved.receipt !== request.idempotency_key ||
      saved.confirmation.request.scope !== task.id ||
      saved.confirmation.request.run_id !== request.run_id
    )
      throw Error('确认回执身份不符，请保留原提交');
    confirmations.set(task.id, { request, saved });
    setConfirmPhase('read');
    const r = await window.caselite.task({
      protocol_version: 1,
      operation: 'read',
      task_id: task.id,
    });
    if (!r.ok || !r.tasks[0] || r.tasks[0].version < saved.task.version)
      throw Error('已保存，当前Task尚未读回；仅重读，不再提交');
    confirmations.delete(task.id);
    setConfirmPhase('idle');
    setPreview(undefined);
    setCurrentTask(r.tasks[0]);
    invalidateCalendar(client);
    onChanged(r.tasks[0], r.objective_state ?? null);
  }
  async function confirm(recover = false, retryMissing = false) {
    const old = confirmations.get(task.id);
    setConfirmAbsent(false);
    if (!old && !preview) return;
    setBusy(true);
    setError('');
    const request = old?.request ?? {
      protocol_version: 1 as const,
      operation: 'confirm_date' as const,
      scope: task.id,
      run_id: runId,
      candidate_index: preview!.index,
      expected_version: currentTask.version,
      checks: checks[preview!.index] ?? emptyChecks,
      timezone: timezone || null,
      confirmed: true as const,
      idempotency_key: crypto.randomUUID(),
    };
    confirmations.set(task.id, old ?? { request });
    setConfirmPhase(old?.saved ? 'read' : 'unknown');
    try {
      if (old?.saved) {
        await refreshSaved(old.saved, request);
        return;
      }
      let r = await window.caselite.agent(
        recover
          ? {
              protocol_version: 1,
              operation: 'status_date',
              scope: task.id,
              run_id: request.run_id,
              idempotency_key: request.idempotency_key,
            }
          : request,
      );
      let checkingOriginal = recover;
      if (recover && !r.ok && r.code === 'NO_RECEIPT') {
        if (!retryMissing) {
          setConfirmAbsent(true);
          setError('原确认已结束且明确无回执，可重试原请求或放弃未提交确认');
          return;
        }
        checkingOriginal = false;
        r = await window.caselite.agent(request);
      }
      if (!r.ok) {
        if (
          !checkingOriginal &&
          !['RESULT_UNKNOWN', 'INTERNAL', 'IPC_TIMEOUT', 'READ_FAILED', 'WRITE_FAILED'].includes(
            r.code,
          )
        ) {
          confirmations.delete(task.id);
          setConfirmPhase('idle');
        }
        throw Error(r.message);
      }
      if (!r.date_saved) throw Error('未获得原日期确认回执');
      await refreshSaved(r.date_saved, request);
    } catch (e) {
      setError(e instanceof Error ? e.message : '确认状态未知，请核对原提交');
    } finally {
      setBusy(false);
    }
  }
  async function readSource(
    q: DateEvaluated['fact']['context'][number],
    binding: NonNullable<AgentRun['date_binding']>,
  ) {
    const source = binding.sources.find(
      (s) => s.source_id === q.source_id && s.pages.includes(q.page),
    );
    if (!source) return;
    setBusy(true);
    setError('');
    const token = generation.current;
    try {
      const r = await window.caselite.material({
        protocol_version: 1,
        operation: 'read_fixed',
        scope: task.id,
        source_id: source.source_id,
        asset_version_id: source.asset_version_id,
        derivation_id: source.derivation_id,
        sha256: source.sha256,
      });
      if (!alive.current || generation.current !== token) return;
      if (!r.ok || !r.data || !r.materials[0]) throw Error(r.ok ? '固定原件读取不完整' : r.message);
      setReader({ data: r.data, material: r.materials[0], page: q.page });
    } catch (e) {
      setError(e instanceof Error ? e.message : '固定来源无法打开');
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  const currentRun = runs.find((r) => r.id === runId),
    binding = currentRun?.date_binding ?? result?.runs.find((r) => r.id === runId)?.date_binding;
  const close = () => {
    if (confirmPhase !== 'idle') return;
    void stop();
    setReader(null);
    setOpen(false);
  };
  const renderCandidate = (
    c: DateEvaluated,
    b: NonNullable<AgentRun['date_binding']>,
    saved?: DateConfirmation,
  ) => (
    <article
      className="date-candidate"
      key={`${saved?.request.idempotency_key ?? 'candidate'}:${c.index}`}
    >
      <h4>
        {types.data?.calendar_types?.find((t) => t.id === c.fact.type_id)?.name ?? c.fact.type_id} ·{' '}
        {saved ? '已确认记录' : statuses[c.status]}
      </h4>
      <p>
        {c.date ?? '日期尚不可确定'} {c.time ?? ''}{' '}
        {c.fact.time_semantics === 'submission_deadline'
          ? '提交截止关注时点'
          : c.fact.time_semantics === 'event_start'
            ? '文书开始时点'
            : ''}
      </p>
      {(c.fact.trigger || c.fact.period) && (
        <p>
          原文起算候选：{c.fact.trigger?.value ?? '缺失'}；原文期间：
          {c.fact.period?.value ?? '缺失'}自然日。有效性及适用条件须另核对。
        </p>
      )}
      {c.messages.map((m, i) => (
        <p key={i}>{m}</p>
      ))}
      {c.computation.map((m, i) => (
        <p key={`calc:${i}`}>{m}</p>
      ))}
      <small>
        规则 {c.fact.rule} / {c.rule_version}；日历{' '}
        {c.calendar_versions.join('、') || '明确日期未套用假日顺延'}；固定输入 {b.preview_id}
      </small>
      {[c.fact.date, c.fact.time, c.fact.trigger, c.fact.period, ...c.fact.context]
        .filter((q) => q !== null)
        .filter(
          (q, i, all) =>
            all.findIndex(
              (other) =>
                other.source_id === q.source_id && other.page === q.page && other.quote === q.quote,
            ) === i,
        )
        .map((q, i) => (
          <blockquote key={i}>
            <p>{q.quote}</p>
            <small>
              {materials.items.find((s) => s.id === q.source_id)?.name ?? '固定来源'} · 页/提取段{' '}
              {q.page} · 版本{' '}
              {b.sources.find((s) => s.source_id === q.source_id)?.sha256.slice(0, 12)}
            </small>
            <button disabled={busy} onClick={() => void readSource(q, b)}>
              查看此固定原文
            </button>
          </blockquote>
        ))}
      {saved ? (
        <p>
          确认时区：{saved.candidate.time ? saved.request.timezone : 'date-only'} · Task v
          {saved.task_version} · {saved.confirmed_at} · 回执 {saved.request.idempotency_key}
        </p>
      ) : (
        <>
          {c.requires.map((key) => (
            <label key={key}>
              <input
                type="checkbox"
                checked={(checks[c.index] ?? emptyChecks)[key]}
                disabled={busy || confirmPhase !== 'idle'}
                onChange={(e) => {
                  setChecks({
                    ...checks,
                    [c.index]: { ...(checks[c.index] ?? emptyChecks), [key]: e.target.checked },
                  });
                  setPreview(undefined);
                }}
              />
              {rules?.checks[key] ?? key}
            </label>
          ))}
          <button
            disabled={busy || running || confirmPhase !== 'idle'}
            onClick={() => void evaluate(c)}
          >
            核对条件与新旧字段
          </button>
        </>
      )}
    </article>
  );
  return (
    <>
      <button disabled={disabled || !materials.available} onClick={() => void show()}>
        识别重要日期
      </button>
      {open && (
        <dialog
          ref={dialog}
          className="important-date-dialog"
          aria-label="识别重要日期"
          onCancel={(e) => {
            e.preventDefault();
            close();
          }}
        >
          <header>
            <h3>从固定附件识别重要日期</h3>
            <button disabled={confirmPhase !== 'idle' || (busy && !preparing)} onClick={close}>
              关闭
            </button>
          </header>
          <p>
            仅点击识别后，将本次勾选的文书页段发送至所选服务商 {model}
            。本地提取/OCR与模型推理分开；AI候选须核原文和适用事实，确认前不会改任务或创建提醒。
          </p>
          <fieldset disabled={busy || running || unknownStart || confirmPhase !== 'idle'}>
            <legend>本轮文书范围</legend>
            {materials.items.map((s) => (
              <div key={s.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={s.id in selected}
                    onChange={(e) => {
                      const copy = { ...selected };
                      if (e.target.checked) copy[s.id] = '';
                      else delete copy[s.id];
                      setSelected(copy);
                      setPreview(undefined);
                    }}
                  />
                  {s.name} · 固定版本 {s.sha256.slice(0, 12)}
                </label>
                {s.id in selected && (
                  <label>
                    物理页／Word提取段（空为全部{s.page_count}项）
                    <input
                      aria-label={`${s.name}使用范围`}
                      value={selected[s.id]}
                      onChange={(e) => setSelected({ ...selected, [s.id]: e.target.value })}
                    />
                  </label>
                )}
              </div>
            ))}
            <legend>重要类型</legend>
            {types.data?.calendar_types
              ?.filter((t) => t.enabled)
              .map((t) => (
                <label key={t.id}>
                  <input
                    type="checkbox"
                    checked={typeIds.includes(t.id)}
                    onChange={(e) =>
                      setTypeIds(
                        e.target.checked ? [...typeIds, t.id] : typeIds.filter((id) => id !== t.id),
                      )
                    }
                  />
                  {t.name}
                </label>
              ))}
          </fieldset>
          <button
            disabled={busy || running || unknownStart || confirmPhase !== 'idle'}
            onClick={() => void start()}
          >
            识别所选文书的重要日期
          </button>
          {(preparing || running) && <button onClick={() => void stop()}>停止识别</button>}
          {preparing && <p role="status">正在本地准备固定文字与OCR…</p>}
          {unknownStart && (
            <p>
              原运行受理待核对。
              <button disabled={busy} onClick={() => void recoverStart()}>
                核对原运行
              </button>
              <button disabled={busy} onClick={() => void recoverStart(true)}>
                查无后重试原请求
              </button>
              {startAbsent && (
                <button
                  disabled={busy}
                  onClick={() => {
                    starts.delete(task.id);
                    setUnknownStart(false);
                    setStartAbsent(false);
                    setError('未登记的请求已放弃，可重新核对材料');
                  }}
                >
                  放弃未登记的原请求
                </button>
              )}
            </p>
          )}
          {runs.length > 0 && (
            <label>
              本任务日期分析历史
              <select
                value={runId}
                disabled={busy || confirmPhase !== 'idle'}
                onChange={(e) => {
                  setRunId(e.target.value);
                  setResult(undefined);
                  setPreview(undefined);
                  setChecks({});
                }}
              >
                {runs.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.created_at} · {r.status}
                  </option>
                ))}
              </select>
            </label>
          )}
          {currentRun && (
            <details open={currentRun.status === 'running'}>
              <summary>
                运行 {currentRun.status} · {currentRun.id}
              </summary>
              <pre>{currentRun.output}</pre>
              <p>{currentRun.message}</p>
            </details>
          )}
          {result?.date_error && <p role="alert">{result.date_error}</p>}
          {binding && result?.date_candidates?.map((c) => renderCandidate(c, binding))}
          <label>
            关注时刻IANA时区（有时刻须明确确认）
            <input
              value={timezone}
              placeholder="例如 Asia/Shanghai"
              disabled={busy || confirmPhase !== 'idle'}
              onChange={(e) => {
                setTimezone(e.target.value);
                setPreview(undefined);
              }}
            />
          </label>
          {preview && (
            <section aria-label="重要日期确认预览">
              <h4>新旧字段核对</h4>
              <p>{calendarText(currentTask)}</p>
              <p>
                本次新重要关注：{preview.fact.type_id} · {preview.date ?? '待确定'}{' '}
                {preview.time ?? ''} {preview.time ? timezone : 'date-only'}
              </p>
              <p>{workText(currentTask)}（本次保留）</p>
              <p>不创建提醒；再次确认会保留既有确认记录。</p>
              <p>{statuses[preview.status]}</p>
              <button
                disabled={
                  busy ||
                  preview.status !== 'ready' ||
                  (!!preview.time && !timezone) ||
                  confirmPhase !== 'idle'
                }
                onClick={() => void confirm()}
              >
                确认写入此Task重要关注
              </button>
            </section>
          )}
          {confirmPhase !== 'idle' && (
            <p role="status">
              {confirmPhase === 'read' ? '确认已落盘，等待读回' : '确认回执待核对，保留原请求'}
              <button disabled={busy} onClick={() => void confirm(true)}>
                {confirmPhase === 'read' ? '重读已保存Task' : '核对并恢复原确认'}
              </button>
              {confirmAbsent && (
                <>
                  <button disabled={busy} onClick={() => void confirm(true, true)}>
                    重试原确认
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => {
                      confirmations.delete(task.id);
                      setConfirmPhase('idle');
                      setConfirmAbsent(false);
                      setError('未提交确认已放弃，候选与原件保留');
                    }}
                  >
                    放弃未提交确认
                  </button>
                </>
              )}
            </p>
          )}
          {!!result?.date_confirmations?.length && (
            <details>
              <summary>已确认依据（保留当时规则与计算）</summary>
              {result.date_confirmations.map((s) => renderCandidate(s.candidate, s.binding, s))}
            </details>
          )}
          {error && <p role="alert">{error}</p>}
          {reader && (
            <dialog
              ref={readerDialog}
              className="material-reader-dialog"
              aria-label="日期依据固定原件"
              onCancel={(e) => {
                e.preventDefault();
                setReader(null);
              }}
            >
              <p>
                来源版本 {reader.material.id} · 派生 {reader.material.derivation_id} · SHA-256{' '}
                {reader.material.sha256} · 页/提取段 {reader.page}
              </p>
              {isDocx(reader.material.name) ? (
                <DocxOriginalReader
                  name={reader.material.name}
                  material={reader.material}
                  onClose={() => setReader(null)}
                  onSaveOriginal={() => void materials.saveOriginal(reader.material.id, task.id)}
                />
              ) : (
                <Suspense fallback={<p>正在读取固定PDF…</p>}>
                  <PdfReader
                    name={reader.material.name}
                    bytes={reader.data}
                    textPages={reader.material.pages}
                    initialPage={reader.page}
                    onClose={() => setReader(null)}
                  />
                </Suspense>
              )}
            </dialog>
          )}
        </dialog>
      )}
    </>
  );
}
