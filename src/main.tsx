import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { startApp } from './bootstrap';
import App from './ui/App';
import ErrorBoundary from './ui/ErrorBoundary';
import './styles.css';

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
