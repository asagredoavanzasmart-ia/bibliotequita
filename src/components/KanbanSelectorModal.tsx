// =============================================================================
// KanbanSelectorModal.tsx — Modal buscador para añadir un recurso existente a
// una columna del Tablero Kanban (spec §4). Filtro reactivo por título/autor,
// insensible a mayúsculas y tildes.
// =============================================================================

import { useState, useEffect, useMemo } from 'react';
import { X, Search, BookOpen } from 'lucide-react';
import type { BookItem, KanbanStatus } from '../types';
import { cn } from '../lib/utils';

interface KanbanSelectorModalProps {
  targetCol: KanbanStatus;
  columnTitle: string;
  items: BookItem[];
  columnOf: (item: BookItem) => KanbanStatus | null;
  columnLabel: (id: KanbanStatus) => string;
  onPick: (item: BookItem) => void;
  onClose: () => void;
}

function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function KanbanSelectorModal({ targetCol, columnTitle, items, columnOf, columnLabel, onPick, onClose }: KanbanSelectorModalProps) {
  const [query, setQuery] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const results = useMemo(() => {
    const available = items.filter((i) => !i.deletedAt);
    const q = normalize(query.trim());
    if (!q) {
      return [...available].sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0)).slice(0, 50);
    }
    return available.filter((i) => normalize(i.title).includes(q) || normalize(i.author ?? '').includes(q)).slice(0, 100);
  }, [items, query]);

  return (
    <div className="fixed inset-0 z-[100] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150" onClick={onClose}>
      <div
        className="bg-[var(--bg-card)] backdrop-blur-xl rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col border border-[var(--border-card)] animate-in zoom-in-95 duration-200 max-h-[80vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-[var(--border-card)] flex items-center justify-between gap-2 shrink-0">
          <h3 className="font-bold text-[var(--text-main)] text-sm truncate">Añadir a «{columnTitle}»</h3>
          <button onClick={onClose} className="p-1 text-[var(--text-muted)] hover:text-[var(--text-main)] rounded-lg shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-3 border-b border-[var(--border-card)] shrink-0">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por título o autor…"
              className="w-full pl-9 pr-3 py-2 text-sm bg-[var(--bg-app)] border border-[var(--border-card)] rounded-xl focus:outline-none focus:ring-1 focus:ring-[var(--primary)] text-[var(--text-main)]"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-2">
          {results.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)] text-center py-10">Sin resultados.</p>
          ) : (
            results.map((item) => {
              const existingCol = columnOf(item);
              return (
                <button
                  key={item.id}
                  onClick={() => onPick(item)}
                  className={cn(
                    'w-full flex items-center gap-3 p-2 rounded-xl text-left transition-colors hover:bg-[var(--bg-app)]',
                    existingCol !== null && existingCol !== targetCol && 'opacity-60'
                  )}
                >
                  {item.thumbnailUrl ? (
                    <img src={item.thumbnailUrl} alt="" className="w-9 h-12 rounded-md object-cover shrink-0 border border-[var(--border-card)]" />
                  ) : (
                    <div className="w-9 h-12 rounded-md bg-[var(--primary)]/10 flex items-center justify-center shrink-0">
                      <BookOpen className="w-4 h-4 text-[var(--primary)]" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-[var(--text-main)] truncate">{item.title}</p>
                    {item.author && <p className="text-[10px] text-[var(--text-muted)] truncate">{item.author}</p>}
                    {existingCol !== null && existingCol !== targetCol && (
                      <p className="text-[9px] font-bold text-amber-600 mt-0.5">Ya en: {columnLabel(existingCol)}</p>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
