import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { bootstrap } from './bootstrap';
import App from './ui/App';
import './styles.css';

// Apply the theme and close stale sessions before the first paint of data screens.
void bootstrap().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
