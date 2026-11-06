import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  Material,
  MaterialScope,
  MaterialResponse,
  MaterialRequest,
  MaterialPreview,
  AgentModel,
} from '../../preload/caselite-api';
export function pageRange(value: string, count: number): number[] | null {
  if (!value.trim()) return Array.from({ length: count }, (_, i) => i + 1);
  const result = new Set<number>();
  for (const part of value.split(/[,，]/)) {
    const match = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(part);
    if (!match) return null;
    const from = Number(match[1]),
      to = Number(match[2] ?? match[1]);
    if (from < 1 || to < from || to > count) return null;
    for (let n = from; n <= to; n++) result.add(n);
  }
  return [...result].sort((a, b) => a - b);
}
export function useMaterials(scope: MaterialScope) {
  const [items, setItems] = useState<Material[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [staged, setStaged] = useState<{ token: string; name: string; bytes: number } | null>(null);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [reading, setReading] = useState<{ id: string; name: string; bytes: Uint8Array } | null>(
    null,
  );
  const alive = useRef(true),
    lock = useRef(false);
  const available = typeof window.caselite?.material === 'function';
  useEffect(() => {
    alive.current = true;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      if (!available) return;
      try {
        const r = await window.caselite.material({ protocol_version: 1, operation: 'list', scope });
        if (stopped) return;
        if (r.ok) {
          setItems(r.materials);
          if (!lock.current) setStaged(r.staged ?? null);
        } else setError(r.message);
      } catch {
        if (!stopped) setError('材料列表暂不可用。');
      }
      if (!stopped) timer = setTimeout(() => void poll(), 1000);
    }
    void poll();
    return () => {
      stopped = true;
      alive.current = false;
      clearTimeout(timer);
    };
  }, [scope, available]);
  async function perform(call: () => Promise<MaterialResponse>) {
    if (lock.current) return null;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const r = await call();
      if (!alive.current) return null;
      if (!r.ok) {
        setError(r.message);
        return null;
      }
      setItems(r.materials);
      return r;
    } catch {
      if (alive.current) setError('操作结果尚未确认，请保留输入并重试原提交。');
      return null;
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const command = (request: Omit<MaterialRequest, 'protocol_version' | 'scope'>) =>
    perform(() =>
      window.caselite.material({ protocol_version: 1, scope, ...request } as MaterialRequest),
    );
  const signature = JSON.stringify({
    scope,
    selected,
    versions: items
      .filter((item) => item.id in selected)
      .map((item) => [item.id, item.derivation_id, item.status]),
  });
  const selection = useMemo(
    () =>
      Object.entries(selected).map(([id, range]) => ({
        source_id: id,
        pages: pageRange(range, items.find((item) => item.id === id)?.page_count ?? 0),
      })),
    [items, selected],
  );
  return {
    available,
    items,
    error,
    busy,
    staged,
    reading,
    selected,
    signature,
    canNewHome: scope === 'home',
    clearReading: () => setReading(null),
    async add(file?: File) {
      if (staged) {
        setError('请先保存或取消当前暂存文件。');
        return;
      }
      const r = await perform(() =>
        file ? window.caselite.dropPdf(file, scope) : window.caselite.pickPdf(scope),
      );
      if (r?.staged) setStaged(r.staged);
    },
    errorMessage: setError,
    async commit() {
      if (!staged) return;
      const r = await command({ operation: 'commit', token: staged.token } as Omit<
        MaterialRequest,
        'scope' | 'protocol_version'
      >);
      if (r) {
        setStaged(null);
        window.dispatchEvent(new Event('caselite:material-task-saved'));
      }
    },
    async discard() {
      if (!staged) return;
      const r = await command({ operation: 'discard', token: staged.token } as Omit<
        MaterialRequest,
        'scope' | 'protocol_version'
      >);
      if (r) setStaged(null);
    },
    async read(item: Material) {
      const r = await command({ operation: 'read', source_id: item.id } as Omit<
        MaterialRequest,
        'scope' | 'protocol_version'
      >);
      if (r?.data) setReading({ id: item.id, name: item.name, bytes: r.data });
    },
    async process(item: Material, ocr: boolean) {
      await command({
        operation: 'process',
        source_id: item.id,
        ocr,
        force: item.status === 'ready',
      } as Omit<MaterialRequest, 'scope' | 'protocol_version'>);
    },
    async cancel(item: Material) {
      await command({ operation: 'cancel', source_id: item.id } as Omit<
        MaterialRequest,
        'scope' | 'protocol_version'
      >);
    },
    async restore(item: Material) {
      const stagedResult = await perform(() => window.caselite.pickPdf(scope));
      if (stagedResult?.staged)
        await command({
          operation: 'restore',
          source_id: item.id,
          token: stagedResult.staged.token,
        } as Omit<MaterialRequest, 'scope' | 'protocol_version'>);
    },
    async newHome() {
      const r = await command({ operation: 'new_home' });
      if (r) {
        setSelected({});
        setReading(null);
      }
    },
    select(id: string, value: boolean) {
      setSelected((old) => {
        const next = { ...old };
        if (value) next[id] = '';
        else delete next[id];
        return next;
      });
    },
    range(id: string, value: string) {
      setSelected((old) => ({ ...old, [id]: value }));
    },
    async preview(
      instruction: string,
      model: AgentModel,
    ): Promise<MaterialPreview | null | undefined> {
      if (!selection.length) return undefined;
      if (selection.some((item) => !item.pages?.length)) {
        setError('页范围无效，请输入如 1-3,5。');
        return null;
      }
      const r = await command({
        operation: 'preview',
        instruction,
        model,
        selected: selection,
      } as Omit<MaterialRequest, 'scope' | 'protocol_version'>);
      return r?.preview ?? null;
    },
  };
}
export type MaterialController = ReturnType<typeof useMaterials>;
