import { useEffect, useRef, useState } from 'react';
import type { Task } from '../../preload/caselite-api';
import { catalogMutation, useCatalog } from '../ui/useCatalog';
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
  onChanged(task: Task): void;
}) {
  const c = useCatalog();
  const [creating, setCreating] = useState(false),
    [saved, setSaved] = useState(false),
    [readError, setReadError] = useState('');
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (!creating) return;
    onDirty(true);
    return () => onDirty(false);
  }, [creating, onDirty]);
  const refresh = async () => {
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
      onChanged(actual);
      setSaved(false);
      setReadError('');
    } catch {
      if (alive.current) setReadError('项目已保存，请重新读取原任务查看关联。');
    }
  };
  return (
    <>
      {!task.matter_id && !saved && (
        <button
          disabled={disabled || creating || c.pending || c.unknown}
          onClick={() => setCreating(true)}
        >
          从任务创建项目
        </button>
      )}
      {readError && <p role="alert">{readError}</p>}
      {saved && <button onClick={() => void refresh()}>重新读取任务关联</button>}
      {creating && (
        <ProjectCreateDialog
          sourceTaskTitle={task.title}
          pending={c.pending}
          unknown={c.unknown}
          error={c.error}
          onCancel={() => setCreating(false)}
          onRetry={() => void c.retry()}
          onCreate={(title) =>
            void c.execute(
              catalogMutation({
                operation: 'promote_task',
                title,
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
