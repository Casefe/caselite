import { useCallback, useEffect, useRef, useState } from 'react';
import type { Material } from '../../../preload/caselite-api';

export function useProjectOriginals() {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [selected, setSelected] = useState<Material | null>(null);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const epoch = useRef(0);
  const load = useCallback(async (project: string, source?: Material) => {
    const request = ++epoch.current;
    setProjectId(project);
    if (!source) setMaterials([]);
    setSelected(null);
    setBytes(null);
    setError('');
    setBusy(true);
    try {
      const result = await window.caselite.material(
        source
          ? {
              protocol_version: 1,
              operation: 'read_project',
              project_id: project,
              source_id: source.id,
            }
          : { protocol_version: 1, operation: 'list_project', project_id: project },
      );
      // 只消费最后一次范围请求，迟到的其他项目原件不能进入当前目录。
      if (request !== epoch.current) return;
      if (!result.ok) {
        if (result.code === 'SCOPE') setMaterials([]);
        setError(result.message);
        return;
      }
      setMaterials(result.materials);
      if (source && result.data) {
        setSelected(result.materials.find((item) => item.id === source.id) ?? null);
        setBytes(result.data);
      }
    } catch {
      if (request === epoch.current) setError('无法读取项目原件，请重试。');
    } finally {
      if (request === epoch.current) setBusy(false);
    }
  }, []);
  const saveOriginal = useCallback(async () => {
    if (!projectId || !selected) return;
    const request = epoch.current;
    try {
      const result = await window.caselite.material({
        protocol_version: 1,
        operation: 'save_project_original',
        project_id: projectId,
        source_id: selected.id,
      });
      if (request !== epoch.current || result.ok) return;
      if (result.code === 'SCOPE') {
        setMaterials([]);
        setSelected(null);
        setBytes(null);
      }
      setError(result.message);
    } catch {
      if (request === epoch.current) setError('未保存原件副本，请重试。');
    }
  }, [projectId, selected]);
  const close = useCallback(() => {
    ++epoch.current;
    setSelected(null);
    setBytes(null);
    setBusy(false);
  }, []);
  useEffect(
    () => () => {
      ++epoch.current;
    },
    [],
  );
  return { projectId, materials, selected, bytes, error, busy, load, close, saveOriginal };
}
