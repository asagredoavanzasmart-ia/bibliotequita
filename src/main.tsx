import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {registerSW} from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';

// Service Worker de la PWA: precachea el shell de la app (abre sin conexión)
// y sirve los libros descargados desde el caché 'offline-books'.
// autoUpdate: al detectar una versión nueva se actualiza sola al recargar.
registerSW({immediate: true});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
