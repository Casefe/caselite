import { contextBridge, ipcRenderer, webUtils } from 'electron';

import { createCaseLitePreloadApi } from './caselite-api';

contextBridge.exposeInMainWorld(
  'caselite',
  createCaseLitePreloadApi(
    (channel, payload) => ipcRenderer.invoke(channel, payload),
    (file) => webUtils.getPathForFile(file),
  ),
);
