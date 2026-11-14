import type {
  CapturePhase,
  FolderConfiguration,
  FolderEntry,
  FolderRequest,
  FolderResponse,
  FolderRoot,
  FolderScope,
  PersonalMaterial,
  PersonalMaterialHeader,
  TextPage,
} from '@caselite/contracts';

// 只供Main实例化的内部编排/宿主Port使用，不能放进公开DTO或Domain。
export type FolderCaller = {
  workspace: string;
  session: string;
  epoch: number;
  window_id: number;
  assertCurrent(): boolean;
};
export type FolderGuard = () => void;
export type PrivateRootLocator = {
  private_path: string;
  root_identity: string;
  ancestor_chain: string;
  profile_identity: string;
  locator_version: 1;
};
export type FolderDefault = FolderConfiguration & { locator: PrivateRootLocator };
export type FolderProject = {
  root_binding_id: string;
  relative_directory: string;
  directory_identity: string;
  revision: number;
};
export type FolderConfigurationOperation = 'set_default' | 'bind_project';
export interface FolderConfigurationStorePort {
  readonly workspace: string;
  currentDefault(): FolderDefault | undefined;
  project(projectId: string): FolderProject | undefined;
  queryConfiguration(input: {
    operation: FolderConfigurationOperation;
    request_id: string;
    scope: FolderScope;
    request_digest?: string;
  }): FolderResponse | undefined;
  recordConfigurationResult(input: {
    operation: FolderConfigurationOperation;
    request_id: string;
    scope: FolderScope;
    request_digest: string;
    result: FolderResponse;
  }): FolderResponse;
  setDefault(input: {
    request_id: string;
    request_digest: string;
    expected_revision: number;
    display_name: string;
    locator: PrivateRootLocator;
    reselect: boolean;
  }): FolderResponse;
  bindProject(input: {
    request_id: string;
    request_digest: string;
    expected_revision: number;
    project_id: string;
    root_binding_id: string;
    relative_directory: string;
    directory_identity: string;
  }): FolderResponse;
}
export type FolderCaptureTarget = {
  binding_id: string;
  relative_name: string;
  entry_hint: string;
  mapping_revision: number;
  scope: FolderScope;
  default_revision: number;
  project_revision: number | null;
};
export type FolderSnapshot = {
  bytes: Uint8Array;
  name: string;
  kind: 'pdf' | 'docx' | 'image';
  sha256: string;
};
export interface FolderRootsPort {
  isCurrent(caller: FolderCaller): boolean;
  select(caller: FolderCaller, guard: FolderGuard): Promise<PrivateRootLocator | null>;
  validate(caller: FolderCaller, locator: PrivateRootLocator, guard: FolderGuard): Promise<void>;
  selectProject(
    caller: FolderCaller,
    locator: PrivateRootLocator,
    guard: FolderGuard,
  ): Promise<{ relative_directory: string; directory_identity: string } | null>;
  issue(
    caller: FolderCaller,
    locator: PrivateRootLocator,
    scope: FolderScope,
    project: FolderProject | undefined,
    guard: FolderGuard,
  ): Promise<FolderRoot>;
  list(
    caller: FolderCaller,
    request: Extract<FolderRequest, { operation: 'list_directory' }>,
    guard: FolderGuard,
  ): Promise<{ entries: FolderEntry[]; next_cursor: string | null }>;
  target(
    caller: FolderCaller,
    scope: FolderScope,
    root: string,
    entry: string,
    guard: FolderGuard,
  ): FolderCaptureTarget;
  snapshot(
    caller: FolderCaller,
    scope: FolderScope,
    root: string,
    entry: string,
    expectedHint: string,
    guard: FolderGuard,
  ): Promise<FolderSnapshot>;
  revokeRoots(): void;
  revokeCaller(caller: FolderCaller): void;
  savedHandle(caller: FolderCaller, scope: FolderScope, sourceId: string): string;
  savedSource(caller: FolderCaller, scope: FolderScope, handle: string): string;
}
export type PersonalCaptureJournal = {
  kind: 'personal_capture_v2';
  stage_schema_version: 2;
  request_id: string;
  wire_digest: string;
  owner: { kind: 'personal'; workspace_id: string };
  target: FolderCaptureTarget & { mapping_id: string };
  capture_token: string;
  planned_source_id: string;
  planned_derivation_id: string;
  phase: CapturePhase;
  interrupted: boolean;
  needs_reselect: boolean;
  snapshot?: { name: string; kind: 'pdf' | 'docx' | 'image'; sha256: string; bytes: number };
  result?: { source_id: string; asset_version_id: string; sha256: string };
  failure_code?: string;
  reuse_source_id?: string;
};
export interface PersonalMaterialStorePort {
  readonly workspace: string;
  mappingRevision(bindingId: string, relativeName: string): number;
  currentSource(target: FolderCaptureTarget): PersonalMaterial | undefined;
  read(requestId: string): PersonalCaptureJournal | undefined;
  pending(scope: FolderScope): Array<{
    request_id: string;
    phase: CapturePhase;
    needs_reselect: boolean;
    relative_label: string;
  }>;
  reserve(
    requestId: string,
    target: FolderCaptureTarget,
    wireDigest: string,
  ): PersonalCaptureJournal;
  advance(
    requestId: string,
    previous: CapturePhase,
    update: Partial<
      Pick<
        PersonalCaptureJournal,
        'phase' | 'snapshot' | 'interrupted' | 'needs_reselect' | 'reuse_source_id'
      >
    >,
  ): PersonalCaptureJournal;
  commit(
    requestId: string,
    pageCount: number,
    configuration: string,
    pages: TextPage[],
  ): { journal: PersonalCaptureJournal; source: PersonalMaterial };
  interrupt(requestId: string, code: string): void;
  cancel(requestId: string): PersonalCaptureJournal | undefined;
  source(sourceId: string): PersonalMaterial | undefined;
  saved(
    scope: FolderScope,
  ): Array<{ mapping_id: string; source: PersonalMaterialHeader; relative_label: string }>;
  assertSourceScope(scope: FolderScope, sourceId: string, mappingId?: string): void;
}
export interface PersonalMaterialFilesPort {
  stageFrozen(
    bytes: Uint8Array,
    name: string,
    token: string,
    sha256: string,
    guard: FolderGuard,
  ): Promise<void>;
  placedOrStaged(token: string, sha256: string, guard?: FolderGuard): Promise<Uint8Array>;
  place(token: string, sha256: string, guard?: FolderGuard): Promise<void>;
  read(id: string, sha256: string, guard?: FolderGuard): Promise<Uint8Array>;
}
