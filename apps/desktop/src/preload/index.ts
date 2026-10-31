import { contextBridge, ipcRenderer } from 'electron';

import { createCaseLitePreloadApi } from './caselite-api';

contextBridge.exposeInMainWorld(
  'caselite',
  createCaseLitePreloadApi((channel, payload) => ipcRenderer.invoke(channel, payload)),
);
