// =============================================================================
// BookmarksMenu.tsx — Botón Bookmark del ReaderView (multi-marcador)
// -----------------------------------------------------------------------------
// Comportamiento:
//   - Botón con icono Bookmark en el header del lector.
//   - Click → despliega hacia abajo un dropdown con:
//       · Lista de marcadores existentes (click → navega; basurita → borra).
//       · Botón "+ Añadir marcador en pág. N" → muestra el mini-modal de nombre.
//   - Mini-modal de nombre:
//       · Input con placeholder "Marcador Pág. N".
//       · Si se deja vacío al guardar, se usa ese mismo valor por defecto.
//
// La lista se persiste por documento en Supabase, vía bookmarks.ts.
// =============================================================================

import { useEffect, useRef, useState } from 'react';
import { Bookmark, Plus, Trash2, X, Check } from 'lucide-react';
import { cn } from '../lib/utils';
import {
  Bookmark as BookmarkData,
  loadBookmarks,
  addBookmark,
  removeBookmark,
  defaultBookmarkName,
  defaultBookmarkNameFromLabel,
} from '../lib/bookmarks';

interface Props {
  documentId: string;
  currentPage: number | string;
  onNavigate: (page: number | string) => void;
  // EPUB no tiene número de página: el marcador se ancla a la posición visible
  // (CFI) y se etiqueta con el texto de esa posición, sin mencionar página.
  isEpub?: boolean;
  // Devuelve el ancla (CFI + etiqueta) de la posición actualmente visible.
  getEpubAnchor?: () => Promise<{ cfi: string; label: string } | null>;
}

export function BookmarksMenu({ documentId, currentPage, onNavigate, isEpub = false, getEpubAnchor }: Props) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<BookmarkData[]>([]);
  const [namingPage, setNamingPage] = useState<number | string | null>(null);
  const [draftName, setDraftName] = useState('');
  // En EPUB guardamos el ancla (CFI + etiqueta) capturada al iniciar el alta.
  const [epubAnchor, setEpubAnchor] = useState<{ cfi: string; label: string } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadBookmarks(documentId).then(setList);
  }, [documentId]);

  // Cerrar al hacer click fuera.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setNamingPage(null);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const startAdd = async () => {
    setDraftName('');
    if (isEpub && getEpubAnchor) {
      const anchor = await getEpubAnchor();
      if (!anchor) return; // sin posición visible aún: no abrir el alta
      setEpubAnchor(anchor);
      setNamingPage(anchor.cfi); // se usa solo como bandera de "alta abierta"
    } else {
      setEpubAnchor(null);
      setNamingPage(currentPage);
    }
  };

  const confirmAdd = () => {
    if (namingPage === null) return;
    if (isEpub && epubAnchor) {
      // EPUB: anclar al CFI capturado, con el fragmento de texto como etiqueta.
      addBookmark(documentId, epubAnchor.cfi, draftName, epubAnchor.label).then(setList);
    } else {
      addBookmark(documentId, namingPage, draftName).then(setList);
    }
    setNamingPage(null);
    setDraftName('');
    setEpubAnchor(null);
  };

  const cancelAdd = () => {
    setNamingPage(null);
    setDraftName('');
    setEpubAnchor(null);
  };

  const handleDelete = (id: string) => {
    removeBookmark(documentId, id).then(setList);
  };

  // En PDF se evita duplicar el marcador de la página actual. En EPUB siempre se
  // permite añadir (cada posición visible es distinta y no hay "página actual").
  const hasOnCurrent = !isEpub && list.some(b => String(b.page) === String(currentPage));

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className={cn(
          'p-2 rounded-lg flex items-center justify-center transition-colors shadow-sm border shrink-0',
          open || list.length > 0
            ? 'bg-amber-500 text-white border-amber-500'
            : 'bg-white text-slate-600 hover:text-amber-500 border-slate-200 hover:border-amber-200',
        )}
        title={list.length > 0 ? `${list.length} marcador(es)` : 'Marcadores'}
      >
        <Bookmark className={cn('w-4 h-4 sm:w-5 sm:h-5', (open || list.length > 0) && 'fill-current')} />
        {list.length > 0 && (
          <span className="ml-1 text-[10px] font-bold leading-none tabular-nums">{list.length}</span>
        )}
      </button>

      {/* Backdrop de fondo difuminado en pantallas móviles para facilitar el cierre y centrar la atención */}
      {open && (
        <div
          className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-40 sm:hidden animate-in fade-in duration-200"
          onClick={() => {
            setOpen(false);
            setNamingPage(null);
          }}
        />
      )}

      {open && (
        <div
          className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100%-2rem)] max-w-sm sm:absolute sm:top-full sm:left-auto sm:right-0 sm:translate-x-0 sm:translate-y-0 sm:mt-2 sm:w-72 bg-white rounded-xl shadow-2xl border border-slate-200 z-50 overflow-hidden animate-in fade-in zoom-in-95 sm:zoom-in-100 sm:slide-in-from-top-2 duration-150"
          onMouseDown={e => e.stopPropagation()}
        >
          <div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Marcadores</span>
            {!isEpub && <span className="text-[10px] text-slate-400">Pág. actual: {currentPage}</span>}
          </div>

          <div className="max-h-64 overflow-y-auto">
            {list.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-slate-400 italic">
                Aún no hay marcadores en este documento.
              </div>
            ) : (
              list.map(b => (
                <div
                  key={b.id}
                  className="group flex items-center justify-between gap-2 px-3 py-2 hover:bg-slate-50 transition-colors"
                >
                  <button
                    onClick={() => {
                      onNavigate(b.page);
                      setOpen(false);
                    }}
                    className="flex-1 text-left min-w-0"
                  >
                    <div className="text-sm font-medium text-slate-700 truncate">{b.name}</div>
                    {isEpub ? (
                      // EPUB: sin número de página; muestra el fragmento anclado si
                      // el nombre fue personalizado (para no repetirlo).
                      b.label && b.name !== defaultBookmarkNameFromLabel(b.label) && (
                        <div className="text-[10px] text-slate-400 truncate italic">{defaultBookmarkNameFromLabel(b.label)}</div>
                      )
                    ) : (
                      <div className="text-[10px] text-slate-400">Pág. {b.page}</div>
                    )}
                  </button>
                  <button
                    onClick={() => handleDelete(b.id)}
                    className="p-1 text-slate-400 hover:text-rose-500 transition-colors shrink-0"
                    title="Eliminar marcador"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>

          {namingPage !== null ? (
            <div className="border-t border-slate-100 bg-slate-50 p-3">
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">
                {isEpub ? 'Nuevo marcador (posición actual)' : `Nuevo marcador (pág. ${namingPage})`}
              </div>
              <input
                autoFocus
                type="text"
                name="bookmark-title-input"
                id="bookmark-title-input"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="sentences"
                spellCheck={false}
                value={draftName}
                onChange={e => setDraftName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') confirmAdd();
                  if (e.key === 'Escape') cancelAdd();
                }}
                placeholder={isEpub ? defaultBookmarkNameFromLabel(epubAnchor?.label) : defaultBookmarkName(namingPage)}
                className="w-full text-sm px-3 py-2 rounded-lg border border-slate-200 bg-white outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent"
              />
              <div className="flex justify-end gap-2 mt-2">
                <button
                  onClick={cancelAdd}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold text-slate-500 hover:bg-slate-200 transition-colors"
                >
                  <X className="w-3.5 h-3.5" /> Cancelar
                </button>
                <button
                  onClick={confirmAdd}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-500 text-white hover:bg-amber-600 transition-colors"
                >
                  <Check className="w-3.5 h-3.5" /> Guardar
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={startAdd}
              disabled={hasOnCurrent}
              className={cn(
                'w-full border-t border-slate-100 flex items-center justify-center gap-2 px-3 py-2.5 text-sm font-bold transition-colors',
                hasOnCurrent
                  ? 'text-slate-300 cursor-not-allowed bg-slate-50'
                  : 'text-amber-600 hover:bg-amber-50',
              )}
              title={hasOnCurrent ? 'Ya hay un marcador en esta página' : undefined}
            >
              <Plus className="w-4 h-4" />
              {isEpub ? 'Añadir marcador aquí' : `Añadir marcador en pág. ${currentPage}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
