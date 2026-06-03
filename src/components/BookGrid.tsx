// =============================================================================
// BookGrid.tsx — Render de la colección
// -----------------------------------------------------------------------------
// Aplica TODOS los filtros (category, searchQuery, filters, stage, playlist) y
// el orden (manual/recent/oldest/alpha) sobre items y renderiza cada uno
// como <SortableItem> (drag & drop con @dnd-kit/sortable).
//
// 3 modos de vista:
//   - grid          → 1–5 columnas, tarjeta alta con portada grande.
//   - grid-compact  → más columnas y altura reducida.
//   - list          → 1–2 columnas, portada lateral + ficha completa.
//
// Categorías "virtuales" (no son CategoryData reales sino flags de BookItem):
//   destacados → pinned===true · fisico → ownedPhysical · digital → ownedDigital
// =============================================================================

import { useLibrary } from '../hooks/useLibrary';
import { BookItem } from '../types';
import { Book as BookIcon, FileText, ExternalLink, Trash2, CheckCircle2, Bookmark, BookmarkCheck, Edit, Image as ImageIcon, Pin } from 'lucide-react';
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

interface BookGridProps {
  category: string;
  viewMode: 'grid' | 'grid-compact' | 'list';
  sortBy: 'manual' | 'recent' | 'oldest' | 'alpha';
  stageFilter: string | null;
  playlistFilter: string | null;
  onOpenBook: (id: string) => void;
  filters?: any;
  searchQuery?: string;
  selectedItems?: string[];
  setSelectedItems?: (items: string[]) => void;
}

const SortableItem: FC<{ item: BookItem, viewMode: 'grid'|'grid-compact'|'list', onOpen: () => void, onDelete: () => void, onEdit: () => void, isSelected?: boolean, onSelectToggle?: () => void }> = ({ item, viewMode, onOpen, onDelete, onEdit, isSelected, onSelectToggle }) => {
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
    if (p === 0) return { text: "Pendiente", color: "bg-slate-500" };
    if (p < 25) return { text: "Consultado", color: "bg-yellow-400" };
    if (p < 75) return { text: "Avanzado", color: "bg-blue-500" };
    if (p < 100) return { text: "Revisado", color: "bg-cyan-400" };
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
  };  if (viewMode === 'list') {
    return (
      <>
      <div
        ref={setNodeRef}
        style={style}
        className="group flex flex-row items-center bg-[var(--bg-card)] backdrop-blur-xl rounded-xl border border-slate-200/50 overflow-hidden hover:bg-[var(--bg-card-hover)] hover:shadow-md hover:border-[var(--primary)]/50 hover:-translate-y-0.5 transition-all duration-300"
      >
        <div 
          className="h-28 sm:h-36 aspect-[5/4] bg-[var(--bg-app)] flex items-center justify-center p-2 border-r border-slate-200/50 cursor-grab active:cursor-grabbing relative shrink-0 overflow-hidden group/cover"
          {...attributes} 
          {...listeners}
        >
          {item.thumbnailUrl ? (
            <img src={item.thumbnailUrl} alt={item.title} className="max-w-full max-h-full object-contain drop-shadow-sm rounded" draggable={false} />
          ) : (
            <div className="w-[85%] h-[90%] bg-gradient-to-br from-[#00558F] to-slate-800 shadow-md shadow-black/20 flex flex-col items-center justify-center p-2 relative overflow-hidden border border-white/10 before:absolute before:left-[4px] before:top-0 before:bottom-0 before:w-[3px] before:bg-black/20 rounded">
               <div className="flex-1 w-full flex items-center justify-center">
                   <h4 className="text-center text-white/90 font-bold text-[9px] sm:text-[10px] line-clamp-3 leading-tight drop-shadow-md px-1 relative z-10">{item.title}</h4>
               </div>
            </div>
          )}
          
          {onSelectToggle && (
             <button 
               type="button"
               onClick={(e) => { e.stopPropagation(); onSelectToggle(); }}
               onPointerDown={(e) => e.stopPropagation()}
               className="absolute top-2 left-2 z-30 group/btn transition-transform hover:scale-110 bg-[var(--bg-app)]/80 p-1 rounded shadow backdrop-blur-sm hover:bg-[var(--bg-app)]"
             >
               <div className={cn("w-3.5 h-3.5 rounded-sm border border-slate-300 flex items-center justify-center", isSelected ? "bg-[var(--primary)] border-[var(--primary)]" : "bg-transparent")}>
                  {isSelected && <svg viewBox="0 0 14 14" fill="none" className="w-2.5 h-2.5 text-[var(--bg-app)]"><path d="M3 8L6 11L11 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
               </div>
             </button>
          )}
        </div>
        <div className="flex-1 p-4 flex flex-col justify-between min-w-0 h-full gap-2 relative">
          <div className="flex justify-between items-start z-10 w-full pr-16 relative group/title">
             <div className="flex flex-col w-full">
                <h3 onClick={onOpen} className="font-bold text-[var(--text-main)] text-sm cursor-pointer hover:text-[var(--primary)] line-clamp-1">{item.title}</h3>
                {cardSettings.showAuthor && <p className="text-xs text-[var(--primary)] hover:underline cursor-pointer font-bold">{item.author || 'Sin autor'}</p>}
                {cardSettings.showYear && item.year && <p className="text-xs text-[var(--text-muted)]">{item.year}</p>}
             </div>
          </div>
          
          <div className="absolute top-3 right-3 flex gap-1 items-center z-20 bg-white border border-slate-200/50 rounded-lg p-1 shadow-sm">
            <button 
              onClick={(e) => { e.stopPropagation(); updateItem(item.id, { pinned: !item.pinned }); }} 
              className="p-1 group/btn transition-transform hover:scale-110 hover:bg-slate-50 rounded-md"
              title={item.pinned ? "Desfijar" : "Fijar"}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <Pin className={cn("w-4 h-4", item.pinned ? "text-amber-500 fill-amber-500/20" : "text-slate-400 hover:text-amber-500")} />
            </button>

            <button 
              type="button"
              onClick={handleToggleRead}
              className="p-1 group/btn transition-transform hover:scale-110 hover:bg-slate-50 rounded-md"
              title={item.read ? "Marcar como no leído" : "Marcar como leído"}
              onPointerDown={(e) => e.stopPropagation()}
            >
               <CheckCircle2 className={cn("w-4 h-4", item.read ? "text-emerald-500 fill-emerald-500/20" : "text-slate-400 hover:text-emerald-500")} />
            </button>
          </div>

          <div className={cn("absolute bottom-3 right-3 flex gap-1 items-center transition-opacity z-20", item.pinned ? "opacity-100" : "opacity-0 group-hover:opacity-100")}>
              <button onClick={(e) => { e.stopPropagation(); onEdit(); }} className="p-1.5 text-slate-400 hover:text-[var(--primary)] hover:bg-slate-50 rounded-md transition-colors shadow-sm bg-white border border-slate-200/50" title="Editar">
                <Edit className="w-4 h-4" />
              </button>
              <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="p-1.5 text-slate-400 hover:text-rose-500 hover:bg-slate-50 rounded-md transition-colors shadow-sm shrink-0 bg-white border border-slate-200/50">
                <Trash2 className="w-4 h-4" />
              </button>
          </div>

          <div className="flex flex-col mt-auto w-full">
             {(cardSettings.showType || cardSettings.showPhysicalStatus) && (
               <div className="flex items-center justify-between mb-2">
                  <div className="flex gap-2 items-center">
                      {cardSettings.showType && item.type !== 'externa' && (
                        <span className="text-xs font-bold px-2 py-0.5 bg-[var(--bg-app)]/80 text-[var(--text-muted)] rounded uppercase tracking-wider backdrop-blur-sm border border-slate-200/50">{item.type}</span>
                      )}
                      {cardSettings.showPhysicalStatus && item.ownedPhysical && (
                        <span className="flex items-center gap-1 text-xs font-bold px-2 py-0.5 bg-[var(--bg-app)]/80 text-[var(--primary)] rounded uppercase tracking-wider backdrop-blur-sm border border-slate-200/50">
                          <BookIcon className="w-3 h-3" /> Libro físico
                        </span>
                      )}
                  </div>
               </div>
             )}
             
             {cardSettings.showProgress && (
               <div className="w-full flex items-center gap-2 mt-1" title={`Progreso: ${pValue}%`}>
                  <div className="flex-1 h-1.5 bg-slate-200/50 rounded-full overflow-hidden shadow-inner">
                     <div className={cn("h-full rounded-full transition-all duration-500", progState.color)} style={{ width: `${pValue}%` }} />
                  </div>
                  <span className={cn("text-xs font-bold w-14 text-right", progState.color.replace('bg-', 'text-'))}>{progState.text}</span>
               </div>
             )}
             {cardSettings.showRating && (
               <div className="flex items-center gap-1 mt-1.5" onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}>
                  {[1, 2, 3, 4, 5].map(star => (
                     <svg 
                        key={star} 
                        onClick={() => updateItem(item.id, { rating: item.rating === star ? 0 : star })}
                        className={cn("w-3.5 h-3.5 cursor-pointer transition-colors", (item.rating || 0) >= star ? "text-amber-400 fill-amber-400" : "text-slate-300 hover:text-amber-200")} 
                        xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"
                     ><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26"></polygon></svg>
                  ))}
               </div>
             )}
          </div>
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
           viewMode === 'grid-compact' ? "h-32" : "h-56"
        )}
        {...attributes} 
        {...listeners}
      >
        {item.thumbnailUrl ? (
          <img src={item.thumbnailUrl} alt={item.title} className="w-full h-full object-contain aspect-[4/5] drop-shadow-md rounded" draggable={false} />
        ) : (
          <div className="w-[85%] h-[90%] bg-gradient-to-br from-[#00558F] to-slate-800 rounded-md shadow-lg shadow-black/20 flex flex-col items-center justify-center p-4 relative overflow-hidden border border-white/10 before:absolute before:left-2 before:top-0 before:bottom-0 before:w-1 before:bg-black/20 before:shadow-[1px_0_2px_rgba(255,255,255,0.1)]">
             <BookIcon className="w-8 h-8 text-white/20 absolute bottom-4 right-4" />
             <div className="flex-1 w-full flex items-center justify-center">
                 <h4 className="text-center text-white/90 font-bold text-sm line-clamp-4 leading-snug drop-shadow-md px-2 relative z-10">{item.title}</h4>
             </div>
             {item.author && <p className="text-xs text-white/60 font-medium tracking-wide uppercase line-clamp-1 mt-auto pb-2 relative z-10">{item.author}</p>}
          </div>
        )}
        <button 
          onClick={(e) => { e.stopPropagation(); updateItem(item.id, { pinned: !item.pinned }); }} 
          className="absolute bottom-11 right-3 z-20 group/btn transition-transform hover:scale-110"
          title={item.pinned ? "Desfijar" : "Fijar"}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <Pin className={cn("w-6 h-6 drop-shadow-md", item.pinned ? "text-amber-400 fill-amber-400/20" : "text-white/80 hover:text-amber-400")} />
        </button>
        
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



        <button 
           type="button"
           onClick={handleToggleRead}
           className="absolute bottom-3 right-3 z-20 group/btn transition-transform hover:scale-110"
           title={item.read ? "Marcar como no leído" : "Marcar como leído"}
           onPointerDown={(e) => e.stopPropagation()}
        >
           <CheckCircle2 className={cn("w-6 h-6 drop-shadow-md", item.read ? "text-emerald-500 fill-emerald-500/20" : "text-white/80 hover:text-emerald-400")} />
        </button>
      </div>
      <div className="flex-1 p-4 flex flex-col justify-between relative bg-[var(--bg-card)] rounded-b-2xl">
         <div className="relative group/title">
            <div className="flex justify-between items-start mb-2 pr-6">
              <div className="flex flex-col">
                {cardSettings.showAuthor && <span className="text-xs font-bold text-[var(--primary)] truncate pr-2 hover:underline z-20 relative cursor-pointer" onClick={(e) => { e.stopPropagation(); onOpen(); }}>{item.author || 'Sin autor'}</span>}
                {cardSettings.showYear && item.year && <span className="text-xs text-[var(--text-muted)] mt-0.5">{item.year}</span>}
              </div>
              
              <div className="flex gap-1 shrink-0 px-2 py-0.5 rounded overflow-hidden">
                {item.folderIds.length > 0 && <div className="w-2 h-2 rounded-full bg-[var(--secondary)]" />}
              </div>
            </div>
            <h3 onClick={onOpen} className="text-sm font-bold text-[var(--text-main)] leading-tight mb-2 cursor-pointer hover:text-[var(--primary)] line-clamp-2 pr-6">{item.title}</h3>

            <div className="absolute right-0 top-0 flex flex-col gap-1">
                <button onClick={(e) => { e.stopPropagation(); onEdit(); }} className="p-1.5 text-[var(--text-muted)] hover:text-[var(--primary)] hover:bg-[var(--bg-app)] rounded-md opacity-0 group-hover/title:opacity-100 transition-opacity z-20 shadow-sm" title="Editar">
                    <Edit className="w-4 h-4" />
                </button>
            </div>
         </div>
         <div className="flex justify-between items-center mt-auto h-6">
            <div className="flex items-center gap-3 text-[11px] text-[var(--text-muted)]">
               {cardSettings.showType && item.type !== 'externa' && <span className="flex items-center gap-1 uppercase font-bold"><FileText className="w-3 h-3" /> {item.type}</span>}
               {cardSettings.showPhysicalStatus && item.ownedPhysical && <span className="flex items-center gap-1 text-[var(--primary)] uppercase font-bold"><BookIcon className="w-3 h-3" /> Físico</span>}
            </div>
            <div className="flex items-center gap-1 translate-y-1 opacity-0 group-hover:opacity-100 transition-all z-20 relative bg-[var(--bg-app)]/80 p-0.5 rounded shadow-sm backdrop-blur-sm border border-slate-200/50">
               <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="p-1 text-slate-500 hover:text-rose-500 hover:bg-[var(--bg-app)] rounded transition-colors">
                 <Trash2 className="w-4 h-4" />
               </button>
            </div>
         </div>

          {cardSettings.showProgress && (
            <div className="w-full flex items-center gap-2 mt-2" title={`Progreso: ${pValue}%`}>
               <div className="flex-1 h-1.5 bg-slate-200/50 rounded-full overflow-hidden shadow-inner">
                  <div className={cn("h-full rounded-full transition-all duration-500", progState.color)} style={{ width: `${pValue}%` }} />
               </div>
               <span className={cn("text-xs font-bold w-14 text-right", progState.color.replace('bg-', 'text-'))}>{progState.text}</span>
            </div>
          )}
          {cardSettings.showRating && (
            <div className="flex items-center gap-1 mt-2" onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}>
               {[1, 2, 3, 4, 5].map(star => (
                  <svg 
                     key={star} 
                     onClick={() => updateItem(item.id, { rating: item.rating === star ? 0 : star })}
                     className={cn("w-3.5 h-3.5 cursor-pointer transition-colors", (item.rating || 0) >= star ? "text-amber-400 fill-amber-400" : "text-slate-300 hover:text-amber-200")} 
                     xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"
                  ><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26"></polygon></svg>
               ))}
            </div>
          )}
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
    if (category === 'destacados') {
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

  const strategy = (viewMode === 'grid' || viewMode === 'grid-compact') ? rectSortingStrategy : verticalListSortingStrategy;

  return (
      <>
      <SortableContext 
        items={filteredItems.map(i => i.id)}
        strategy={strategy}
      >
        <div className={cn(
          "w-full",
          (viewMode === 'grid' || viewMode === 'grid-compact') 
            ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-6" 
            : "grid grid-cols-1 lg:grid-cols-2 gap-4",
          viewMode === 'grid-compact' && "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3",
          viewMode === 'list' && "grid-cols-1 lg:grid-cols-2"
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
