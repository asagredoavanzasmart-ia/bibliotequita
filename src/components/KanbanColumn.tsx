// =============================================================================
// KanbanColumn.tsx — Una columna del Tablero Kanban: cabecera + lista con
// scroll vertical propio + pie "Añadir tarjeta". Zona de soltar del drag &
// drop de escritorio (en móvil el menú ⋯ de cada tarjeta es el camino).
// =============================================================================

import { useState } from 'react';
import { Plus } from 'lucide-react';
import type { BookItem, KanbanStatus, TagData } from '../types';
import { cn } from '../lib/utils';
import { KanbanCard } from './KanbanCard';
import type { KanbanCardSettings } from './KanbanBoard';

interface KanbanColumnProps {
  column: { id: KanbanStatus; title: string; accent: string };
  items: BookItem[];
  settings: KanbanCardSettings;
  tags: TagData[];
  onOpenBook: (id: string) => void;
  onMove: (item: BookItem, dest: KanbanStatus) => void;
  onRemove: (item: BookItem) => void;
  onAdd: () => void;
  draggedId: string | null;
  setDraggedId: (id: string | null) => void;
  onDropColumn: () => void;
}

export function KanbanColumn({
  column, items, settings, tags, onOpenBook, onMove, onRemove, onAdd, draggedId, setDraggedId, onDropColumn,
}: KanbanColumnProps) {
  // Contador en vez de un booleano simple: dragenter/dragleave burbujean por
  // cada hijo al pasar el cursor sobre las tarjetas, y un booleano ingenuo
  // parpadea el resaltado de la columna en cada hijo cruzado.
  const [dragDepth, setDragDepth] = useState(0);
  const isDragOver = dragDepth > 0;

  return (
    <div
      className={cn(
        'w-[85vw] max-w-sm shrink-0 snap-center lg:w-auto lg:max-w-none',
        'flex flex-col min-h-0 rounded-2xl bg-[var(--bg-card)]/60 border transition-colors',
        isDragOver ? 'border-[var(--primary)]/60 bg-[var(--primary)]/5' : 'border-[var(--border-card)]'
      )}
      onDragOver={(e) => { e.preventDefault(); }}
      onDragEnter={(e) => { e.preventDefault(); setDragDepth((d) => d + 1); }}
      onDragLeave={() => setDragDepth((d) => Math.max(0, d - 1))}
      onDrop={(e) => { e.preventDefault(); setDragDepth(0); onDropColumn(); }}
    >
      {/* Cabecera fija */}
      <div className="flex items-center gap-2 px-3 py-2.5 shrink-0">
        <span className={cn('w-2.5 h-2.5 rounded-full shrink-0', column.accent)} />
        <h3 className="text-sm font-bold text-[var(--text-main)] flex-1 truncate">{column.title}</h3>
        <span className="text-xs font-bold text-[var(--text-muted)] shrink-0">{items.length}</span>
      </div>

      {/* Lista con scroll vertical propio (spec §3B) */}
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-2 pb-1 space-y-2">
        {items.map((item) => (
          <KanbanCard
            key={item.id}
            item={item}
            settings={settings}
            tags={tags}
            currentCol={column.id}
            onOpen={() => onOpenBook(item.id)}
            onMove={(dest) => onMove(item, dest)}
            onRemove={() => onRemove(item)}
            onDragStart={() => setDraggedId(item.id)}
            onDragEnd={() => setDraggedId(null)}
            isDragged={draggedId === item.id}
          />
        ))}
        {items.length === 0 && (
          <p className="text-xs text-[var(--text-muted)] text-center py-6">Sin tarjetas</p>
        )}
      </div>

      {/* Pie fijo */}
      <button
        onClick={onAdd}
        className="shrink-0 flex items-center gap-1.5 px-3 py-2.5 text-xs font-bold text-[var(--text-muted)] hover:text-[var(--primary)] transition-colors"
      >
        <Plus className="w-4 h-4" /> Añadir tarjeta
      </button>
    </div>
  );
}
