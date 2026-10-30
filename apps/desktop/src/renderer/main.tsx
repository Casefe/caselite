import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

const container = document.getElementById('root');
if (!container) throw new Error('CaseLite 页面缺少挂载节点。');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
