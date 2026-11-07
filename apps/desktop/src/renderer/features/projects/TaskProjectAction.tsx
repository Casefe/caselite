import { catalogMutation } from '../../shared/data/catalogMutation';
import { useEffect, useRef, useState } from 'react';
import type { Task } from '../../../preload/caselite-api';
import { useCatalog } from '../../ui/useCatalog';
import ProjectCreateDialog from './ProjectCreateDialog';

export default function TaskProjectAction({
  task,
  disabled,
  onDirty,
  onChanged,
}: {
  task: Task;
  disabled: boolean;
  onDirty(value: boolean): void;
  onChanged(task: Task, objectiveState: number[] | null): void;
}) {
  const c = useCatalog();
  const [creating, setCreating] = useState(false),
    [saved, setSaved] = useState(false),
    [readError, setReadError] = useState(''),
    [reading, setReading] = useState(false);
  const readInFlight = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    onDirty(creating || saved || c.pending || c.unknown);
  }, [creating, saved, c.pending, c.unknown, onDirty]);
  const refresh = async () => {
    // 首个有效读回即可解锁编辑，不能再让第二份迟到结果重挂载新草稿。
    if (readInFlight.current) return;
    readInFlight.current = true;
    setReading(true);
    try {
      const result = await window.caselite.task({
        operation: 'read',
        protocol_version: 1,
        task_id: task.id,
      });
      if (!alive.current) return;
      const actual = result.ok ? result.tasks.find((t) => t.id === task.id) : null;
      if (!actual) {
        setReadError('项目已保存，任务属性暂时无法重读。');
        return;
      }
      onChanged(actual, result.ok ? (result.objective_state ?? null) : null);
      setSaved(false);
      setReadError('');
    } catch {
      if (alive.current) setReadError('项目已保存，请重新读取原任务查看关联。');
    } finally {
      readInFlight.current = false;
      if (alive.current) setReading(false);
    }
  };
  return (
    <>
      <label className="inspector-property-row">
        <span className="inspector-property-label">项目</span>
        <select
          aria-label="所属项目"
          value={task.matter_id ?? ''}
          disabled={disabled || creating || c.pending || c.unknown || saved || !c.data}
          onChange={(event) => {
            const matter_id = event.currentTarget.value || null;
            onDirty(true);
            void c
              .execute(
                catalogMutation({
                  operation: 'assign_task',
                  task_id: task.id,
                  expected_version: task.version,
                  matter_id,
                }),
                async () => {
                  setSaved(true);
                  await refresh();
                },
              )
              .then((result) => {
                if (
                  alive.current &&
                  result &&
                  !result.ok &&
                  result.code !== 'RESULT_UNKNOWN' &&
                  result.code !== 'UNAVAILABLE'
                )
                  onDirty(false);
              });
          }}
        >
          <option value="">未归组</option>
          {task.matter_id &&
            !c.data?.projects.some((p) => p.id === task.matter_id && !p.archived_at) && (
              <option value={task.matter_id}>{task.matter_title ?? '当前项目'}</option>
            )}
          {c.data?.projects
            .filter((p) => !p.archived_at)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
        </select>
      </label>
      {!creating && c.error && <p role="alert">{c.error}</p>}
      {!creating && c.error && !c.data && !c.pending && !c.unknown && (
        <button disabled={disabled} onClick={() => void c.load()}>
          重新读取项目
        </button>
      )}
      {!creating && c.unknown && (
        <button disabled={c.pending} onClick={() => void c.retry()}>
          核对原归组
        </button>
      )}
      {!task.matter_id && !saved && (
        <button
          disabled={disabled || creating || c.pending || c.unknown}
          onClick={() => setCreating(true)}
        >
          从任务创建项目
        </button>
      )}
      {readError && <p role="alert">{readError}</p>}
      {saved && (
        <button disabled={reading} onClick={() => void refresh()}>
          重新读取任务关联
        </button>
      )}
      {creating && (
        <ProjectCreateDialog
          sourceTaskTitle={task.title}
          pending={c.pending}
          unknown={c.unknown}
          error={c.error}
          onCancel={() => setCreating(false)}
          onRetry={() => void c.retry()}
          onCreate={(values) =>
            void c.execute(
              catalogMutation({
                operation: 'promote_task',
                ...values,
                task_id: task.id,
                expected_version: task.version,
              }),
              async () => {
                setCreating(false);
                setSaved(true);
                await refresh();
              },
            )
          }
        />
      )}
    </>
  );
}
