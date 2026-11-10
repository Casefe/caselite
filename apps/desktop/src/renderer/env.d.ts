import type { CaseLitePreloadApi, LegalPreloadApi } from '../preload/caselite-api';
import type { AppearanceResponse } from '../preload/caselite-api';

declare global {
  interface Window {
    caselite: CaseLitePreloadApi;
    caseliteLegal: LegalPreloadApi;
    caseliteAppearance?: AppearanceResponse;
  }
}

export {};
