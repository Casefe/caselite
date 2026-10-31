import type { CaseLitePreloadApi } from '../preload/caselite-api';

declare global {
  interface Window {
    caselite: CaseLitePreloadApi;
  }
}

export {};
