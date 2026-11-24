import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';

const ArchitecturalStudioPage = lazy(() => import('./architect/ArchitecturalStudioPage'));

function isArchitecturalStudioRoute(): boolean {
  const path = window.location.pathname.replace(/\/+$/, '').toLowerCase();
  const q = new URLSearchParams(window.location.search);
  return path === '/mimari' || path === '/mimar' || q.get('mod') === 'mimari';
}

const isArchRoute = isArchitecturalStudioRoute();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isArchRoute ? (
      <Suspense
        fallback={
          <div className="h-[100dvh] w-full flex items-center justify-center bg-[#f5f4f0] text-stone-800 text-xs font-mono">
            MekanAR Mimari 3B Stüdyo yükleniyor...
          </div>
        }
      >
        <ArchitecturalStudioPage />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>
);
