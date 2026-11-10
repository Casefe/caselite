import { mountLegalConsent } from './legal-consent-ui';
import { applyAppearanceTheme, readAppearanceSeed } from './ui/appearance-theme';
applyAppearanceTheme(readAppearanceSeed().theme);
mountLegalConsent(document, window.caseliteLegal);
