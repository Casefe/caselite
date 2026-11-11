import type {
  Material,
  MaterialPreview,
  MaterialScope,
  TextPage,
  MaterialBatch,
  CreationDraftRecord,
} from '@caselite/contracts';
export interface CreationDraftStorePort {
  creationDraft(id: string): CreationDraftRecord | undefined;
  pendingCreationDraft(): CreationDraftRecord | undefined;
  putCreationDraft(draft: CreationDraftRecord, file?: MaterialStage): void;
  bindCreationDraft(draft: CreationDraftRecord, taskId: string): void;
}
export type MaterialStage = {
  token: string;
  scope: MaterialScope;
  name: string;
  bytes: number;
  sha256: string;
  state: 'staged' | 'committed' | 'cancelled';
  task_id?: string;
  restored_source_id?: string;
  restore_source_id?: string;
  batch_id?: string;
  creation_draft_id?: string;
};
export interface MaterialStorePort extends Partial<CreationDraftStorePort> {
  activeBatch?(scope: MaterialScope): MaterialBatch | undefined;
  stage(token: string): MaterialStage | undefined;
  pending(scope: MaterialScope): MaterialStage | undefined;
  putStage(stage: MaterialStage): void;
  task(scope: MaterialScope): string | undefined;
  home(id: string): void;
  newHome(): void;
  get(id: string): Material | undefined;
  fixed?(id: string, derivation: string): Material | undefined;
  list(scope: MaterialScope): Material[];
  projectSources(projectId: string): Material[] | undefined;
  commit(stage: MaterialStage, taskId: string, pageCount: number): Material;
  begin(source: string, id: string, config: string, pages: TextPage[]): void;
  checkpoint(source: string, id: string, status: Material['status'], pages: TextPage[]): boolean;
  configuration(id: string): string | undefined;
  recover(): void;
  putPreview(scope: MaterialScope, preview: MaterialPreview): void;
  preview(id: string, scope: MaterialScope): MaterialPreview | undefined;
}
export interface MaterialFilesPort {
  stagePhoto?(
    bytes: Uint8Array,
    scope: MaterialScope,
    token: string,
  ): Promise<MaterialStage & { newly_created?: boolean }>;
  stage(
    path: string,
    scope: MaterialScope,
    token?: string,
    expected?: MaterialFileIdentity,
  ): Promise<MaterialStage>;
  placedOrStaged(token: string, sha: string): Promise<Uint8Array>;
  place(token: string, sha: string): Promise<void>;
  read(id: string, sha: string): Promise<Uint8Array>;
  discard(token: string): Promise<void>;
  restore(token: string, id: string, sha: string): Promise<void>;
}
export type MaterialFileIdentity = { dev: number; ino: number; size: number; mtimeMs: number };
export interface PdfProcessorPort {
  inspect(bytes: Uint8Array): Promise<number>;
  process(
    bytes: Uint8Array,
    input: {
      ocr: boolean;
      previous: TextPage[];
      signal: AbortSignal;
      onPage(page: TextPage): void;
    },
  ): Promise<void>;
  render?(bytes: Uint8Array, pages: number[], signal?: AbortSignal): Promise<string[]>;
  configuration: string;
}
