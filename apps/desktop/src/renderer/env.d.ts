import type { CaseLitePreloadApi, LegalPreloadApi } from '../preload/caselite-api';

declare global {
  interface Window {
    caselite: CaseLitePreloadApi;
    caseliteLegal: LegalPreloadApi;
  }
}

export {};
