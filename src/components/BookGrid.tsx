// =============================================================================
// BookGrid.tsx — Render de la colección
// -----------------------------------------------------------------------------
// Aplica TODOS los filtros (category, searchQuery, filters, stage, playlist) y
// el orden (manual/recent/oldest/alpha) sobre items y renderiza cada uno
// como <SortableItem> (drag & drop con @dnd-kit/sortable).
//
// 4 modos de vista:
//   - covers        → solo portadas, grilla densa (hasta 10 columnas).
//   - grid          → 1–6 columnas, tarjeta alta con portada grande.
//   - grid-compact  → más columnas y altura reducida.
//   - list          → 1–2 columnas, portada lateral + ficha completa.
//
// Categorías "virtuales" (no son CategoryData reales sino flags de BookItem):
//   destacados → pinned===true · fisico → ownedPhysical · digital → ownedDigital
// =============================================================================

import { useLibrary } from '../hooks/useLibrary';
import { BookItem } from '../types';
import { Book as BookIcon, FileText, ExternalLink, Trash2, CheckCircle2, Bookmark, BookmarkCheck, Edit, Image as ImageIcon, Pin, Star, Hourglass } from 'lucide-react';
import { cn } from '../lib/utils';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
  verticalListSortingStrategy,
  useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import React, { useState, useMemo, FC, useRef } from 'react';
import { EditBookModal } from './EditBookModal';
import { StarRating } from './StarRating';
import { DraggableProgress } from './DraggableProgress';

interface BookGridProps {
  category: string;
  viewMode: 'covers' | 'grid' | 'grid-compact' | 'list';
  sortBy: 'manual' | 'recent' | 'oldest' | 'alpha';
  stageFilter: string | null;
  playlistFilter: string | null;
  onOpenBook: (id: string) => void;
  filters?: any;
  searchQuery?: string;
  selectedItems?: string[];
  setSelectedItems?: (items: string[]) => void;
}

// Barra de progreso interactiva: click o arrastre (mouse/touch) fija el % según
// la posición horizontal. El wrapper amplía el área táctil sin cambiar el visual.
// Re-exportado para mantener compatibilidad con imports existentes
// (vive en su propio módulo para evitar import circular con EditBookModal).
export { DraggableProgress };

const SortableItem: FC<{ item: BookItem, viewMode: 'covers'|'grid'|'grid-compact'|'list', onOpen: () => void, onDelete: () => void, onEdit: () => void, isSelected?: boolean, onSelectToggle?: () => void }> = ({ item, viewMode, onOpen, onDelete, onEdit, isSelected, onSelectToggle }) => {
  const { updateItem, cardSettings } = useLibrary();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleThumbnailUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      updateItem(item.id, { thumbnailUrl: URL.createObjectURL(file) });
    }
  };

  const progState = useMemo(() => {
    if (item.read) return { text: "Leído", color: "bg-emerald-500" };
    const p = item.progress || 0;
    // 0% Sin leer · 1–25% Consultado · 26–50% En proceso · 51–99% Revisado · 100% Leído
    if (p === 0) return { text: "Sin leer", color: "bg-slate-400" };
    if (p <= 25) return { text: "Consultado", color: "bg-slate-500" };
    if (p <= 50) return { text: "En proceso", color: "bg-amber-500" };
    if (p < 100) return { text: "Revisado", color: "bg-blue-500" };
    return { text: "Leído", color: "bg-emerald-500" };
  }, [item.progress, item.read]);

  const pValue = item.read ? 100 : Math.min(100, Math.max(0, item.progress || 0));
  
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : 1,
    opacity: isDragging ? 0.8 : 1,
  };

  const Icon = item.type === 'externa' ? ExternalLink : (item.type === 'pdf' ? FileText : BookIcon);

  const handleToggleRead = (e: React.MouseEvent) => {
    e.stopPropagation();
    updateItem(item.id, { read: !item.read });
  };
  const handleTogglePinned = (e: React.MouseEvent) => {
    e.stopPropagation();
    updateItem(item.id, { pinned: !item.pinned });
  };
  const handleToggleFavorite = (e: React.MouseEvent) => {
    e.stopPropagation();
    updateItem(item.id, { favorite: !item.favorite });
  };
  const handleToggleToRead = (e: React.MouseEvent) => {
    e.stopPropagation();
    updateItem(item.id, { toRead: !item.toRead });
  };

  // Covers Mode — solo portada, grilla densa. Click abre el libro; el drag
  // funciona en toda la tarjeta (PointerSensor con distance:5 no roba el click).
  if (viewMode === 'covers') {
    return (
      <div
        ref={setNodeRef}
        style={style}
        {...attributes}
        {...listeners}
        onClick={onOpen}
        title={item.title}
        className="group relative aspect-[2/3] rounded-lg overflow-hidden bg-[var(--bg-card)] border border-slate-200/50 shadow-sm hover:shadow-xl hover:-translate-y-1 hover:border-[var(--primary)]/50 transition-all duration-300 cursor-pointer"
      >
        {item.thumbnailUrl ? (
          <img src={item.thumbnailUrl} alt={item.title} className="w-full h-full object-cover" draggable={false} />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-[#00558F] to-slate-800 flex flex-col items-center justify-center p-2 relative overflow-hidden before:absolute before:left-[4px] before:top-0 before:bottom-0 before:w-[3px] before:bg-black/20">
            <h4 className="text-center text-white/90 font-bold text-[10px] sm:text-[11px] line-clamp-4 leading-tight drop-shadow-md px-1 relative z-10">{item.title}</h4>
            {item.author && <p className="text-[8px] text-white/60 font-medium uppercase line-clamp-1 mt-1 relative z-10">{item.author}</p>}
          </div>
        )}

        {/* Badges de estado, siempre visibles */}
        {item.favorite && <Star className="absolute top-1.5 left-1.5 w-4 h-4 text-yellow-400 fill-yellow-400/50 drop-shadow z-10" />}
        {item.pinned && <Pin className="absolute top-1.5 left-7 w-4 h-4 text-amber-400 fill-amber-400/40 drop-shadow z-10" />}
        {/* En móvil (vista "covers" a 2 columnas) la portada es angosta y este
            badge quedaba cortado por el borde redondeado de la tarjeta. */}
        {item.read && <CheckCircle2 className="absolute top-1.5 right-1.5 w-4 h-4 text-emerald-400 drop-shadow z-10 hidden sm:block" />}

        {/* Overlay hover: título + acciones (seleccionar / editar / eliminar) */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex flex-col justify-end p-2 z-20">
          <h4 className="text-white font-bold text-[11px] leading-tight line-clamp-2 drop-shadow">{item.title}</h4>
          {item.author && <p className="text-white/70 text-[9px] line-clamp-1 mb-1">{item.author}</p>}
          <div className="flex items-center gap-1">
            {onSelectToggle && (
              <button onClick={(e) => { e.stopPropagation(); onSelectToggle(); }} onPointerDown={(e) => e.stopPropagation()} className={cn("p-1 rounded transition-colors", isSelected ? "bg-[var(--primary)]" : "bg-white/15 hover:bg-white/30")} title="Seleccionar">
                <div className={cn("w-3.5 h-3.5 rounded-sm border border-white/70 flex items-center justify-center", isSelected ? "bg-white/20" : "")}>
                  {isSelected && <svg viewBox="0 0 14 14" fill="none" className="w-2.5 h-2.5 text-white"><path d="M3 8L6 11L11 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                </div>
              </button>
            )}
            <button onClick={(e) => { e.stopPropagation(); onEdit(); }} onPointerDown={(e) => e.stopPropagation()} className="p-1 rounded bg-white/15 hover:bg-white/30 transition-colors" title="Editar">
              <Edit className="w-3.5 h-3.5 text-white" />
            </button>
            <button onClick={(e) => { e.stopPropagation(); onDelete(); }} onPointerDown={(e) => e.stopPropagation()} className="p-1 rounded bg-white/15 hover:bg-rose-500/80 transition-colors ml-auto" title="Eliminar">
              <Trash2 className="w-3.5 h-3.5 text-white" />
            </button>
          </div>
        </div>

        {/* Checkbox de selección múltiple */}
        {onSelectToggle && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onSelectToggle(); }}
            onPointerDown={(e) => e.stopPropagation()}
            className={cn("absolute bottom-1.5 left-1.5 z-30 p-1 rounded shadow backdrop-blur-sm transition-opacity bg-black/40", isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100")}
          >
            <div className={cn("w-3.5 h-3.5 rounded-sm border border-white/60 flex items-center justify-center", isSelected ? "bg-[var(--primary)] border-[var(--primary)]" : "bg-transparent")}>
              {isSelected && <svg viewBox="0 0 14 14" fill="none" className="w-2.5 h-2.5 text-white"><path d="M3 8L6 11L11 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
            </div>
          </button>
        )}
      </div>
    );
  }

  if (viewMode === 'list') {
    return (
      <>
      <div
        ref={setNodeRef}
        style={style}
        className="group flex flex-row items-stretch bg-[var(--bg-card)] backdrop-blur-xl rounded-xl border border-slate-200/50 overflow-hidden hover:bg-[var(--bg-card-hover)] hover:shadow-md hover:border-[var(--primary)]/50 hover:-translate-y-0.5 transition-all duration-300"
      >
        {/* Portada que llena toda la altura de la fila (items-stretch) y deriva
            su ancho de esa altura en proporción 2:3, para que no quede
            espacio vacío debajo cuando la fila crece por el contenido de texto. */}
        <div
          className="aspect-[2/3] h-auto bg-[var(--bg-app)] border-r border-slate-200/50 cursor-grab active:cursor-grabbing relative shrink-0 overflow-hidden group/cover"
          {...attributes}
          {...listeners}
        >
          {item.thumbnailUrl ? (
            <img src={item.thumbnailUrl} alt={item.title} className="absolute inset-0 w-full h-full object-cover" draggable={false} />
          ) : (
            <div className="absolute inset-0 w-full h-full bg-gradient-to-br from-[#00558F] to-slate-800 flex flex-col items-center justify-center p-1 overflow-hidden before:absolute before:left-[3px] before:top-0 before:bottom-0 before:w-[2px] before:bg-black/20">
               <h4 className="text-center text-white/90 font-bold text-[8px] line-clamp-4 leading-tight drop-shadow-md px-0.5 relative z-10">{item.title}</h4>
            </div>
          )}
        </div>

        <div className="flex-1 p-3 flex flex-col justify-between min-w-0 gap-2 relative">
          <div className="flex flex-col w-full min-w-0">
             <h3 onClick={onOpen} className="font-bold text-[var(--text-main)] text-sm cursor-pointer hover:text-[var(--primary)] line-clamp-1">{item.title}</h3>
             {(cardSettings.showAuthor || cardSettings.showYear) && (
               <p className="text-xs truncate">
                 {cardSettings.showAuthor && <span className="text-[var(--primary)] font-bold">{item.author || 'Sin autor'}</span>}
                 {cardSettings.showYear && item.year && <span className="text-[var(--text-muted)]"> · {item.year}</span>}
               </p>
             )}
          </div>

          {/* Fila de acciones: iconos compactos, siempre visibles, con scroll si no caben */}
          <div className="flex items-center gap-0.5 overflow-x-auto no-scrollbar -mx-1 px-1">
            {onSelectToggle && (
              <button type="button" onClick={(e) => { e.stopPropagation(); onSelectToggle(); }} onPointerDown={(e) => e.stopPropagation()} className="p-1.5 rounded-md hover:bg-slate-100 transition-colors shrink-0" title="Seleccionar">
                <div className={cn("w-4 h-4 rounded-sm border flex items-center justify-center", isSelected ? "bg-[var(--primary)] border-[var(--primary)]" : "border-slate-300")}>
                  {isSelected && <svg viewBox="0 0 14 14" fill="none" className="w-3 h-3 text-white"><path d="M3 8L6 11L11 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                </div>
              </button>
            )}
            <button onClick={handleToggleFavorite} onPointerDown={(e) => e.stopPropagation()} className="p-1.5 rounded-md hover:bg-slate-100 transition-colors shrink-0" title={item.favorite ? "Quitar de favoritos" : "Favorito"}>
              <Star className={cn("w-4 h-4", item.favorite ? "text-yellow-500 fill-yellow-400/40" : "text-slate-400 hover:text-yellow-500")} />
            </button>
            <button onClick={handleTogglePinned} onPointerDown={(e) => e.stopPropagation()} className="p-1.5 rounded-md hover:bg-slate-100 transition-colors shrink-0" title={item.pinned ? "Desfijar" : "Destacar"}>
              <Pin className={cn("w-4 h-4", item.pinned ? "text-amber-500 fill-amber-500/20" : "text-slate-400 hover:text-amber-500")} />
            </button>
            <button onClick={handleToggleToRead} onPointerDown={(e) => e.stopPropagation()} className="p-1.5 rounded-md hover:bg-slate-100 transition-colors shrink-0" title={item.toRead ? "Quitar de Por Leer" : "Por Leer"}>
              <Hourglass className={cn("w-4 h-4", item.toRead ? "text-sky-500 fill-sky-400/20" : "text-slate-400 hover:text-sky-500")} />
            </button>
            <button onClick={handleToggleRead} onPointerDown={(e) => e.stopPropagation()} className="p-1.5 rounded-md hover:bg-slate-100 transition-colors shrink-0" title={item.read ? "Marcar como no leído" : "Marcar como leído"}>
              <CheckCircle2 className={cn("w-4 h-4", item.read ? "text-emerald-500 fill-emerald-500/20" : "text-slate-400 hover:text-emerald-500")} />
            </button>
            <span className="w-px h-4 bg-slate-200 mx-0.5 shrink-0" />
            <button onClick={(e) => { e.stopPropagation(); onEdit(); }} onPointerDown={(e) => e.stopPropagation()} className="p-1.5 rounded-md hover:bg-slate-100 text-slate-400 hover:text-[var(--primary)] transition-colors shrink-0" title="Editar">
              <Edit className="w-4 h-4" />
            </button>
            <button onClick={(e) => { e.stopPropagation(); onDelete(); }} onPointerDown={(e) => e.stopPropagation()} className="p-1.5 rounded-md hover:bg-slate-100 text-slate-400 hover:text-rose-500 transition-colors shrink-0" title="Eliminar">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>

          {(cardSettings.showProgress || cardSettings.showRating) && (
            <div className="w-full flex items-center gap-2">
               {cardSettings.showRating && (
                 <div onPointerDown={(e) => e.stopPropagation()} className="shrink-0">
                    <StarRating value={item.rating || 0} onChange={(v) => updateItem(item.id, { rating: v })} size="sm" />
                 </div>
               )}
               {cardSettings.showProgress && (
                 <div className="flex-1 min-w-0 flex items-center gap-2" title={`Progreso: ${pValue}%`}>
                    <DraggableProgress value={pValue} color={progState.color} onChange={(v) => updateItem(item.id, { progress: v, ...(item.read && v < 100 ? { read: false } : {}) })} />
                    <span className={cn("text-[11px] font-bold w-[64px] shrink-0 text-right whitespace-nowrap", progState.color.replace('bg-', 'text-'))}>{progState.text}</span>
                 </div>
               )}
            </div>
          )}
        </div>
      </div>
      </>
  );
  }

  // Grid Mode
  return (
    <>
    <div
      ref={setNodeRef}
      style={style}
      className={cn("group flex flex-col bg-[var(--bg-card)] backdrop-blur-xl rounded-2xl shadow-sm border border-slate-200/50 hover:bg-[var(--bg-card-hover)] hover:shadow-xl hover:border-[var(--primary)]/50 hover:-translate-y-1 transition-all duration-300 h-auto",
        viewMode === 'grid-compact' ? "min-h-[220px]" : "min-h-[340px] md:min-h-[380px]"
      )}
    >
      <div
        className={cn("bg-[var(--bg-app)] relative flex-shrink-0 cursor-grab active:cursor-grabbing flex items-center justify-center p-2 md:p-4 backdrop-blur-sm group/cover border-b border-slate-200/50 rounded-t-2xl overflow-hidden",
           viewMode === 'grid-compact' ? "h-[116px]" : "h-56"
        )}
        {...attributes} 
        {...listeners}
      >
        {item.thumbnailUrl ? (
          <>
            {/* Fondo difuminado con la misma portada para rellenar los huecos laterales */}
            <img src={item.thumbnailUrl} alt="" aria-hidden className="absolute inset-0 w-full h-full object-cover blur-lg scale-110 opacity-40" draggable={false} />
            <img src={item.thumbnailUrl} alt={item.title} className="relative z-10 w-full h-full object-contain drop-shadow-md rounded" draggable={false} />
          </>
        ) : (
          <div className="w-[85%] h-[90%] bg-gradient-to-br from-[#00558F] to-slate-800 rounded-md shadow-lg shadow-black/20 flex flex-col items-center justify-center p-4 relative overflow-hidden border border-white/10 before:absolute before:left-2 before:top-0 before:bottom-0 before:w-1 before:bg-black/20 before:shadow-[1px_0_2px_rgba(255,255,255,0.1)]">
             <BookIcon className="w-8 h-8 text-white/20 absolute bottom-4 right-4" />
             <div className="flex-1 w-full flex items-center justify-center">
                 <h4 className="text-center text-white/90 font-bold text-sm line-clamp-4 leading-snug drop-shadow-md px-2 relative z-10">{item.title}</h4>
             </div>
             {item.author && <p className="text-xs text-white/60 font-medium tracking-wide uppercase line-clamp-1 mt-auto pb-2 relative z-10">{item.author}</p>}
          </div>
        )}
        {onSelectToggle && (
           <button
             type="button"
             onClick={(e) => { e.stopPropagation(); onSelectToggle(); }}
             onPointerDown={(e) => e.stopPropagation()}
             className="absolute top-2 left-2 z-30 group/btn transition-transform hover:scale-110 bg-[var(--bg-app)]/80 p-1.5 rounded-md shadow backdrop-blur-sm hover:bg-[var(--bg-app)]"
           >
             <div className={cn("w-4 h-4 rounded-sm border border-slate-300 flex items-center justify-center", isSelected ? "bg-[var(--primary)] border-[var(--primary)]" : "bg-transparent")}>
                {isSelected && <svg viewBox="0 0 14 14" fill="none" className="w-3 h-3 text-[var(--bg-app)]"><path d="M3 8L6 11L11 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
             </div>
           </button>
        )}

        {/* Columna vertical de acciones al costado derecho de la portada: cada
            botón es su propio cuadrado con sombra (no una cápsula compartida),
            para que el contraste de cada ícono no dependa de un fondo único. */}
        <div
          className="absolute top-2 right-2 z-20 flex flex-col items-center gap-1"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button type="button" onClick={handleToggleFavorite} className="w-7 h-7 rounded-md bg-[var(--bg-app)]/90 shadow-md flex items-center justify-center transition-transform hover:scale-110" title={item.favorite ? "Quitar de favoritos" : "Favorito"}>
            <Star className={cn("w-4 h-4", item.favorite ? "text-yellow-500 fill-yellow-400/40" : "text-slate-500 hover:text-yellow-500")} />
          </button>
          <button type="button" onClick={handleTogglePinned} className="w-7 h-7 rounded-md bg-[var(--bg-app)]/90 shadow-md flex items-center justify-center transition-transform hover:scale-110" title={item.pinned ? "Desfijar" : "Destacar"}>
            <Pin className={cn("w-4 h-4", item.pinned ? "text-amber-500 fill-amber-400/30" : "text-slate-500 hover:text-amber-500")} />
          </button>
          <button type="button" onClick={handleToggleToRead} className="w-7 h-7 rounded-md bg-[var(--bg-app)]/90 shadow-md flex items-center justify-center transition-transform hover:scale-110" title={item.toRead ? "Quitar de Por Leer" : "Por Leer"}>
            <Hourglass className={cn("w-4 h-4", item.toRead ? "text-sky-500 fill-sky-400/30" : "text-slate-500 hover:text-sky-500")} />
          </button>
          {/* En la vista compacta (2 columnas) en móvil la portada es muy baja
              y el 4º botón quedaba cortado; se oculta el check ahí (el estado
              "leído" sigue marcándose desde la barra de progreso/otras vistas). */}
          <button type="button" onClick={handleToggleRead} className={cn("w-7 h-7 rounded-md bg-[var(--bg-app)]/90 shadow-md items-center justify-center transition-transform hover:scale-110", viewMode === 'grid-compact' ? "hidden sm:flex" : "flex")} title={item.read ? "Marcar como no leído" : "Marcar como leído"}>
            <CheckCircle2 className={cn("w-4 h-4", item.read ? "text-emerald-500 fill-emerald-500/30" : "text-slate-500 hover:text-emerald-500")} />
          </button>
        </div>
      </div>
      <div className="flex-1 p-4 flex flex-col justify-between relative bg-[var(--bg-card)] rounded-b-2xl">
         <div className="relative min-w-0">
            <div className="flex justify-between items-start mb-2 min-w-0">
              <div className="flex flex-col min-w-0 overflow-hidden">
                {cardSettings.showAuthor && <span className="text-xs font-bold text-[var(--primary)] truncate pr-2 hover:underline z-20 relative cursor-pointer block" onClick={(e) => { e.stopPropagation(); onOpen(); }}>{item.author || 'Sin autor'}</span>}
                {cardSettings.showYear && item.year && <span className="text-[12px] text-[var(--text-muted)] mt-0.5">{item.year}</span>}
              </div>

              <div className="flex gap-1 shrink-0 px-2 py-0.5 rounded overflow-hidden">
                {item.folderIds.length > 0 && <div className="w-2 h-2 rounded-full bg-[var(--secondary)]" />}
              </div>
            </div>
            <h3 onClick={onOpen} className="text-sm font-bold text-[var(--text-main)] leading-tight mb-2 cursor-pointer hover:text-[var(--primary)] line-clamp-2">{item.title}</h3>
         </div>
         <div className="flex justify-between items-center mt-auto h-6">
            <div className="flex items-center gap-3 text-[12px] text-[var(--text-muted)]">
               {cardSettings.showType && item.type !== 'externa' && <span className="flex items-center gap-1 uppercase font-bold"><FileText className="w-3 h-3" /> {item.type}</span>}
               {cardSettings.showPhysicalStatus && item.ownedPhysical && <span className="flex items-center gap-1 text-[var(--primary)] uppercase font-bold"><BookIcon className="w-3 h-3" /> Físico</span>}
            </div>
         </div>

          {cardSettings.showProgress && (
            <div className="w-full flex items-center gap-2 mt-2" title={`Progreso: ${pValue}%`}>
               <DraggableProgress value={pValue} color={progState.color} onChange={(v) => updateItem(item.id, { progress: v, ...(item.read && v < 100 ? { read: false } : {}) })} />
               <span className={cn("text-[12px] font-bold w-[72px] shrink-0 text-right whitespace-nowrap", progState.color.replace('bg-', 'text-'))}>{progState.text}</span>
            </div>
          )}
          <div className={cn("flex items-end justify-between", cardSettings.showProgress ? "mt-1" : "mt-2")}>
            {cardSettings.showRating ? (
              <div onPointerDown={(e) => e.stopPropagation()}>
                <StarRating value={item.rating || 0} onChange={(v) => updateItem(item.id, { rating: v })} size="sm" />
              </div>
            ) : <div />}
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all z-20 relative bg-[var(--bg-app)]/80 p-0.5 rounded shadow-sm backdrop-blur-sm border border-slate-200/50">
               <button onClick={(e) => { e.stopPropagation(); onEdit(); }} className="p-1 text-slate-500 hover:text-[var(--primary)] hover:bg-[var(--bg-app)] rounded transition-colors" title="Editar">
                 <Edit className="w-4 h-4" />
               </button>
               <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="p-1 text-slate-500 hover:text-rose-500 hover:bg-[var(--bg-app)] rounded transition-colors" title="Eliminar">
                 <Trash2 className="w-4 h-4" />
               </button>
            </div>
          </div>
       </div>
    </div>
    </>
  );
}

export function BookGrid({ category, viewMode, sortBy, stageFilter, playlistFilter, onOpenBook, filters, searchQuery, selectedItems, setSelectedItems }: BookGridProps) {
  const { items, deleteItem, updateItem } = useLibrary();
  const [editingItem, setEditingItem] = useState<BookItem | null>(null);

  const filteredItems = useMemo(() => {
    let result = items;
    if (category === 'favoritos') {
        result = items.filter(i => i.favorite);
    } else if (category === 'leidos') {
        result = items.filter(i => i.read);
    } else if (category === 'porleer') {
        result = items.filter(i => i.toRead);
    } else if (category === 'destacados') {
        result = items.filter(i => i.pinned);
    } else if (category === 'fisico') {
        result = items.filter(i => i.ownedPhysical);
    } else if (category === 'digital') {
        result = items.filter(i => i.ownedDigital);
    } else if (category !== 'todos' && category !== 'analytics') {
        result = items.filter(i => i.category === category);
    }
    
    if (stageFilter) {
      result = result.filter(i => i.stageIds.includes(stageFilter));
    }
    if (playlistFilter) {
      result = result.filter(i => i.folderIds.includes(playlistFilter));
    }

    if (searchQuery) {
       const query = searchQuery.toLowerCase();
       result = result.filter(i =>
         i.title.toLowerCase().includes(query) ||
         (i.author && i.author.toLowerCase().includes(query)) ||
         (i.subject && i.subject.toLowerCase().includes(query))
       );
    }

    if (filters) {
       if (filters.year) result = result.filter(i => i.year === filters.year);
       if (filters.author) result = result.filter(i => i.author === filters.author);
       if (filters.subject) result = result.filter(i => i.subject === filters.subject);
       if (filters.read === 'true') result = result.filter(i => i.read === true);
       if (filters.read === 'false') result = result.filter(i => !i.read);
       if (filters.toBuy === 'true') result = result.filter(i => i.toBuy === true);
       if (filters.toBuy === 'false') result = result.filter(i => !i.toBuy);
       if (filters.authorInitial) result = result.filter(i => i.author && i.author[0]?.toUpperCase() === filters.authorInitial);
       if (filters.titleInitial) result = result.filter(i => i.title && i.title[0]?.toUpperCase() === filters.titleInitial);
       // Unión (OR): un libro puede tener varias etiquetas, basta con que
       // coincida con AL MENOS una de las seleccionadas en el filtro.
       if (filters.tagIds && filters.tagIds.length > 0) {
         result = result.filter(i => (i.tags ?? []).some((tId: string) => filters.tagIds.includes(tId)));
       }
    }

    result.sort((a, b) => {
      if (sortBy === 'manual') return (a.listIndex ?? 0) - (b.listIndex ?? 0);
      if (sortBy === 'recent') return b.timestamp - a.timestamp;
      if (sortBy === 'oldest') return a.timestamp - b.timestamp;
      if (sortBy === 'alpha') return a.title.localeCompare(b.title);
      return 0;
    });

    return result;
  }, [items, category, stageFilter, playlistFilter, sortBy, filters, searchQuery]);

  if (filteredItems.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-slate-400">
        <BookIcon className="w-16 h-16 mb-4 text-slate-200" />
        <p className="text-lg font-medium text-slate-500">No hay recursos en esta vista</p>
        <p className="text-sm">Sube un archivo o añade un enlace para comenzar.</p>
      </div>
    );
  }

  const strategy = viewMode === 'list' ? verticalListSortingStrategy : rectSortingStrategy;

  return (
      <>
      <SortableContext 
        items={filteredItems.map(i => i.id)}
        strategy={strategy}
      >
        <div className={cn(
          "w-full grid",
          viewMode === 'covers' && "grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 gap-3",
          viewMode === 'grid' && "grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-5",
          viewMode === 'grid-compact' && "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3",
          viewMode === 'list' && "grid-cols-1 lg:grid-cols-2 gap-4"
        )}>
          {filteredItems.map(item => (
            <SortableItem 
              key={item.id} 
              item={item} 
              viewMode={viewMode}
              onOpen={() => onOpenBook(item.id)}
              onEdit={() => setEditingItem(item)}
              onDelete={() => deleteItem(item.id)}
              isSelected={selectedItems?.includes(item.id)}
              onSelectToggle={() => {
                if (setSelectedItems && selectedItems) {
                  if (selectedItems.includes(item.id)) {
                    setSelectedItems(selectedItems.filter(id => id !== item.id));
                  } else {
                    setSelectedItems([...selectedItems, item.id]);
                  }
                }
              }}
            />
          ))}
        </div>
      </SortableContext>

      {editingItem && (
         <EditBookModal 
            item={editingItem}
            onClose={() => setEditingItem(null)}
            onSave={(id, updates) => updateItem(id, updates)}
         />
      )}
      </>
  );
}
