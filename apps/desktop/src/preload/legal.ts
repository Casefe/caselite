import { contextBridge, ipcRenderer } from 'electron';
import { createLegalPreloadApi } from './legal-api';

contextBridge.exposeInMainWorld(
  'caseliteLegal',
  createLegalPreloadApi((channel, input) => ipcRenderer.invoke(channel, input)),
);
