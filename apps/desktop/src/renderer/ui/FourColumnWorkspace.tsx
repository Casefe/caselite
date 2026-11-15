import { createContext, useContext, useLayoutEffect, useRef, useMemo, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export type WorkspaceCreateKind = 'task' | 'project' | 'document' | 'contact' | 'finance';
export type WorkspacePageActions = {
  create?: { kind: WorkspaceCreateKind; run(): void; disabled?: boolean; reason?: string };
  export?: { run(): void; disabled?: boolean; reason?: string };
};
export const FourColumnWorkspace = createContext<{
  request?: { kind: WorkspaceCreateKind; id: number };
  consumeRequest?(id: number): void;
  directory: HTMLElement | null;
  directoryOpen: boolean;
  toggleDirectory(): void;
  registerActions(owner: symbol, actions: WorkspacePageActions | null): void;
  actions: WorkspacePageActions;
} | null>(null);
export function useFourColumnWorkspace() {
  return useContext(FourColumnWorkspace);
}

// 收缩只隐藏挂点，不卸载目录；筛选、滚动及未完成输入仍归原消费者。
export function WorkspaceDirectory({
  children,
  enabled = true,
}: {
  children: ReactNode;
  enabled?: boolean;
}) {
  const shell = useFourColumnWorkspace();
  if (!enabled) return <>{children}</>;
  return shell?.directory ? createPortal(children, shell.directory) : <>{!shell && children}</>;
}
export function useWorkspacePageActions(actions: WorkspacePageActions) {
  const shell = useFourColumnWorkspace();
  const register = shell?.registerActions;
  const handled = useRef<number | null>(null);
  const owner = useRef(Symbol('workspace-page-actions'));
  const latest = useRef(actions);
  useLayoutEffect(() => {
    latest.current = actions;
  });
  const createKind = actions.create?.kind;
  const createDisabled = actions.create?.disabled;
  const createReason = actions.create?.reason;
  const hasExport = Boolean(actions.export);
  const exportDisabled = actions.export?.disabled;
  const exportReason = actions.export?.reason;
  const request = shell?.request;
  const consume = shell?.consumeRequest;
  useLayoutEffect(() => {
    if (
      request &&
      handled.current !== request.id &&
      request.kind === createKind &&
      !createDisabled
    ) {
      handled.current = request.id;
      consume?.(request.id);
      latest.current.create?.run();
    }
  }, [request, consume, createKind, createDisabled]);
  const registered = useMemo<WorkspacePageActions>(
    () => ({
      create: createKind
        ? {
            kind: createKind,
            disabled: createDisabled,
            reason: createReason,
            run: () => latest.current.create?.run(),
          }
        : undefined,
      export: hasExport
        ? {
            disabled: exportDisabled,
            reason: exportReason,
            run: () => latest.current.export?.run(),
          }
        : undefined,
    }),
    [createKind, createDisabled, createReason, hasExport, exportDisabled, exportReason],
  );
  useLayoutEffect(() => {
    const identity = owner.current;
    register?.(identity, registered);
    return () => register?.(identity, null);
  }, [register, registered]);
}
