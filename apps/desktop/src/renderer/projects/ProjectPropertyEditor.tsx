import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type { CatalogResponse, Matter } from '../../preload/caselite-api';
import ProjectFields, { projectValues, validProject, type ProjectValues } from './ProjectFields';

type Commit = (project: Matter | null) => void;
type Result = Promise<CatalogResponse | null>;
type Draft = { base: Matter; values: ProjectValues; delay: number };

export default function ProjectPropertyEditor({
  project,
  sidebar,
  pending,
  disabled,
  unknown,
  bodyDirty,
  onDirty,
  onReload,
  onRetry,
  onSave,
  onArchive,
}: {
  project: Matter;
  sidebar: boolean;
  pending: boolean;
  disabled: boolean;
  unknown: boolean;
  bodyDirty: boolean;
  onDirty(value: boolean, lifecycle?: boolean): void;
  onReload(): Result;
  onRetry(): Result;
  onSave(base: Matter, values: ProjectValues, committed: Commit): Result;
  onArchive(base: Matter, archived: boolean, committed: Commit): Result;
}) {
  const form = useRef<HTMLFormElement>(null);
  const composing = useRef(false);
  const submitting = useRef(false);
  const current = useRef<Draft | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [archive, setArchive] = useState<{ base: Matter; archived: boolean } | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [failure, setFailure] = useState('');
  const [conflict, setConflict] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const values = draft?.values ?? projectValues(project);
  const valid = !invalid && validProject(values);
  const edit = (next: Draft | null) => {
    current.current = next;
    setDraft(next);
    onDirty(Boolean(next));
  };
  const handleFailure = (result: CatalogResponse | null) => {
    if (!result || !result.ok) {
      setFailure(result?.message ?? '无法确认项目属性是否已保存。');
      setConflict(result?.code === 'CONFLICT');
    }
  };
  const submit = async () => {
    const sent = current.current;
    if (
      submitting.current ||
      composing.current ||
      disabled ||
      pending ||
      unknown ||
      conflict ||
      !valid ||
      !form.current?.checkValidity() ||
      (!sent && !archive)
    )
      return;
    if (sent && JSON.stringify(sent.values) === JSON.stringify(projectValues(sent.base))) {
      edit(null);
      return;
    }
    submitting.current = true;
    setFailure('');
    const committed: Commit = (confirmed) => {
      if (!confirmed) {
        setFailure('保存回执缺少项目版本，请重新读取属性。');
        setConflict(true);
        return;
      }
      if (archive) {
        setArchive(null);
        onDirty(false);
      } else if (
        current.current?.values === sent?.values &&
        !form.current?.querySelector('input:invalid')
      ) {
        edit(null);
      } else if (current.current) {
        // 回执只确认这次发送的内容。保留随后输入，并以已确认版本继续提交。
        edit({ ...current.current, base: confirmed });
      }
      setFailure('');
      setConflict(false);
    };
    try {
      handleFailure(
        archive
          ? await onArchive(archive.base, archive.archived, committed)
          : await onSave(sent!.base, sent!.values, committed),
      );
    } finally {
      submitting.current = false;
    }
  };
  const flush = useEffectEvent(() => void submit());
  useEffect(() => {
    if ((!draft && !archive) || !valid || pending || disabled || unknown || failure || reloading)
      return;
    const timer = window.setTimeout(flush, draft?.delay ?? 0);
    return () => window.clearTimeout(timer);
  }, [draft, archive, valid, pending, disabled, unknown, failure, reloading]);
  const commitSoon = () => {
    if (!composing.current && current.current && !failure) edit({ ...current.current, delay: 0 });
  };
  const abandon = async () => {
    setReloading(true);
    const result = await onReload();
    setReloading(false);
    if (!result?.ok || !result.projects.some((item) => item.id === project.id)) {
      setFailure('无法重新读取项目，未保存的输入已保留。');
      return;
    }
    edit(null);
    setArchive(null);
    setFailure('');
    setConflict(false);
    setInvalid(false);
    setEpoch((n) => n + 1);
  };

  return (
    <form
      ref={form}
      onSubmit={(event) => {
        event.preventDefault();
        commitSoon();
      }}
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={() => {
        composing.current = false;
        if (current.current) edit({ ...current.current, delay: 350 });
      }}
      onBlur={(event) => {
        if (event.target instanceof HTMLInputElement) commitSoon();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && (composing.current || event.nativeEvent.isComposing))
          event.preventDefault();
      }}
    >
      <ProjectFields
        key={epoch}
        sidebar={sidebar}
        value={values}
        disabled={disabled || reloading || !!archive || !!project.archived_at}
        archive={{
          archived: !!project.archived_at,
          disabled: disabled || reloading || !!archive || (unknown && !draft),
          canArchive: !bodyDirty && !draft && !pending && !unknown,
          onChange: (archived) => {
            if (bodyDirty || current.current || pending || unknown) return;
            setArchive({ base: project, archived });
            onDirty(true, true);
          },
        }}
        onChange={(next, immediate) => {
          edit({
            base: current.current?.base ?? project,
            values: next,
            delay: immediate ? 0 : 350,
          });
        }}
        onInvalid={(value) => {
          setInvalid(value);
          if (value && !current.current) edit({ base: project, values, delay: 350 });
        }}
      />
      {!valid && <p role="alert">请核对项目属性格式，输入已保留。</p>}
      {(draft || archive) && (
        <>
          {pending && <p role="status">正在保存项目属性…</p>}
          {failure && <p role="alert">项目属性保存未确认。{failure}</p>}
          {!pending && !failure && valid && <p role="status">项目属性等待保存，请稍候。</p>}
          {unknown ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => void onRetry().then(handleFailure)}
            >
              核对原属性提交
            </button>
          ) : (
            <>
              {failure && !conflict && (
                <button
                  type="button"
                  disabled={pending || !valid || reloading}
                  onClick={() => void submit()}
                >
                  重试保存属性
                </button>
              )}
              {(failure || !valid) && (
                <button
                  type="button"
                  disabled={pending || reloading}
                  onClick={() => void abandon()}
                >
                  放弃属性修改并重读
                </button>
              )}
            </>
          )}
        </>
      )}
    </form>
  );
}
