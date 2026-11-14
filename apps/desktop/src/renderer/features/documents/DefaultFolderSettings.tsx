import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  FolderConfiguration,
  FolderRequest,
  FolderResponse,
} from '../../../preload/caselite-api';

export default function DefaultFolderSettings({
  projectId,
  onBlocked,
  onChanged,
  disabled = false,
}: {
  projectId?: string;
  onBlocked?(value: boolean): void;
  onChanged?(): void;
  disabled?: boolean;
}) {
  const [configuration, setConfiguration] = useState<FolderConfiguration>();
  const [projectRevision, setProjectRevision] = useState(0);
  const [projectDirectory, setProjectDirectory] = useState('');
  const [pending, setPending] = useState(false);
  const [unknown, setUnknown] = useState<{
    id: string;
    operation: 'set_default' | 'bind_project';
  }>();
  const [message, setMessage] = useState('');
  const generation = useRef(0);
  const scope = projectId
    ? { kind: 'project' as const, project_id: projectId }
    : { kind: 'workspace' as const };
  const call = useCallback(async (request: FolderRequest): Promise<FolderResponse | undefined> => {
    if (!window.caselite?.folder)
      return { ok: false, code: 'SOURCE_UNAVAILABLE', message: '当前版本暂不支持本地文件夹。' };
    try {
      return await window.caselite.folder(request);
    } catch {
      return undefined;
    }
  }, []);
  const load = useCallback(async () => {
    const epoch = generation.current;
    const target = projectId
      ? { kind: 'project' as const, project_id: projectId }
      : { kind: 'workspace' as const };
    const result = await call({ protocol_version: 1, operation: 'configuration', scope: target });
    if (generation.current !== epoch) return;
    if (result?.ok) {
      setConfiguration(result.configuration);
      setProjectRevision(result.project_revision ?? 0);
      setProjectDirectory(result.project_directory_name ?? '');
    } else setMessage(result?.message ?? '无法读取文件夹设置。');
  }, [call, projectId]);
  useEffect(() => {
    generation.current += 1;
    const epoch = generation.current;
    queueMicrotask(() => {
      if (generation.current !== epoch) return;
      setConfiguration(undefined);
      setProjectRevision(0);
      setProjectDirectory('');
      setPending(false);
      setUnknown(undefined);
      setMessage('');
      void load();
    });
    return () => {
      generation.current += 1;
    };
  }, [load]);
  useEffect(() => {
    onBlocked?.(pending || !!unknown);
    return () => onBlocked?.(false);
  }, [pending, unknown, onBlocked]);
  async function choose(reselect = false) {
    if (pending || unknown) return;
    const epoch = generation.current;
    const id = crypto.randomUUID();
    const operation = projectId ? 'bind_project' : 'set_default';
    setPending(true);
    setMessage('');
    const request: FolderRequest = projectId
      ? {
          protocol_version: 1,
          operation: 'bind_project',
          project_id: projectId,
          request_id: id,
          expected_revision: projectRevision,
        }
      : {
          protocol_version: 1,
          operation: reselect ? 'reselect_default' : 'choose_default',
          request_id: id,
          expected_revision: configuration?.revision ?? 0,
        };
    const result = await call(request);
    if (generation.current !== epoch) return;
    setPending(false);
    if (!result || (!result.ok && result.code === 'RESULT_UNKNOWN')) {
      setUnknown({ id, operation });
      setMessage('操作结果尚不确定，请先核对原操作。');
      return;
    }
    if (!result.ok) setMessage(result.message);
    else if (result.state !== 'cancelled') {
      await load();
      if (generation.current === epoch) onChanged?.();
    }
  }
  async function query() {
    if (!unknown || pending) return;
    const epoch = generation.current;
    setPending(true);
    const result = await call({
      protocol_version: 1,
      operation: 'query_configuration',
      request_kind: 'configuration',
      configuration_operation: unknown.operation,
      request_id: unknown.id,
      scope,
    });
    if (generation.current !== epoch) return;
    setPending(false);
    if (!result || (!result.ok && result.code === 'RESULT_UNKNOWN')) {
      setMessage('结果仍不确定，请稍后再次核对。');
      return;
    }
    if (!result.ok) {
      if (result.code === 'NOT_FOUND') {
        setMessage('暂未查到回执，原操作仍可能执行中，请稍后继续核对。');
        return;
      }
      setUnknown(undefined);
      await load();
      if (generation.current === epoch) setMessage(result.message);
      return;
    }
    setUnknown(undefined);
    setMessage('已核对原操作。');
    await load();
    if (generation.current === epoch) onChanged?.();
  }
  return (
    <div className="setting-row" aria-label={projectId ? '项目本地文件夹' : '默认本地文件夹'}>
      <div>
        <h3>{projectId ? '项目本地文件夹' : '默认本地文件夹'}</h3>
        <p>
          {projectId
            ? '选择默认文件夹内属于此项目的目录。'
            : '选择后可在文档工作区浏览，重启后自动恢复。'}
        </p>
        <p>
          {projectId ? projectDirectory || '尚未选择' : configuration?.display_name || '尚未选择'}
        </p>
        {message && <p role="status">{message}</p>}
      </div>
      <div>
        <button
          disabled={pending || !!unknown || disabled || (!!projectId && !configuration)}
          onClick={() => void choose()}
        >
          {projectId ? '选择项目目录' : configuration ? '更换文件夹' : '选择文件夹'}
        </button>
        {!projectId && configuration && (
          <button disabled={pending || !!unknown || disabled} onClick={() => void choose(true)}>
            重新选择原文件夹
          </button>
        )}
        {unknown && (
          <button disabled={pending} onClick={() => void query()}>
            核对原操作
          </button>
        )}
      </div>
    </div>
  );
}
