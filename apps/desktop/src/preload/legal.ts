import { contextBridge, ipcRenderer } from 'electron';
import { createLegalPreloadApi } from './legal-api';
import { APPEARANCE_INITIAL_CHANNEL } from '@caselite/contracts';
import { readInitialAppearance } from './appearance-initial';

contextBridge.exposeInMainWorld(
  'caseliteAppearance',
  readInitialAppearance(() => ipcRenderer.sendSync(APPEARANCE_INITIAL_CHANNEL)),
);

contextBridge.exposeInMainWorld(
  'caseliteLegal',
  createLegalPreloadApi((channel, input) => ipcRenderer.invoke(channel, input)),
);
