import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Disable right-click context menu, long-press callouts, and selection on all devices
if (typeof window !== 'undefined') {
  window.addEventListener('contextmenu', (e) => e.preventDefault(), {
    capture: true,
  });
  window.addEventListener('selectstart', (e) => e.preventDefault(), {
    capture: true,
  });
}

createRoot(document.getElementById('root')!).render(<App />);
