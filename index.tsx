import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { initMonitoring } from './lib/monitoring';
// SQEM-542 — the UI font, self-hosted (weight axis only; unicode-range keeps unused scripts unloaded).
import '@fontsource-variable/figtree/wght.css';
import '@fontsource-variable/bricolage-grotesque/wght.css';

initMonitoring();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
