import { Book, Globe, UploadCloud, Link as LinkIcon, LayoutGrid, Grid3x3, GalleryVerticalEnd, List as ListIcon, Save, Search, Settings, Settings2, X, Menu, LogOut, Maximize, Minimize } from 'lucide-react';
import React, { useState, useEffect, useCallback } from 'react';
import { useLibrary } from '../hooks/useLibrary';
import { cn } from '../lib/utils';
import { AddManualModal } from './AddManualModal';
import { SettingsModal } from './SettingsModal';
import { SettingRow, type KanbanCardSettings } from './KanbanBoard';

interface ToolbarProps {
  onOpenSidebar?: () => void;
  activeTab: string;
  setActiveTab: (cat: string) => void;
  viewMode: 'covers' | 'grid' | 'grid-compact' | 'list';
  setViewMode: (mode: 'covers' | 'grid' | 'grid-compact' | 'list') => void;
  sortBy: 'manual' | 'recent' | 'oldest' | 'alpha';
  setSortBy: (sort: 'manual' | 'recent' | 'oldest' | 'alpha') => void;
  filters: any;
  setFilters: (filters: any) => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  onOpenAddManual: () => void;
  user?: { name: string; email: string; photo: string };
  // Configuración de tarjetas del Tablero Kanban: el botón/panel vive aquí
  // (botonera superior), pero el estado en sí lo posee Dashboard (lo
  // consume también KanbanBoard). Solo se muestra con activeTab==='kanban'.
  kanbanCardSettings?: KanbanCardSettings;
  setKanbanCardSettings?: (updater: (prev: KanbanCardSettings) => KanbanCardSettings) => void;
}

export function Toolbar({ onOpenSidebar, activeTab, setActiveTab, viewMode, setViewMode, sortBy, setSortBy, filters, setFilters, searchQuery, setSearchQuery, onOpenAddManual, user, kanbanCardSettings, setKanbanCardSettings }: ToolbarProps) {
  const [showSettings, setShowSettings] = useState(false);
  const [showKanbanSettings, setShowKanbanSettings] = useState(false);
  const [isAppFullscreen, setIsAppFullscreen] = useState(false);
  const { addItem, items } = useLibrary();

  const toggleKanbanSetting = (key: keyof KanbanCardSettings) => {
    setKanbanCardSettings?.((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // Pantalla completa REAL del navegador (Fullscreen API) para toda la app.
  // Debe dispararse desde un gesto del usuario (click).
  const toggleAppFullscreen = useCallback(() => {
    const doc: any = document;
    const docEl: any = document.documentElement;
    const isFs = !!(doc.fullscreenElement || doc.webkitFullscreenElement);
    if (!isFs) {
      const req = docEl.requestFullscreen || docEl.webkitRequestFullscreen || docEl.msRequestFullscreen;
      if (req) Promise.resolve(req.call(docEl)).catch(() => {});
    } else {
      const exit = doc.exitFullscreen || doc.webkitExitFullscreen || doc.msExitFullscreen;
      if (exit) Promise.resolve(exit.call(doc)).catch(() => {});
    }
  }, []);

  // Sincroniza el ícono si el usuario sale del fullscreen con Esc o gesto del sistema.
  useEffect(() => {
    const onFsChange = () => {
      const doc: any = document;
      setIsAppFullscreen(!!(doc.fullscreenElement || doc.webkitFullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange as any);
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      document.removeEventListener('webkitfullscreenchange', onFsChange as any);
    };
  }, []);

  // Create suggestions for search
  const suggestions = Array.from(new Set(items.flatMap(i => [i.title, i.author, i.subject]))).filter(Boolean);

  return (
    <>
      <div className="flex flex-col gap-4 w-full border-b border-white/10 lg:border-slate-200/50 relative z-10 shrink-0 lg:bg-transparent bg-[var(--sidebar-bg)] sticky top-0">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4 px-4 md:px-6 lg:px-8 py-3 lg:py-4">

          <div className="flex-1 w-full flex items-center gap-2">
             {onOpenSidebar && (
               <button
                 className="lg:hidden p-2.5 text-white/70 hover:bg-white/10 rounded-lg shrink-0 transition-colors -ml-2"
                 onClick={onOpenSidebar}
               >
                 <Menu className="w-7 h-7" />
               </button>
             )}
             <div className="flex items-center w-full max-w-2xl relative group">
               <Search className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-white/50 lg:text-slate-400 group-focus-within:text-[var(--primary)] transition-colors" />
               <input
                 type="text"
                 value={searchQuery}
                 onChange={(e) => setSearchQuery(e.target.value)}
                 placeholder="Buscar títulos, autores, materias o etiquetas..."
                 list="search-suggestions"
                 className="w-full pl-12 pr-4 py-3 border-2 border-transparent bg-white/10 lg:bg-[var(--bg-card)]/80 backdrop-blur-md rounded-2xl text-base focus:outline-none focus:border-[var(--primary)] focus:bg-white/15 lg:focus:bg-[var(--bg-card-hover)] text-white lg:text-[var(--text-main)] shadow-sm hover:bg-white/15 lg:hover:bg-[var(--bg-card-hover)] transition-all font-medium placeholder-white/50 lg:placeholder-slate-400"
               />
               <datalist id="search-suggestions">
                 {suggestions.map((s, i) => <option key={i} value={s as string} />)}
               </datalist>
             </div>
             {/* Botón de pantalla completa móvil: oculta todo el cromo del navegador.
                 (Ordenar y Cerrar sesión se accionan desde el Sidebar en móvil.) */}
             <div className="sm:hidden shrink-0">
               <button
                 onClick={toggleAppFullscreen}
                 title="Pantalla completa"
                 className={cn("p-2.5 rounded-lg transition-colors", isAppFullscreen ? "bg-white/15 text-white" : "text-white/70 hover:bg-white/10")}
               >
                 {isAppFullscreen ? <Minimize className="w-6 h-6" /> : <Maximize className="w-6 h-6" />}
               </button>
             </div>
             {/* Configurar tarjetas del Tablero Kanban: solo en esa pestaña.
                 En móvil real (< sm) no hay otro lugar donde vivía antes esto
                 vivía dentro del propio tablero; ahora vive aquí, en la
                 botonera superior, junto al resto de los controles. */}
             {activeTab === 'kanban' && kanbanCardSettings && setKanbanCardSettings && (
               <div className="sm:hidden shrink-0 relative">
                 <button
                   onClick={() => setShowKanbanSettings((v) => !v)}
                   title="Configurar tarjetas"
                   className={cn("p-2.5 rounded-lg transition-colors", showKanbanSettings ? "bg-white/15 text-white" : "text-white/70 hover:bg-white/10")}
                 >
                   <Settings2 className="w-6 h-6" />
                 </button>
                 {showKanbanSettings && (
                   <KanbanSettingsPopover
                     settings={kanbanCardSettings}
                     onToggle={toggleKanbanSetting}
                     onClose={() => setShowKanbanSettings(false)}
                   />
                 )}
               </div>
             )}
          </div>

          <div className="hidden sm:flex flex-wrap items-center justify-end gap-3 w-full md:w-auto shrink-0">
            
            {activeTab !== 'trash' && activeTab !== 'analytics' && (
              <button 
                 onClick={onOpenAddManual}
                 className="hidden lg:flex bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white px-8 py-3 rounded-xl text-sm font-bold shadow-md shadow-[var(--primary)]/20 items-center gap-2 transition-all hover:-translate-y-0.5 active:scale-95"
              >
                 Añadir Recurso
              </button>
            )}

            {/* Este bloque vive sobre fondo OSCURO (--sidebar-bg) entre sm: y lg:
                (tablet / móvil horizontal) y sobre fondo CLARO/transparente desde
                lg: (desktop, junto al sidebar fijo). Los colores deben adaptarse a
                ambos casos — antes usaban siempre tonos pensados para fondo claro
                (slate-500, bg-card translúcido) y quedaban con bajo contraste,
                casi invisibles, en el rango oscuro sm:→lg:. */}
            <div className="hidden sm:flex items-center gap-3 border-l border-white/15 lg:border-slate-200/50 pl-4 ml-2">
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="text-sm font-medium border border-white/15 lg:border-slate-200/50 rounded-xl px-3 py-2 text-white lg:text-[var(--text-main)] bg-white/10 lg:bg-[var(--bg-card)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] hover:border-white/30 lg:hover:border-[var(--primary)]/50 transition-colors cursor-pointer [&>option]:text-slate-800"
              >
                <option value="manual">Orden Manual</option>
                <option value="recent">Más recientes</option>
                <option value="oldest">Más antiguos</option>
                <option value="alpha">Alfabético</option>
              </select>

              <div className="flex bg-white/10 lg:bg-[var(--bg-card)] border border-white/15 lg:border-slate-200/50 p-1 rounded-xl shadow-sm">
                 <button
                    onClick={() => setViewMode('covers')}
                    title="Solo portadas"
                    className={cn("p-2 rounded-lg transition-colors", viewMode === 'covers' ? "bg-white/20 lg:bg-[var(--primary)]/10 text-white lg:text-[var(--primary)]" : "text-white/70 lg:text-slate-500 hover:text-white lg:hover:text-[var(--text-main)] hover:bg-white/10 lg:hover:bg-slate-100/50")}
                 >
                    <GalleryVerticalEnd className="w-4 h-4" />
                 </button>
                 <button
                    onClick={() => setViewMode('grid')}
                    title="Cuadrícula"
                    className={cn("p-2 rounded-lg transition-colors", viewMode === 'grid' ? "bg-white/20 lg:bg-[var(--primary)]/10 text-white lg:text-[var(--primary)]" : "text-white/70 lg:text-slate-500 hover:text-white lg:hover:text-[var(--text-main)] hover:bg-white/10 lg:hover:bg-slate-100/50")}
                 >
                    <LayoutGrid className="w-4 h-4" />
                 </button>
                 <button
                    onClick={() => setViewMode('grid-compact')}
                    title="Cuadrícula compacta"
                    className={cn("p-2 rounded-lg transition-colors", viewMode === 'grid-compact' ? "bg-white/20 lg:bg-[var(--primary)]/10 text-white lg:text-[var(--primary)]" : "text-white/70 lg:text-slate-500 hover:text-white lg:hover:text-[var(--text-main)] hover:bg-white/10 lg:hover:bg-slate-100/50")}
                 >
                    <Grid3x3 className="w-4 h-4" />
                 </button>
                 <button
                    onClick={() => setViewMode('list')}
                    title="Lista"
                    className={cn("p-2 rounded-lg transition-colors", viewMode === 'list' ? "bg-white/20 lg:bg-[var(--primary)]/10 text-white lg:text-[var(--primary)]" : "text-white/70 lg:text-slate-500 hover:text-white lg:hover:text-[var(--text-main)] hover:bg-white/10 lg:hover:bg-slate-100/50")}
                 >
                    <ListIcon className="w-4 h-4" />
                 </button>
              </div>

              <button
                 onClick={toggleAppFullscreen}
                 title="Pantalla completa"
                 className={cn("p-2.5 border rounded-xl transition-all shadow-sm", isAppFullscreen ? "bg-white/20 lg:bg-[var(--primary)]/10 text-white lg:text-[var(--primary)] border-white/30 lg:border-[var(--primary)]/50" : "text-white/70 lg:text-slate-500 hover:text-white lg:hover:text-[var(--primary)] bg-white/10 lg:bg-[var(--bg-card)] border-white/15 lg:border-slate-200/50 hover:border-white/30 lg:hover:border-[var(--primary)]/50")}
              >
                 {isAppFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
              </button>

              {/* Configurar tarjetas del Tablero Kanban: solo con esa pestaña
                  activa (antes vivía dentro del propio tablero). */}
              {activeTab === 'kanban' && kanbanCardSettings && setKanbanCardSettings && (
                <div className="relative">
                  <button
                    onClick={() => setShowKanbanSettings((v) => !v)}
                    title="Configurar tarjetas"
                    className={cn("p-2.5 border rounded-xl transition-all shadow-sm", showKanbanSettings ? "bg-white/20 lg:bg-[var(--primary)]/10 text-white lg:text-[var(--primary)] border-white/30 lg:border-[var(--primary)]/50" : "text-white/70 lg:text-slate-500 hover:text-white lg:hover:text-[var(--primary)] bg-white/10 lg:bg-[var(--bg-card)] border-white/15 lg:border-slate-200/50 hover:border-white/30 lg:hover:border-[var(--primary)]/50")}
                  >
                    <Settings2 className="w-5 h-5" />
                  </button>
                  {showKanbanSettings && (
                    <KanbanSettingsPopover
                      settings={kanbanCardSettings}
                      onToggle={toggleKanbanSetting}
                      onClose={() => setShowKanbanSettings(false)}
                    />
                  )}
                </div>
              )}

              <button onClick={() => setShowSettings(true)} className="p-2.5 text-white/70 lg:text-slate-500 hover:text-white lg:hover:text-[var(--primary)] bg-white/10 lg:bg-[var(--bg-card)] border border-white/15 lg:border-slate-200/50 hover:border-white/30 lg:hover:border-[var(--primary)]/50 rounded-xl transition-all shadow-sm">
                 <Settings className="w-5 h-5" />
              </button>

              {/* Avatar + logout (en móvil vertical ya están en el Sidebar, evita una fila vacía extra en el header) */}
              {user && (
                <div className="hidden sm:flex items-center gap-2 pl-1">
                  {user.photo ? (
                    <img src={user.photo} alt={user.name} className="w-8 h-8 rounded-full border-2 border-white/30 lg:border-[var(--primary)]/30 object-cover" title={user.name} />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-white/15 lg:bg-[var(--primary)]/20 flex items-center justify-center text-white lg:text-[var(--primary)] font-bold text-sm">
                      {user.name?.[0]?.toUpperCase()}
                    </div>
                  )}
                  <a href="/auth/logout" title="Cerrar sesión"
                    className="p-1.5 text-white/60 lg:text-slate-400 hover:text-red-400 lg:hover:text-red-500 transition-colors rounded-lg hover:bg-white/10 lg:hover:bg-red-50"
                  >
                    <LogOut className="w-4 h-4" />
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </>
  );
}

// Panel de configuración de las tarjetas del Tablero Kanban: vive en la
// botonera superior (antes vivía dentro del propio KanbanBoard). El Toolbar
// tiene posición sticky cerca de la raíz del DOM, así que un popover
// absoluto normal (sin portal) no corre riesgo de recortarse contra ningún
// contenedor con scroll, a diferencia del menú "⋯" de cada tarjeta.
function KanbanSettingsPopover({ settings, onToggle, onClose }: {
  settings: KanbanCardSettings;
  onToggle: (key: keyof KanbanCardSettings) => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      {/* --bg-card es semitransparente por diseño (efecto vidrio, ver
          index.css); backdrop-blur-xl es lo que lo vuelve legible como
          panel flotante, igual que las tarjetas de BookGrid. */}
      <div className="absolute right-0 top-12 z-50 w-72 bg-[var(--bg-card)] backdrop-blur-xl border border-[var(--border-card)] rounded-2xl shadow-2xl p-3 flex flex-col gap-1.5 animate-in fade-in zoom-in-95 duration-150 text-left">
        <div className="flex items-center justify-between px-1 pb-1">
          <span className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wide">Tarjetas del tablero</span>
          <button onClick={onClose} className="p-1 text-[var(--text-muted)] hover:text-[var(--text-main)]">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <SettingRow label="Mostrar portada" checked={settings.showCover} onChange={() => onToggle('showCover')} />
        <SettingRow label="Portada grande" checked={settings.coverLarge} onChange={() => onToggle('coverLarge')} disabled={!settings.showCover} />
        <SettingRow label="Mostrar autor" checked={settings.showAuthor} onChange={() => onToggle('showAuthor')} />
        <SettingRow label="Mostrar año" checked={settings.showYear} onChange={() => onToggle('showYear')} />
        <SettingRow label="Mostrar formato" checked={settings.showFormat} onChange={() => onToggle('showFormat')} />
        <SettingRow label="Mostrar progreso" checked={settings.showProgress} onChange={() => onToggle('showProgress')} />
        <SettingRow label="Mostrar etiquetas" checked={settings.showTags} onChange={() => onToggle('showTags')} />
        <SettingRow label="Mostrar valoración" checked={settings.showRating} onChange={() => onToggle('showRating')} />
      </div>
    </>
  );
}
