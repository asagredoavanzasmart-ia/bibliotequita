// =============================================================================
// KanbanCard.tsx — Tarjeta comprimida y responsiva del Tablero Kanban.
// Cada campo se muestra u oculta según los switches del panel de
// configuración (KanbanCardSettings). El menú ⋯ es el camino de mover de
// columna en móvil (sin drag táctil, por prohibición del proyecto); en PC
// la tarjeta completa es arrastrable.
// =============================================================================

import { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal, BookOpen, X, FileText } from 'lucide-react';
import type { BookItem, KanbanStatus, TagData } from '../types';
import { cn, colorSwatchProps } from '../lib/utils';
import { StarRating } from './StarRating';
import type { KanbanCardSettings } from './KanbanBoard';

const KANBAN_COLUMN_META: Record<KanbanStatus, { title: string; accent: string }> = {
  por_leer: { title: 'Por leer', accent: 'bg-sky-400' },
  pendiente: { title: 'Pendiente de iniciar', accent: 'bg-amber-400' },
  en_curso: { title: 'En curso', accent: 'bg-emerald-400' },
  detenido: { title: 'Detenido', accent: 'bg-rose-400' },
  leido: { title: 'Leído', accent: 'bg-violet-400' },
};
const KANBAN_ORDER: KanbanStatus[] = ['por_leer', 'pendiente', 'en_curso', 'detenido', 'leido'];

interface KanbanCardProps {
  item: BookItem;
  settings: KanbanCardSettings;
  tags: TagData[];
  currentCol: KanbanStatus;
  onOpen: () => void;
  onMove: (dest: KanbanStatus) => void;
  onRemove: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  isDragged: boolean;
}

export function KanbanCard({
  item, settings, tags, currentCol, onOpen, onMove, onRemove, onDragStart, onDragEnd, isDragged,
}: KanbanCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  // El menú se renderiza vía portal a document.body con posición fija
  // calculada desde el botón: la tarjeta vive dentro de la columna con
  // overflow-y-auto propio (spec §3B), y un menú absoluto normal se
  // recortaría contra ese borde en cuanto la tarjeta estuviera cerca del
  // final visible de la columna — justo donde más se necesita el menú
  // "Mover a" en móvil.
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const itemTags = settings.showTags ? (item.tags ?? []).map((id) => tags.find((t) => t.id === id)).filter((t): t is TagData => !!t) : [];
  const hasTags = itemTags.length > 0;
  const showFormatPill = settings.showFormat && item.type !== 'externa';
  const hasCover = settings.showCover && !!item.thumbnailUrl;
  const otherColumns = KANBAN_ORDER.filter((c) => c !== currentCol);
  const MENU_WIDTH = 208; // w-52

  const openMenu = () => {
    const rect = menuBtnRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Ancla bajo el botón; si no cabe a la derecha, se alinea al borde
    // derecho de la ventana (con margen). Si no cabe abajo, se abre hacia
    // arriba del botón en vez de salirse de la pantalla.
    const left = Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8);
    const estimatedHeight = 46 + (otherColumns.length + 1) * 32 + 40; // Abrir + Mover a + separadores + Quitar
    const opensUp = rect.bottom + estimatedHeight > window.innerHeight;
    const top = opensUp ? Math.max(8, rect.top - estimatedHeight) : rect.bottom + 4;
    setMenuPos({ top, left: Math.max(8, left) });
    setMenuOpen(true);
  };

  return (
    <div
      draggable
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; onDragStart(); }}
      onDragEnd={onDragEnd}
      className={cn(
        'bg-[var(--bg-card)] backdrop-blur-xl rounded-xl border border-[var(--border-card)] shadow-sm overflow-hidden',
        'transition-all duration-200 animate-in fade-in cursor-grab active:cursor-grabbing relative',
        isDragged && 'opacity-40'
      )}
    >
      {/* Menú ⋯: mover de columna con un toque (imprescindible en móvil).
          El botón vive en la tarjeta; el contenido del menú se porta a
          document.body (ver openMenu) para no recortarse contra el
          overflow-y-auto de la columna. */}
      <div className="absolute top-1.5 right-1.5 z-10">
        <button
          ref={menuBtnRef}
          onClick={(e) => { e.stopPropagation(); if (menuOpen) setMenuOpen(false); else openMenu(); }}
          onPointerDown={(e) => e.stopPropagation()}
          className="p-1 rounded-md bg-[var(--bg-app)]/80 text-[var(--text-muted)] hover:text-[var(--primary)] backdrop-blur-sm"
          title="Opciones"
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>
      </div>

      {menuOpen && menuPos && createPortal(
        <>
          <div className="fixed inset-0 z-[90]" onClick={() => setMenuOpen(false)} />
          <div
            className="fixed z-[91] w-52 bg-[var(--bg-card)] backdrop-blur-xl border border-[var(--border-card)] rounded-xl shadow-2xl p-1.5 flex flex-col gap-0.5 animate-in fade-in zoom-in-95 duration-150"
            style={{ top: menuPos.top, left: menuPos.left }}
          >
            <button
              onClick={() => { setMenuOpen(false); onOpen(); }}
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-[var(--text-main)] hover:bg-[var(--bg-app)] text-left"
            >
              <BookOpen className="w-3.5 h-3.5" /> Abrir
            </button>
            <div className="h-px bg-[var(--border-card)] my-1" />
            <span className="px-2.5 text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wide">Mover a</span>
            {otherColumns.map((col) => (
              <button
                key={col}
                onClick={() => { setMenuOpen(false); onMove(col); }}
                className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-[var(--text-main)] hover:bg-[var(--bg-app)] text-left"
              >
                <span className={cn('w-2 h-2 rounded-full shrink-0', KANBAN_COLUMN_META[col].accent)} />
                {KANBAN_COLUMN_META[col].title}
              </button>
            ))}
            <div className="h-px bg-[var(--border-card)] my-1" />
            <button
              onClick={() => { setMenuOpen(false); onRemove(); }}
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 text-left"
            >
              <X className="w-3.5 h-3.5" /> Quitar del tablero
            </button>
          </div>
        </>,
        document.body
      )}

      <div className={cn('flex', hasCover && settings.coverLarge ? 'flex-col' : 'flex-row gap-2.5 p-2.5')}>
        {hasCover && settings.coverLarge && (
          <img src={item.thumbnailUrl} alt="" className="w-full aspect-[3/2] object-cover" draggable={false} />
        )}
        {hasCover && !settings.coverLarge && (
          <img src={item.thumbnailUrl} alt="" className="w-10 h-14 rounded-md object-cover shrink-0 border border-[var(--border-card)]" draggable={false} />
        )}

        <div className={cn('min-w-0 flex-1 flex flex-col gap-1', hasCover && settings.coverLarge && 'p-2.5')}>
          <h4 onClick={onOpen} className="text-[13px] font-bold text-[var(--text-main)] leading-snug line-clamp-2 cursor-pointer hover:text-[var(--primary)] pr-5">
            {item.title}
          </h4>

          {(settings.showAuthor || settings.showYear) && (item.author || item.year) && (
            <p className="text-[11px] truncate">
              {settings.showAuthor && item.author && <span className="text-[var(--primary)] font-semibold">{item.author}</span>}
              {settings.showAuthor && item.author && settings.showYear && item.year && <span className="text-[var(--text-muted)]"> · </span>}
              {settings.showYear && item.year && <span className="text-[var(--text-muted)]">{item.year}</span>}
            </p>
          )}

          {/* Fila de metadatos: etiquetas a la izquierda, formato a la
              derecha — solo se renderiza si hay algo que mostrar en ella
              (nada de renglones vacíos reservando espacio). */}
          {(hasTags || showFormatPill) && (
            <div className="flex items-center justify-between gap-2">
              <div className="flex flex-wrap gap-1 min-w-0">
                {hasTags && itemTags.map((tag) => (
                  <span
                    key={tag.id}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-[var(--bg-app)] border border-[var(--border-card)] text-[9px] font-bold text-[var(--text-muted)]"
                  >
                    <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', colorSwatchProps(tag.color).className)} style={colorSwatchProps(tag.color).style} />
                    {tag.name}
                  </span>
                ))}
              </div>
              {showFormatPill && (
                <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase text-[var(--text-muted)] shrink-0">
                  <FileText className="w-3 h-3" /> {item.type}
                </span>
              )}
            </div>
          )}

          {/* Fila de progreso: valoración (una estrella, color por tramo) a
              la izquierda, barra de progreso al centro y el porcentaje a la
              derecha. Cualquiera de las dos partes puede faltar según los
              switches — solo se renderiza si al menos una está activa. */}
          {(settings.showProgress || settings.showRating) && (
            <div className="flex items-center gap-1.5 mt-0.5">
              {settings.showRating && (
                <div onPointerDown={(e) => e.stopPropagation()} className="shrink-0">
                  <StarRating value={item.rating || 0} onChange={() => { /* solo lectura en la tarjeta: editar desde el libro */ }} size="sm" compact readOnly />
                </div>
              )}
              {settings.showProgress && (
                <>
                  <div className="flex-1 h-1.5 rounded-full bg-slate-200/60 dark:bg-slate-700/60 overflow-hidden" title={`Progreso: ${item.progress ?? 0}%`}>
                    <div className="h-full rounded-full bg-[var(--primary)] transition-all" style={{ width: `${item.progress ?? 0}%` }} />
                  </div>
                  <span className="text-[10px] font-bold text-[var(--text-muted)] shrink-0">{item.progress ?? 0}%</span>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
