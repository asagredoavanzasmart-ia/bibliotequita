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
// La lista se persiste por documento en localStorage[`bookmarks-${docId}`].
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
} from '../lib/bookmarks';

interface Props {
  documentId: string;
  currentPage: number | string;
  onNavigate: (page: number | string) => void;
}

export function BookmarksMenu({ documentId, currentPage, onNavigate }: Props) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<BookmarkData[]>([]);
  const [namingPage, setNamingPage] = useState<number | string | null>(null);
  const [draftName, setDraftName] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setList(loadBookmarks(documentId));
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

  const startAdd = () => {
    setNamingPage(currentPage);
    setDraftName('');
  };

  const confirmAdd = () => {
    if (namingPage === null) return;
    const updated = addBookmark(documentId, namingPage, draftName);
    setList(updated);
    setNamingPage(null);
    setDraftName('');
  };

  const cancelAdd = () => {
    setNamingPage(null);
    setDraftName('');
  };

  const handleDelete = (id: string) => {
    setList(removeBookmark(documentId, id));
  };

  const hasOnCurrent = list.some(b => String(b.page) === String(currentPage));

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

      {open && (
        <div
          className="absolute right-0 top-full mt-2 w-72 bg-white rounded-xl shadow-2xl border border-slate-200 z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150"
          onMouseDown={e => e.stopPropagation()}
        >
          <div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Marcadores</span>
            <span className="text-[10px] text-slate-400">Pág. actual: {currentPage}</span>
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
                    <div className="text-[10px] text-slate-400">Pág. {b.page}</div>
                  </button>
                  <button
                    onClick={() => handleDelete(b.id)}
                    className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-rose-500 transition-all"
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
                Nuevo marcador (pág. {namingPage})
              </div>
              <input
                autoFocus
                type="text"
                value={draftName}
                onChange={e => setDraftName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') confirmAdd();
                  if (e.key === 'Escape') cancelAdd();
                }}
                placeholder={defaultBookmarkName(namingPage)}
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
              Añadir marcador en pág. {currentPage}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
