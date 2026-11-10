import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { LocalPreferencesProvider } from './shared/data/LocalPreferences';
import { applyAppearanceTheme, readAppearanceSeed } from './ui/appearance-theme';

applyAppearanceTheme(readAppearanceSeed().theme);

const container = document.getElementById('root');
if (!container) throw new Error('CaseLite 页面缺少挂载节点。');

createRoot(container).render(
  <StrictMode>
    <LocalPreferencesProvider>
      <App />
    </LocalPreferencesProvider>
  </StrictMode>,
);
