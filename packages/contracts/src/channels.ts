export const IPC_CHANNELS = {
  createMatter: 'caselite.command.create-matter.v1',
  createAnchor: 'caselite.command.create-anchor.v1',
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];
