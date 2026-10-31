import {
  createAnchorResultSchema,
  createMatterResultSchema,
  offlineProbeResultSchema,
  IPC_CHANNELS,
  type CreateAnchorRequest,
  type CreateAnchorResult,
  type CreateMatterRequest,
  type CreateMatterResult,
  type OfflineProbeRequest,
  type OfflineProbeResult,
} from '@caselite/contracts';

export type IpcInvoke = (channel: string, payload: unknown) => Promise<unknown>;

export type CaseLitePreloadApi = {
  createAnchor(request: CreateAnchorRequest): Promise<CreateAnchorResult>;
  createMatter(request: CreateMatterRequest): Promise<CreateMatterResult>;
  offlineProbe(request: OfflineProbeRequest): Promise<OfflineProbeResult>;
};

export function createCaseLitePreloadApi(invoke: IpcInvoke): CaseLitePreloadApi {
  return {
    async createAnchor(request) {
      return createAnchorResultSchema.parse(await invoke(IPC_CHANNELS.createAnchor, request));
    },
    async createMatter(request) {
      return createMatterResultSchema.parse(await invoke(IPC_CHANNELS.createMatter, request));
    },
    async offlineProbe(request) {
      return offlineProbeResultSchema.parse(await invoke(IPC_CHANNELS.offlineProbe, request));
    },
  };
}
