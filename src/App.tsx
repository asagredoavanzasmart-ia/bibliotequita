/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// =============================================================================
// App.tsx — Componente raíz
// -----------------------------------------------------------------------------
// Decide qué se renderiza en pantalla completa: el Dashboard (catálogo) o el
// ReaderView (lector PDF/EPUB/externo). La navegación entre vistas se hace
// con un único estado local `activeBookId`, NO con rutas.
// El estado global de la biblioteca vive en LibraryProvider (Context API).
// =============================================================================

import { useState } from 'react';
import { LibraryProvider } from './hooks/useLibrary';
import { Dashboard } from './components/Dashboard';
import { ReaderView } from './components/ReaderView';

export default function App() {
  // Si hay un libro activo → se abre el lector; si no → catálogo.
  const [activeBookId, setActiveBookId] = useState<string | null>(null);

  return (
    <LibraryProvider>
      {activeBookId ? (
        <ReaderView bookId={activeBookId} onClose={() => setActiveBookId(null)} />
      ) : (
        <Dashboard onOpenBook={setActiveBookId} />
      )}
    </LibraryProvider>
  );
}
