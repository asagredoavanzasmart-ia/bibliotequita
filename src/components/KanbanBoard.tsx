// =============================================================================
// KanbanBoard.tsx — Tablero Kanban de progreso de lectura (ver
// SPEC-TABLERO-KANBAN.md y PLAN-TABLERO-KANBAN.md)
// -----------------------------------------------------------------------------
// Tablero GLOBAL de toda la biblioteca con 5 columnas fijas. Sincronizado con
// los estados reales del libro (read/toRead/progress): mover una tarjeta
// cambia el libro, y viceversa — read===true SIEMPRE manda sobre la columna
// guardada (columnOf), así un libro marcado leído desde cualquier otra parte
// de la app no queda "atascado" en una columna vieja.
//
// Solo aparecen libros añadidos EXPLÍCITAMENTE al tablero (kanbanStatus con
// valor): marcar "leído" un libro que nunca se agregó no lo mete solo.
// =============================================================================

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Plus, LayoutGrid } from 'lucide-react';
import { useLibrary } from '../hooks/useLibrary';
import type { BookItem, KanbanStatus } from '../types';
import { cn } from '../lib/utils';
import { KanbanColumn } from './KanbanColumn';
import { KanbanSelectorModal } from './KanbanSelectorModal';

interface KanbanBoardProps {
  onOpenBook: (id: string) => void;
  // El panel de configuración de tarjetas vive en la botonera superior
  // (Toolbar.tsx), no aquí — este componente solo APLICA los switches.
  cardSettings: KanbanCardSettings;
}

const KANBAN_COLUMNS: { id: KanbanStatus; title: string; accent: string }[] = [
  { id: 'por_leer', title: 'Por leer', accent: 'bg-sky-400' },
  { id: 'pendiente', title: 'Pendiente de iniciar', accent: 'bg-amber-400' },
  { id: 'en_curso', title: 'En curso', accent: 'bg-emerald-400' },
  { id: 'detenido', title: 'Detenido', accent: 'bg-rose-400' },
  { id: 'leido', title: 'Leído', accent: 'bg-violet-400' },
];

export interface KanbanCardSettings {
  showCover: boolean;
  coverLarge: boolean;
  showAuthor: boolean;
  showYear: boolean;
  showFormat: boolean;
  showProgress: boolean;
  showTags: boolean;
  showRating: boolean;
}

const DEFAULT_CARD_SETTINGS: KanbanCardSettings = {
  showCover: true,
  coverLarge: false,
  showAuthor: true,
  showYear: false,
  showFormat: true,
  showProgress: true,
  showTags: true,
  showRating: false,
};

const SETTINGS_KEY = 'kanban-card-settings';

function loadCardSettings(): KanbanCardSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_CARD_SETTINGS;
    return { ...DEFAULT_CARD_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_CARD_SETTINGS;
  }
}

// Estado + persistencia de la configuración de tarjetas, compartido entre el
// botón/panel de la botonera superior (Toolbar.tsx) y el tablero que
// consume los switches para renderizar cada tarjeta. Un solo hook evita
// duplicar la lógica de localStorage en dos componentes.
export function useKanbanCardSettings(): [KanbanCardSettings, (updater: (prev: KanbanCardSettings) => KanbanCardSettings) => void] {
  const [settings, setSettings] = useState<KanbanCardSettings>(loadCardSettings);
  useEffect(() => {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* modo privado */ }
  }, [settings]);
  return [settings, setSettings];
}

// read manda sobre kanbanStatus: un libro leído SIEMPRE se muestra en
// "Leído" aunque su kanbanStatus guardado diga otra cosa (quedó viejo porque
// se marcó leído desde la grilla, no arrastrándolo). Al moverlo desde el
// tablero, moveTo() reescribe todo de forma coherente.
function columnOf(item: BookItem): KanbanStatus | null {
  if (!item.kanbanStatus) return null;
  if (item.read) return 'leido';
  return item.kanbanStatus;
}

export function KanbanBoard({ onOpenBook, cardSettings }: KanbanBoardProps) {
  const { items, tags, updateItem } = useLibrary();
  const [selectorCol, setSelectorCol] = useState<KanbanStatus | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);

  // Única función que escribe en el libro al cambiar de columna (drag o
  // menú ⋯): mantiene read/toRead/progress coherentes con la columna.
  const moveTo = useCallback((item: BookItem, dest: KanbanStatus) => {
    const updates: Partial<BookItem> = { kanbanStatus: dest };
    if (dest === 'leido') {
      updates.read = true;
      updates.progress = 100;
      updates.toRead = false;
    } else if (dest === 'por_leer') {
      updates.read = false;
      updates.toRead = true;
    } else {
      updates.read = false;
      updates.toRead = false;
    }
    updateItem(item.id, updates);
  }, [updateItem]);

  // Quitar del tablero NO toca read/toRead/progress — salir del tablero no
  // cambia el estado de lectura del libro, solo deja de mostrarse aquí.
  const removeFromBoard = useCallback((item: BookItem) => {
    updateItem(item.id, { kanbanStatus: null });
  }, [updateItem]);

  const itemsByColumn = useMemo(() => {
    const map: Record<KanbanStatus, BookItem[]> = {
      por_leer: [], pendiente: [], en_curso: [], detenido: [], leido: [],
    };
    for (const item of items) {
      if (item.deletedAt) continue;
      const col = columnOf(item);
      if (col) map[col].push(item);
    }
    for (const col of KANBAN_COLUMNS) {
      map[col.id].sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
    }
    return map;
  }, [items]);

  const totalCount = KANBAN_COLUMNS.reduce((acc, c) => acc + itemsByColumn[c.id].length, 0);

  const draggedItem = draggedId ? items.find((i) => i.id === draggedId) ?? null : null;

  const handleDropOnColumn = (dest: KanbanStatus) => {
    if (draggedItem && columnOf(draggedItem) !== dest) moveTo(draggedItem, dest);
    setDraggedId(null);
  };

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Cabecera: título + contador. El panel de configuración de tarjetas
          vive en la botonera superior (Toolbar.tsx) — ver useKanbanCardSettings. */}
      <div className="flex items-center gap-2 pb-3 shrink-0">
        <LayoutGrid className="w-5 h-5 text-[var(--primary)] shrink-0" />
        <h2 className="text-base font-bold text-[var(--text-main)] truncate">Tablero de Lectura</h2>
        <span className="text-xs font-bold text-[var(--text-muted)] shrink-0">({totalCount})</span>
      </div>

      {/* Columnas: móvil = una por pantalla con snap táctil nativo (solo
          CSS); PC (lg+) = las 5 a lo ancho, sin scroll horizontal general. */}
      <div className="flex-1 min-h-0 flex gap-3 overflow-x-auto snap-x snap-mandatory no-scrollbar pb-2 lg:grid lg:grid-cols-5 lg:overflow-x-visible lg:snap-none">
        {KANBAN_COLUMNS.map((col) => (
          <KanbanColumn
            key={col.id}
            column={col}
            items={itemsByColumn[col.id]}
            settings={cardSettings}
            tags={tags}
            onOpenBook={onOpenBook}
            onMove={moveTo}
            onRemove={removeFromBoard}
            onAdd={() => setSelectorCol(col.id)}
            draggedId={draggedId}
            setDraggedId={setDraggedId}
            onDropColumn={() => handleDropOnColumn(col.id)}
          />
        ))}
      </div>

      {/* Botón flotante móvil: el FAB genérico del Dashboard se oculta en
          esta vista (ver Dashboard.tsx) para no duplicar el "+". */}
      <button
        onClick={() => setSelectorCol('por_leer')}
        className="lg:hidden fixed bottom-6 right-6 w-14 h-14 bg-[var(--primary)] text-white rounded-full shadow-lg shadow-[var(--primary)]/30 flex items-center justify-center z-[70] active:scale-95 transition-all border-2 border-white/20"
        title="Añadir al tablero"
      >
        <Plus className="w-7 h-7" />
      </button>

      {selectorCol && (
        <KanbanSelectorModal
          targetCol={selectorCol}
          columnTitle={KANBAN_COLUMNS.find((c) => c.id === selectorCol)!.title}
          items={items}
          columnOf={columnOf}
          columnLabel={(id) => KANBAN_COLUMNS.find((c) => c.id === id)?.title ?? id}
          onPick={(item) => { moveTo(item, selectorCol); setSelectorCol(null); }}
          onClose={() => setSelectorCol(null)}
        />
      )}
    </div>
  );
}

// Exportado: lo reutiliza el panel de configuración de tarjetas que vive en
// la botonera superior (Toolbar.tsx).
export function SettingRow({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onChange}
      disabled={disabled}
      className={cn(
        'flex items-center justify-between px-2 py-1.5 rounded-lg text-xs font-semibold text-left transition-colors',
        disabled ? 'opacity-40 cursor-not-allowed' : 'hover:bg-[var(--bg-app)] text-[var(--text-main)]'
      )}
    >
      <span>{label}</span>
      <span className={cn('w-8 h-[18px] rounded-full relative transition-colors shrink-0', checked ? 'bg-[var(--primary)]' : 'bg-slate-300 dark:bg-slate-600')}>
        <span className={cn('absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white shadow-sm transition-transform', checked ? 'translate-x-[18px]' : 'translate-x-0.5')} />
      </span>
    </button>
  );
}
