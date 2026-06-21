// =============================================================================
// Sidebar.tsx — Navegación lateral
// -----------------------------------------------------------------------------
// Estructura de secciones (de arriba a abajo):
//   - Colección Global    → "Todos los recursos" + categorías dinámicas.
//   - Tapas Históricas    → agrupador por siglo romano (XV, XVI, XVII...).
//   - Índice por Título   → A–Z (filtra por inicial del título).
//   - Índice por Autor    → A–Z (filtra por inicial del autor).
//   - Destacados / Físico / Digital / Análisis → vistas especiales.
//   - Filtros Avanzados   → selects año/tag/autor/materia/leído/deseado.
//   - Etapas Históricas   → stages fijos (Prehistoria → Edad Contemporánea).
//   - Mis Listas          → playlists creadas por el usuario (drag-target DnD).
//
// Los "ids droppables" para drag & drop usan el prefijo "playlist-<id>"
// (ver DroppablePlaylist y Dashboard.handleDragEnd).
// =============================================================================

import { Library, Folder, Plus, Edit2, Trash2, X, Check, ChevronDown, ChevronRight, Pin, BarChart2, LayoutGrid, GalleryVerticalEnd, List, Settings, BookOpen, Newspaper, FileText, Book, Laptop, Layers, ShieldCheck, ArrowDownUp, LogOut, Star, Hourglass, CheckCheck } from 'lucide-react';
import { useLibrary } from '../hooks/useLibrary';
import { useState, FormEvent } from 'react';
import { cn, colorSwatchProps, getOrderedNavSections } from '../lib/utils';
import { PlaylistData, NavSectionId } from '../types';
import { useDroppable } from '@dnd-kit/core';

const getCategoryIcon = (name: string) => {
  const normalized = name.toLowerCase();
  if (normalized.includes('libro')) return BookOpen;
  if (normalized.includes('revista')) return Newspaper;
  if (normalized.includes('artículo') || normalized.includes('articulo')) return FileText;
  return Folder;
};

interface SidebarProps {
  activeTab: string;
  setActiveTab: (t: string) => void;
  activePlaylist: string | null;
  setActivePlaylist: (id: string | null) => void;
  activeStage: string | null;
  setActiveStage: (id: string | null) => void;
  filters: any;
  setFilters: (f: any) => void;
  viewMode?: 'covers' | 'grid' | 'grid-compact' | 'list';
  setViewMode?: (mode: 'covers' | 'grid' | 'grid-compact' | 'list') => void;
  collapsed?: boolean;
  setCollapsed?: (c: boolean) => void;
  onOpenSettings?: () => void;
  onOpenAdmin?: () => void;
  onClose?: () => void;
  user?: { name: string; email: string; photo: string };
}

const DroppablePlaylist = ({ pl, activePlaylist, setActivePlaylist, setActiveStage, startEdit, deletePlaylist }: any) => {
  const { setNodeRef, isOver } = useDroppable({
    id: `playlist-${pl.id}`,
    data: { type: 'playlist', id: pl.id }
  });

  return (
    <div ref={setNodeRef} className={cn("flex items-center pr-2 rounded-lg transition-colors border", isOver ? "bg-[#A0CFEB]/20 border-[#A0CFEB]" : "border-transparent", activePlaylist === pl.id ? "bg-white/10" : "")}>
      <button
        onClick={() => { setActivePlaylist(pl.id); setActiveStage(null); }}
        className={cn(
          "flex-1 flex items-center gap-3 px-3 py-2 rounded-lg transition-all",
          activePlaylist === pl.id ? "text-white font-medium" : "text-white/80 hover:bg-white/5 font-medium"
        )}
      >
        <div className={cn("w-2 h-2 rounded-full flex-shrink-0", colorSwatchProps(pl.color).className)} style={colorSwatchProps(pl.color).style} />
        <span className="truncate text-sm opacity-80 group-hover:opacity-100">{pl.name}</span>
      </button>
      <div className="hidden group-hover:flex items-center gap-1">
        <button onClick={() => startEdit(pl)} className="p-1 text-white/40 hover:text-white rounded-md hover:bg-white/10 transition-colors">
          <Edit2 className="w-3 h-3" />
        </button>
        <button onClick={() => deletePlaylist(pl.id)} className="p-1 text-white/40 hover:text-rose-400 rounded-md hover:bg-rose-500/20 transition-colors">
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
};

// Íconos por sección de navegación (los ids/labels/orden viven en getOrderedNavSections).
const NAV_SECTION_ICONS: Record<NavSectionId, typeof Star> = {
  favoritos: Star,
  leidos: CheckCheck,
  porleer: Hourglass,
  destacados: Pin,
  fisico: Book,
  digital: Laptop,
};

const THEME_COLORS = [
  'bg-[#00558F]',
  'bg-[#A0CFEB]',
  'bg-[#FFA300]',
  'bg-emerald-500',
  'bg-rose-500',
  'bg-indigo-500',
  'bg-slate-800'
];

export function Sidebar({ activeTab, setActiveTab, activePlaylist, setActivePlaylist, activeStage, setActiveStage, filters, setFilters, viewMode, setViewMode, collapsed, setCollapsed, onOpenSettings, onOpenAdmin, onClose, user }: SidebarProps) {
  const { playlists, stages, categories, addPlaylist, updatePlaylist, deletePlaylist, items, sortBy, setSortBy, cardSettings } = useLibrary();
  const [isCreating, setIsCreating] = useState(false);
  const [isCategoriesExpanded, setIsCategoriesExpanded] = useState(false);
  const [isFiltersExpanded, setIsFiltersExpanded] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [newPlaylistColor, setNewPlaylistColor] = useState(THEME_COLORS[0]);
  
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('');

  const [isAlphabeticTitleExpanded, setIsAlphabeticTitleExpanded] = useState(false);
  const [isAlphabeticAuthorExpanded, setIsAlphabeticAuthorExpanded] = useState(false);
  const [isEtapasExpanded, setIsEtapasExpanded] = useState(false);
  const [isMisListasExpanded, setIsMisListasExpanded] = useState(false);

  const years = Array.from(new Set(items.map(i => i.year).filter(Boolean))) as string[];
  const authors = Array.from(new Set(items.map(i => i.author).filter(Boolean))) as string[];
  const subjects = Array.from(new Set(items.map(i => i.subject).filter(Boolean))) as string[];

  const titleInitials = Array.from(new Set(items.map(i => i.title?.[0]?.toUpperCase()).filter(c => c && /[A-Z0-9]/.test(c)))).sort();
  const authorInitials = Array.from(new Set(items.map(i => i.author?.[0]?.toUpperCase()).filter(c => c && /[A-Z0-9]/.test(c)))).sort();

  const handleCreateSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!newPlaylistName.trim()) return;
    addPlaylist({ name: newPlaylistName, color: newPlaylistColor });
    setIsCreating(false);
    setNewPlaylistName('');
  };

  const startEdit = (p: PlaylistData) => {
    setEditingId(p.id);
    setEditName(p.name);
    setEditColor(p.color);
  };

  const handleEditSubmit = (e: FormEvent, id: string) => {
    e.preventDefault();
    if (!editName.trim()) return;
    updatePlaylist(id, { name: editName, color: editColor });
    setEditingId(null);
  };

  return (
    <aside className={cn("bg-[var(--sidebar-bg)] text-white shadow-xl h-full w-full flex flex-col overflow-y-auto z-20 sidebar-scrollbar transition-all duration-300")} style={{ direction: 'rtl' }}>
      <div className="flex-1 w-full" style={{ direction: 'ltr' }}>
      <div className={cn("p-6 border-b border-white/10 relative group", collapsed ? "p-3 pt-6" : "p-6")}>
        {onClose && (
          <button
            onClick={onClose}
            className="lg:hidden absolute right-4 top-4 p-2 rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        )}
        <div className={cn("flex items-center mb-6", collapsed ? "justify-center mt-6" : "gap-3")}>
          <img src="/logo.png" alt="Biblioteca" className="w-10 h-10 rounded-lg shrink-0 object-cover shadow-sm" />
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <h1 className="text-sm font-extrabold tracking-tight uppercase leading-none truncate">Biblioteca</h1>
              <span className="text-[10px] opacity-70 uppercase tracking-widest">Personal</span>
            </div>
          )}
          {setCollapsed && (
            <button
              onClick={() => setCollapsed(!collapsed)}
              className={cn("hidden lg:block p-1.5 rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-colors shrink-0", !collapsed && "opacity-0 group-hover:opacity-100", collapsed && "mx-auto")}
            >
              {collapsed ? <ChevronRight className="w-5 h-5" /> : <ChevronRight className="w-5 h-5 rotate-180" />}
            </button>
          )}
        </div>

        {viewMode && setViewMode && !collapsed && (
          <>
            {/* Mobile view toggles */}
            <div className="lg:hidden grid grid-cols-2 gap-1 bg-white/5 border border-white/10 p-1 rounded-xl mb-6">
             <button
                onClick={() => setViewMode('covers')}
                className={cn("py-2.5 flex items-center justify-center gap-2 rounded-lg transition-colors text-xs font-bold", viewMode === 'covers' ? "bg-white/10 text-white" : "text-white/50 hover:text-white")}
             >
                <GalleryVerticalEnd className="w-4 h-4 shrink-0" />
                Portadas
             </button>
             <button
                onClick={() => setViewMode('list')}
                className={cn("py-2.5 flex items-center justify-center gap-2 rounded-lg transition-colors text-xs font-bold", viewMode === 'list' ? "bg-white/10 text-white" : "text-white/50 hover:text-white")}
             >
                <List className="w-4 h-4 shrink-0" />
                Lista
             </button>
             <button
                onClick={() => setViewMode('grid')}
                className={cn("py-2.5 flex items-center justify-center gap-2 rounded-lg transition-colors text-xs font-bold", viewMode === 'grid' ? "bg-white/10 text-white" : "text-white/50 hover:text-white")}
             >
                <div className="w-4 h-4 grid grid-cols-1 gap-0.5 shrink-0"><div className="bg-current rounded-[1px]"></div><div className="bg-current rounded-[1px]"></div></div>
                1 Columna
             </button>
             <button
                onClick={() => setViewMode('grid-compact')}
                className={cn("py-2.5 flex items-center justify-center gap-2 rounded-lg transition-colors text-xs font-bold", viewMode === 'grid-compact' ? "bg-white/10 text-white" : "text-white/50 hover:text-white")}
             >
                <LayoutGrid className="w-4 h-4 shrink-0" />
                2 Columnas
             </button>
           </div>
          </>
        )}

        {!collapsed && <h2 className="text-[10px] font-bold text-white/50 uppercase tracking-widest mb-3 ml-2">Colección Global</h2>}
        <button
          onClick={() => { setActiveTab('todos'); setActivePlaylist(null); setActiveStage(null); }}
          className={cn(
            "flex items-center gap-3 px-3 py-2 rounded-lg transition-colors w-full",
            collapsed ? "justify-center" : "",
            activeTab === 'todos' && !activePlaylist && !activeStage ? "bg-white/10 text-white font-medium" : "text-white/80 hover:bg-white/5 font-medium"
          )}
          title={collapsed ? "Todos los recursos" : undefined}
        >
          <Library className="w-5 h-5 opacity-80 shrink-0" />
          {!collapsed && <span className="text-sm font-bold">Todos los recursos</span>}
        </button>

        <div className={cn("space-y-1 mt-1.5 mb-3", !collapsed ? "pl-4 border-l border-white/5 ml-3.5" : "")}>
          {categories.filter(cat => !cat.hidden).map(cat => {
            const CatIcon = getCategoryIcon(cat.name);
            const isSelected = activeTab === cat.id && !activePlaylist && !activeStage;
            return (
              <button
                key={cat.id}
                onClick={() => { setActiveTab(cat.id); setActivePlaylist(null); setActiveStage(null); }}
                className={cn(
                  "flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg transition-all w-full",
                  collapsed ? "justify-center pl-1 pr-1" : "",
                  isSelected 
                    ? "bg-white/15 text-white font-semibold shadow-sm" 
                    : "text-white/75 hover:bg-white/5 hover:text-white text-xs font-medium"
                )}
                title={collapsed ? cat.name : undefined}
              >
                <CatIcon className="w-4 h-4 opacity-75 shrink-0" />
                {!collapsed && <span className="truncate text-xs">{cat.name}</span>}
              </button>
            );
          })}
        </div>

        {!collapsed && (
          <>
        <div className="flex items-center justify-between mt-4 mb-2 ml-2">
           <h2 className="text-[10px] font-bold text-white/50 uppercase tracking-widest cursor-pointer hover:text-white transition-colors" onClick={() => setIsAlphabeticTitleExpanded(!isAlphabeticTitleExpanded)}>
              Índice por Título
           </h2>
           <button onClick={() => setIsAlphabeticTitleExpanded(!isAlphabeticTitleExpanded)} className="text-white/50 hover:text-white">
              {isAlphabeticTitleExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
           </button>
        </div>
        {isAlphabeticTitleExpanded && (
          <div className="flex flex-wrap gap-1 mb-4 ml-2 px-2">
             <button
               onClick={() => { setActiveTab('todos'); setFilters({...filters, titleInitial: '', year: '', authorInitial: ''}); }}
               className={cn("w-6 h-6 rounded flex items-center justify-center text-[10px] font-bold transition-all", !filters.titleInitial ? "bg-white text-[#00558F]" : "bg-white/10 hover:bg-white/20 text-white")}
             >
               *
             </button>
             {titleInitials.map(letter => (
                <button
                  key={letter}
                  onClick={() => { setActiveTab('todos'); setActivePlaylist(null); setActiveStage(null); setFilters({...filters, titleInitial: letter, year: '', authorInitial: ''}); }}
                  className={cn("w-6 h-6 rounded flex items-center justify-center text-[10px] font-bold transition-all", filters.titleInitial === letter ? "bg-white text-[#00558F]" : "bg-white/10 hover:bg-white/20 text-white")}
                >
                  {letter}
                </button>
             ))}
          </div>
        )}

        <div className="flex items-center justify-between mt-4 mb-2 ml-2">
           <h2 className="text-[10px] font-bold text-white/50 uppercase tracking-widest cursor-pointer hover:text-white transition-colors" onClick={() => setIsAlphabeticAuthorExpanded(!isAlphabeticAuthorExpanded)}>
              Índice por Autor
           </h2>
           <button onClick={() => setIsAlphabeticAuthorExpanded(!isAlphabeticAuthorExpanded)} className="text-white/50 hover:text-white">
              {isAlphabeticAuthorExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
           </button>
        </div>
        {isAlphabeticAuthorExpanded && (
          <div className="flex flex-wrap gap-1 mb-4 ml-2 px-2">
             <button
               onClick={() => { setActiveTab('todos'); setFilters({...filters, titleInitial: '', year: '', authorInitial: ''}); }}
               className={cn("w-6 h-6 rounded flex items-center justify-center text-[10px] font-bold transition-all", !filters.authorInitial ? "bg-white text-[#00558F]" : "bg-white/10 hover:bg-white/20 text-white")}
             >
               *
             </button>
             {authorInitials.map(letter => (
                <button
                  key={letter}
                  onClick={() => { setActiveTab('todos'); setActivePlaylist(null); setActiveStage(null); setFilters({...filters, authorInitial: letter, titleInitial: '', year: ''}); }}
                  className={cn("w-6 h-6 rounded flex items-center justify-center text-[10px] font-bold transition-all", filters.authorInitial === letter ? "bg-white text-[#00558F]" : "bg-white/10 hover:bg-white/20 text-white")}
                >
                  {letter}
                </button>
             ))}
          </div>
        )}
        </>
        )}

        <ul className={cn("space-y-1 mt-4 border-t border-white/10 pt-4", collapsed ? "px-0 border-t-0 mt-2" : "")}>
          {getOrderedNavSections(cardSettings).filter(s => s.show).map(({ id, label }) => {
            const Icon = NAV_SECTION_ICONS[id];
            return (
              <li key={id}>
                 <button
                   onClick={() => { setActiveTab(id); setActivePlaylist(null); setActiveStage(null); }}
                   className={cn(
                     "flex items-center gap-3 px-3 py-2 rounded-lg transition-colors w-full",
                     collapsed ? "justify-center" : "",
                     activeTab === id ? "bg-white/10 text-white font-medium" : "text-white/80 hover:bg-white/5 font-medium"
                   )}
                   title={collapsed ? label : undefined}
                 >
                   <Icon className="w-5 h-5 opacity-80 shrink-0" />
                   {!collapsed && <span className="truncate text-sm">{label}</span>}
                 </button>
              </li>
            );
          })}
        </ul>
      </div>

      {!collapsed && (
        <>
        <div className="px-6 py-6 pb-2 border-b border-white/10">
          <div className="flex items-center justify-between mb-3 ml-2">
             <h2 className="text-[10px] font-bold text-white/50 uppercase tracking-widest cursor-pointer hover:text-white transition-colors" onClick={() => setIsFiltersExpanded(!isFiltersExpanded)}>
                Filtros Avanzados
             </h2>
             <button onClick={() => setIsFiltersExpanded(!isFiltersExpanded)} className="text-white/50 hover:text-white">
                {isFiltersExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
             </button>
          </div>
          {isFiltersExpanded && (
            <div className="flex flex-col gap-2">
             <select className="text-xs border border-white/20 rounded bg-white/10 text-white px-3 py-2 w-full focus:ring-[#A0CFEB] focus:outline-none appearance-none" value={filters.year} onChange={(e) => setFilters({...filters, year: e.target.value})}>
                <option value="" className="text-slate-800">Año (Todos)</option>
                {years.map(y => <option key={y} value={y} className="text-slate-800">{y}</option>)}
             </select>
             <select className="text-xs border border-white/20 rounded bg-white/10 text-white px-3 py-2 w-full focus:ring-[#A0CFEB] focus:outline-none appearance-none" value={filters.author} onChange={(e) => setFilters({...filters, author: e.target.value})}>
                <option value="" className="text-slate-800">Autor (Todos)</option>
                {authors.map(a => <option key={a} value={a} className="text-slate-800">{a}</option>)}
             </select>
             <select className="text-xs border border-white/20 rounded bg-white/10 text-white px-3 py-2 w-full focus:ring-[#A0CFEB] focus:outline-none appearance-none" value={filters.subject} onChange={(e) => setFilters({...filters, subject: e.target.value})}>
                <option value="" className="text-slate-800">Materia (Todas)</option>
                {subjects.map(s => <option key={s} value={s} className="text-slate-800">{s}</option>)}
             </select>
             <div className="flex gap-2">
                <select className="text-xs border border-white/20 rounded bg-white/10 text-white px-2 py-2 w-1/2 min-w-0 focus:ring-[#A0CFEB] focus:outline-none appearance-none" value={filters.read} onChange={(e) => setFilters({...filters, read: e.target.value})}>
                   <option value="" className="text-slate-800">Leídos</option>
                   <option value="true" className="text-slate-800">Sí</option>
                   <option value="false" className="text-slate-800">No</option>
                </select>
                <select className="text-xs border border-white/20 rounded bg-white/10 text-white px-2 py-2 w-1/2 min-w-0 focus:ring-[#A0CFEB] focus:outline-none appearance-none" value={filters.toBuy} onChange={(e) => setFilters({...filters, toBuy: e.target.value})}>
                   <option value="" className="text-slate-800">Deseados</option>
                   <option value="true" className="text-slate-800">Sí</option>
                   <option value="false" className="text-slate-800">No</option>
                </select>
             </div>
            </div>
          )}
        </div>

        <div className="px-6 py-4 pb-2 border-b border-white/10">
          <div className="flex items-center justify-between mb-2 ml-2">
             <h2 className="text-[10px] font-bold text-white/50 uppercase tracking-widest cursor-pointer hover:text-white transition-colors" onClick={() => setIsEtapasExpanded(!isEtapasExpanded)}>
                Etapas Históricas
             </h2>
             <button onClick={() => setIsEtapasExpanded(!isEtapasExpanded)} className="text-white/50 hover:text-white">
                {isEtapasExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
             </button>
          </div>
          {isEtapasExpanded && (
          <ul className="space-y-1 mb-2">
            {stages.map(stage => (
              <li key={stage.id}>
                <button
                  onClick={() => { setActiveStage(stage.id); setActivePlaylist(null); }}
                  className={cn(
                    "flex items-center w-full gap-3 px-3 py-2 rounded-lg transition-colors",
                    activeStage === stage.id ? "bg-white/10 text-white font-medium" : "text-white/80 hover:bg-white/5 font-medium"
                  )}
                >
                  <Layers className="w-4 h-4 opacity-80" />
                  <span className="truncate text-sm">{stage.name}</span>
                </button>
              </li>
            ))}
          </ul>
          )}
        </div>

        <div className="px-6 flex-1 pb-6 mt-4">
          <div className="flex items-center justify-between mb-2 ml-2">
             <h2 className="text-[10px] font-bold text-white/50 uppercase tracking-widest cursor-pointer hover:text-white transition-colors" onClick={() => setIsMisListasExpanded(!isMisListasExpanded)}>
                Mis Listas
             </h2>
             <div className="flex items-center gap-2">
               <button onClick={() => { setIsMisListasExpanded(true); setIsCreating(true); }} className="hover:text-[#FFA300] transition-colors text-white/50">
                 <Plus className="w-4 h-4" />
               </button>
               <button onClick={() => setIsMisListasExpanded(!isMisListasExpanded)} className="text-white/50 hover:text-white">
                  {isMisListasExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
               </button>
             </div>
          </div>

          {isMisListasExpanded && (
          <>
          {isCreating && (
            <form onSubmit={handleCreateSubmit} className="mb-4 bg-white/5 p-3 rounded-lg border border-white/10">
              <input 
                autoFocus
                type="text" 
                placeholder="Nueva carpeta..." 
                value={newPlaylistName}
                onChange={(e) => setNewPlaylistName(e.target.value)}
                className="w-full text-sm p-2 rounded border border-white/20 bg-white/10 text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-[#A0CFEB] mb-3"
              />
              <div className="flex gap-1 mb-3 items-center">
                {THEME_COLORS.map(color => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setNewPlaylistColor(color)}
                    className={cn("w-5 h-5 rounded-full ring-offset-1 ring-offset-[#00558F] transition-all", color, newPlaylistColor === color ? 'ring-2 ring-white scale-110' : '')}
                  />
                ))}
                <label
                  title="Elegir color personalizado"
                  className={cn("relative w-5 h-5 rounded-full ring-offset-1 ring-offset-[#00558F] transition-all cursor-pointer overflow-hidden border border-white/30", !THEME_COLORS.includes(newPlaylistColor) ? 'ring-2 ring-white scale-110' : '')}
                  style={!THEME_COLORS.includes(newPlaylistColor) ? { backgroundColor: newPlaylistColor } : { background: 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)' }}
                >
                  <input
                    type="color"
                    value={!THEME_COLORS.includes(newPlaylistColor) ? newPlaylistColor : '#ffffff'}
                    onChange={(e) => setNewPlaylistColor(e.target.value)}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                </label>
              </div>
              <div className="flex gap-2 justify-end">
                <button type="button" onClick={() => setIsCreating(false)} className="text-xs text-white/60 px-2 py-1 hover:bg-white/10 rounded">Cancelar</button>
                <button type="submit" className="text-xs bg-[#FFA300] text-white px-3 py-1 rounded font-medium hover:bg-[#e69300] transition-colors">Crear</button>
              </div>
            </form>
          )}

          <ul className="space-y-1">
            {playlists.map(pl => (
              <li key={pl.id} className="group relative">
                {editingId === pl.id ? (
                  <form onSubmit={(e) => handleEditSubmit(e, pl.id)} className="bg-white/5 p-2 rounded-lg border border-white/10">
                     <input 
                      autoFocus
                      type="text" 
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="w-full text-sm p-1 rounded border border-white/20 bg-white/10 text-white focus:outline-none mb-2"
                    />
                     <div className="flex gap-1 mb-2 items-center">
                      {THEME_COLORS.map(color => (
                        <button
                          key={color}
                          type="button"
                          onClick={() => setEditColor(color)}
                          className={cn("w-4 h-4 rounded-full ring-offset-1 ring-offset-[#00558F]", color, editColor === color ? 'ring-2 ring-white' : '')}
                        />
                      ))}
                      <label
                        title="Elegir color personalizado"
                        className={cn("relative w-4 h-4 rounded-full ring-offset-1 ring-offset-[#00558F] cursor-pointer overflow-hidden border border-white/30", !THEME_COLORS.includes(editColor) ? 'ring-2 ring-white' : '')}
                        style={!THEME_COLORS.includes(editColor) ? { backgroundColor: editColor } : { background: 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)' }}
                      >
                        <input
                          type="color"
                          value={!THEME_COLORS.includes(editColor) ? editColor : '#ffffff'}
                          onChange={(e) => setEditColor(e.target.value)}
                          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                        />
                      </label>
                    </div>
                    <div className="flex gap-1 justify-end">
                      <button type="button" onClick={() => setEditingId(null)} className="p-1 hover:bg-white/10 rounded text-white/60"><X className="w-3 h-3" /></button>
                      <button type="submit" className="p-1 hover:bg-white/10 rounded text-emerald-400"><Check className="w-3 h-3" /></button>
                    </div>
                  </form>
                ) : (
                  <DroppablePlaylist pl={pl} activePlaylist={activePlaylist} setActivePlaylist={setActivePlaylist} setActiveStage={setActiveStage} startEdit={startEdit} deletePlaylist={deletePlaylist} />
                )}
              </li>
            ))}
          </ul>
          </>
          )}
        </div>
        </>
      )}

      {/* Bottom Actions & Storage Indicator */}
      <div className="mt-auto px-6 pb-6 pt-4 space-y-2">
      {/* Ordenar por (solo móvil; en escritorio vive en la barra superior) */}
      {!collapsed && (
        <label className="lg:hidden flex items-center gap-3 px-3 py-2 rounded-lg text-white/80">
          <ArrowDownUp className="w-5 h-5 opacity-80 shrink-0" />
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="flex-1 text-sm font-medium bg-white/10 border border-white/20 rounded-lg px-2 py-1.5 text-white focus:outline-none focus:ring-2 focus:ring-[#A0CFEB] appearance-none"
          >
            <option value="manual" className="text-slate-800">Orden Manual</option>
            <option value="recent" className="text-slate-800">Más recientes</option>
            <option value="oldest" className="text-slate-800">Más antiguos</option>
            <option value="alpha" className="text-slate-800">Alfabético</option>
          </select>
        </label>
      )}
      {/* Análisis (movido a la zona inferior, cerca de Papelera/Ajustes) */}
      <button
        onClick={() => { setActiveTab('analytics'); setActivePlaylist(null); setActiveStage(null); }}
        className={cn(
          "flex items-center gap-3 px-3 py-2 rounded-lg transition-colors w-full",
          collapsed ? "justify-center" : "",
          activeTab === 'analytics' ? "bg-white/10 text-white font-medium" : "text-white/80 hover:bg-white/5 hover:text-white font-medium"
        )}
        title={collapsed ? "Análisis" : undefined}
      >
        <BarChart2 className="w-5 h-5 opacity-80 shrink-0" />
        {!collapsed && <span className="truncate text-sm">Análisis</span>}
      </button>

      {/* Botón de Papelera */}
      <button
        onClick={() => { setActiveTab('trash'); setActivePlaylist(null); setActiveStage(null); }}
        className={cn(
          "flex items-center gap-3 px-3 py-2 rounded-lg transition-colors w-full",
          collapsed ? "justify-center" : "",
          activeTab === 'trash' ? "bg-white/10 text-white font-medium" : "text-white/80 hover:bg-white/5 hover:text-white font-medium"
        )}
        title={collapsed ? "Papelera" : undefined}
      >
        <Trash2 className="w-5 h-5 opacity-80 shrink-0" />
        {!collapsed && <span className="truncate text-sm">Papelera</span>}
      </button>

      {onOpenAdmin && (
         <button
           onClick={onOpenAdmin}
           className={cn(
             "flex items-center gap-3 px-3 py-2 rounded-lg transition-colors w-full",
             collapsed ? "justify-center" : "",
             "text-white/80 hover:bg-white/5 hover:text-white font-medium"
           )}
           title={collapsed ? "Administración" : undefined}
         >
           <ShieldCheck className="w-5 h-5 opacity-80 shrink-0" />
           {!collapsed && <span className="truncate text-sm">Administración</span>}
         </button>
      )}
      {onOpenSettings && (
         <button
           onClick={onOpenSettings}
           className={cn(
             "flex items-center gap-3 px-3 py-2 rounded-lg transition-colors w-full",
             collapsed ? "justify-center" : "",
             "text-white/80 hover:bg-white/5 hover:text-white font-medium"
           )}
           title={collapsed ? "Ajustes" : undefined}
         >
           <Settings className="w-5 h-5 opacity-80 shrink-0" />
           {!collapsed && <span className="truncate text-sm">Ajustes</span>}
         </button>
      )}
      {/* Cerrar sesión (solo móvil; en escritorio vive en la barra superior) */}
      {user && (
        <a
          href="/auth/logout"
          title="Cerrar sesión"
          className={cn(
            "lg:hidden flex items-center gap-3 px-3 py-2 rounded-lg transition-colors w-full text-rose-300 hover:bg-rose-500/15 hover:text-rose-200 font-medium",
            collapsed ? "justify-center" : ""
          )}
        >
          <LogOut className="w-5 h-5 opacity-80 shrink-0" />
          {!collapsed && <span className="truncate text-sm">Cerrar sesión</span>}
        </a>
      )}
      {!collapsed && (
        <div className="bg-white/5 p-4 rounded-xl border border-white/10">
          <p className="text-[11px] opacity-60 leading-tight mb-2">Almacenamiento Local</p>
          <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
            <div className="h-full bg-[#FFA300] w-[65%]"></div>
          </div>
          <p className="text-[10px] mt-2 text-right opacity-60">1.2 GB / 2.0 GB</p>
        </div>
      )}
      </div>
      </div>
    </aside>
  );
}
