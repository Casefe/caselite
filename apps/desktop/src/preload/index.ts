import { contextBridge, ipcRenderer, webUtils } from 'electron';

import { createCaseLitePreloadApi } from './caselite-api';
import { APPEARANCE_INITIAL_CHANNEL } from '@caselite/contracts';
import { readInitialAppearance } from './appearance-initial';

contextBridge.exposeInMainWorld(
  'caseliteAppearance',
  readInitialAppearance(() => ipcRenderer.sendSync(APPEARANCE_INITIAL_CHANNEL)),
);

contextBridge.exposeInMainWorld(
  'caselite',
  createCaseLitePreloadApi(
    (channel, payload) => ipcRenderer.invoke(channel, payload),
    (file) => webUtils.getPathForFile(file),
  ),
);
