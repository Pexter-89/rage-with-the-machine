import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { startApp } from './bootstrap';
import App from './ui/App';
import { installRouter } from './ui/router';
import ErrorBoundary from './ui/ErrorBoundary';
import './styles.css';

installRouter();
if (import.meta.env.VITE_ARTIFACT === '1') {
  // Claude artifact: load the data from the artifact's cloud db first (see src/artifact.tsx).
  void import('./artifact').then((m) => m.startArtifact());
} else {
  // Apply the theme and close stale sessions before the first paint of data screens,
  // but render regardless if that fails or takes more than a few seconds.
  void startApp(() => {
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </StrictMode>,
    );
  });
}
