// =============================================================================
// Dashboard.tsx — Vista catálogo (pantalla principal)
// -----------------------------------------------------------------------------
// Layout de 3 zonas:
//   1) <Sidebar>  → navegación (categorías, etapas, filtros, listas).
//   2) <Toolbar>  → buscador, orden, modo vista, botón "Añadir Recurso".
//   3) <BookGrid> → grilla/lista de items (con drag & drop).
//
// Mantiene TODO el estado de filtrado/orden/selección a nivel Dashboard,
// para que Sidebar/Toolbar/BookGrid sean componentes "tontos" controlados.
// El DnDContext envuelve todo: permite arrastrar items a las playlists del
// sidebar (los IDs droppables empiezan con "playlist-").
// =============================================================================

import { useState, useEffect, useCallback } from 'react';
import { Sidebar } from './Sidebar';
import { Toolbar } from './Toolbar';
import { BookGrid } from './BookGrid';
import { AnalyticsDashboard } from './AnalyticsDashboard';
import { BookMarked, Menu, X, LayoutGrid, Search, User, Settings, Plus, UploadCloud } from 'lucide-react';
import { cn, colorSwatchProps } from '../lib/utils';
import { useLibrary } from '../hooks/useLibrary';
import { DndContext, closestCenter, DragEndEvent, useSensors, useSensor, PointerSensor, KeyboardSensor } from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { SettingsModal } from './SettingsModal';
import { AddManualModal } from './AddManualModal';
import { AdminPanel } from './AdminPanel';

interface DemoQuota {
  max: number;
  current: number;
}

interface DashboardProps {
  onOpenBook: (id: string) => void;
  user?: { name: string; email: string; photo: string; role?: string };
}

export function Dashboard({ onOpenBook, user }: DashboardProps) {
  const [activeTab, setActiveTab] = useState<string>('todos');
  const [activePlaylist, setActivePlaylist] = useState<string | null>(null);
  const [activeStage, setActiveStage] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsedDesktop, setSidebarCollapsedDesktop] = useState(false);
  const [filters, setFilters] = useState({ year: '', author: '', subject: '', read: '', toBuy: '', authorInitial: '', titleInitial: '' });
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [showMobileProfile, setShowMobileProfile] = useState(false);
  const [showManualAdd, setShowManualAdd] = useState(false);
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [demoQuota, setDemoQuota] = useState<DemoQuota | null>(null);
  const { updateItem, reorderItems, items, addItem, playlists, viewMode, setViewMode, sortBy, setSortBy } = useLibrary();

  const refreshQuota = useCallback(() => {
    fetch('/api/upload-quota', { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        if (typeof d.max === 'number' && d.max > 0) {
          setDemoQuota({ max: d.max, current: d.current ?? 0 });
        } else {
          setDemoQuota(null);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => { refreshQuota(); }, [refreshQuota]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Handler único de DnD: distingue 2 casos:
  //  (a) Drop sobre una playlist del sidebar → asigna el item a esa lista.
  //  (b) Drop sobre otro item → reordenamiento manual (solo si sortBy==='manual').
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;

    // Check if dragging onto a playlist
    if (over.id.toString().startsWith('playlist-')) {
       const plId = over.id.toString().replace('playlist-', '');
       const item = items.find(i => i.id === active.id);
       if (item && !item.folderIds.includes(plId)) {
          updateItem(item.id, { folderIds: [...item.folderIds, plId] });
       }
       return;
    }

    // Only allow manual sorting update if currently in manual sort mode
    if (active.id !== over.id && sortBy === 'manual') {
       reorderItems(active.id as string, over.id as string);
    }
  };

  useEffect(() => {
    const handleBulkRead = (e: CustomEvent) => {
      const items = e.detail.items as string[];
      items.forEach(id => updateItem(id, { read: true, progress: 100 }));
    };

    window.addEventListener('bulk-mark-read' as any, handleBulkRead);
    return () => window.removeEventListener('bulk-mark-read' as any, handleBulkRead);
  }, [updateItem]);

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <div className="flex h-screen bg-[var(--bg-app)] font-sans text-[var(--text-main)] overflow-hidden relative">
        <div className={cn(
          "fixed inset-0 bg-slate-900/50 z-20 lg:hidden transition-opacity",
          sidebarOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        )} onClick={() => setSidebarOpen(false)} />
      
      <div className={cn(
        "fixed lg:relative top-0 left-0 z-30 h-screen transition-all duration-300 shrink-0 shadow-2xl lg:shadow-none",
        sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
        sidebarCollapsedDesktop ? "w-[280px] lg:w-16" : "w-[280px] lg:w-72"
      )}>
        <Sidebar 
          activeTab={activeTab}
          setActiveTab={(tab) => { setActiveTab(tab); setSidebarOpen(false); }}
          activePlaylist={activePlaylist}
          setActivePlaylist={(pl) => { setActivePlaylist(pl); setSidebarOpen(false); }}
          activeStage={activeStage}
          setActiveStage={(st) => { setActiveStage(st); setSidebarOpen(false); }}
          filters={filters}
          setFilters={(f) => { setFilters(f); setSidebarOpen(false); }}
          viewMode={viewMode}
          setViewMode={setViewMode}
          collapsed={sidebarCollapsedDesktop}
          setCollapsed={setSidebarCollapsedDesktop}
          onOpenSettings={() => setShowMobileProfile(true)}
          onOpenAdmin={user?.role === 'admin' ? () => setShowAdminPanel(true) : undefined}
          onClose={() => setSidebarOpen(false)}
        />
      </div>

      <main className="flex-1 flex flex-col h-full overflow-hidden w-full relative">
        <button
           onClick={() => !demoQuota || demoQuota.current < demoQuota.max ? setShowManualAdd(true) : null}
           disabled={!!demoQuota && demoQuota.current >= demoQuota.max}
           className="lg:hidden fixed bottom-6 right-6 w-[56px] h-[56px] bg-[var(--primary)] text-white rounded-full shadow-lg shadow-[var(--primary)]/30 flex items-center justify-center z-[70] transition-transform active:scale-95 border-2 border-white/20 disabled:opacity-40 disabled:cursor-not-allowed"
        >
           <Plus className="w-7 h-7" />
        </button>
        {/* Background ambient blobs for frosted glass effect to shine */}
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-[#00558F]/10 blur-[120px] pointer-events-none z-0" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-[#A0CFEB]/30 blur-[120px] pointer-events-none z-0" />

        <div className="flex-1 flex flex-col p-4 md:p-6 lg:p-8 overflow-hidden z-20">
          <Toolbar
            onOpenSidebar={() => setSidebarOpen(true)}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            viewMode={viewMode}
            setViewMode={setViewMode}
            sortBy={sortBy}
            setSortBy={setSortBy}
            filters={filters}
            setFilters={setFilters}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            onOpenAddManual={() => setShowManualAdd(true)}
            user={user}
          />
          {/* Banner de cuota de contenidos */}
          {demoQuota && (
            <div className={cn(
              "mt-4 flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium border",
              demoQuota.current >= demoQuota.max
                ? "bg-amber-50 border-amber-200 text-amber-800"
                : "bg-[var(--primary)]/5 border-[var(--primary)]/20 text-[var(--text-muted)]"
            )}>
              <UploadCloud className={cn("w-4 h-4 shrink-0", demoQuota.current >= demoQuota.max ? "text-amber-500" : "text-[var(--primary)]")} />
              <span>
                {demoQuota.current >= demoQuota.max
                  ? `Límite de contenidos alcanzado (${demoQuota.current}/${demoQuota.max}). Elimina un contenido para poder subir otro.`
                  : `${demoQuota.current} de ${demoQuota.max} contenidos subidos.`}
              </span>
            </div>
          )}

          <div className="flex-1 mt-4 overflow-y-auto no-scrollbar pr-2 pb-24 lg:pb-20">
            {activeTab === 'analytics' ? (
                <AnalyticsDashboard />
            ) : (
                <BookGrid 
                   category={activeTab}
                   viewMode={viewMode}
                   sortBy={sortBy}
                   stageFilter={activeStage}
                   playlistFilter={activePlaylist}
                   onOpenBook={onOpenBook}
                   filters={filters}
                   searchQuery={searchQuery}
                   selectedItems={selectedItems}
                   setSelectedItems={setSelectedItems}
                />
            )}
          </div>

          {/* Floating Bulk Actions Toolbar */}
          {selectedItems.length > 0 && (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-50 bg-slate-800 text-white px-2 sm:px-4 py-2 sm:py-3 rounded-2xl shadow-2xl flex flex-wrap justify-center items-center gap-2 sm:gap-4 w-[95vw] sm:w-auto animate-in slide-in-from-bottom-5">
               <div className="flex items-center gap-2 pr-2 sm:pr-4 border-r border-slate-600">
                  <span className="bg-[#00558F] text-white text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center shrink-0">{selectedItems.length}</span>
                  <span className="text-sm font-medium hidden sm:inline">seleccionados</span>
               </div>
               <div className="flex gap-2 relative group">
                  <button 
                     className="px-3 py-1.5 hover:bg-slate-700 rounded-lg text-sm transition-colors flex items-center gap-2"
                  >
                     <Menu className="w-4 h-4" /> Mover
                  </button>
                  <div className="absolute bottom-full left-0 mb-2 w-48 bg-white text-slate-800 rounded-xl shadow-xl overflow-hidden invisible group-hover:visible opacity-0 group-hover:opacity-100 transition-all">
                     <div className="border-b border-slate-100 py-1.5 px-3">
                        <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Añadir a lista</span>
                     </div>
                     <div className="max-h-48 overflow-y-auto py-1">
                        {playlists.length === 0 ? (
                           <div className="px-3 py-2 text-xs text-slate-400 italic">No hay listas</div>
                        ) : (
                           playlists.map(pl => (
                              <button
                                 key={pl.id}
                                 onClick={() => {
                                    selectedItems.forEach(id => {
                                      const existing = items.find(i => i.id === id);
                                      if (existing && !existing.folderIds.includes(pl.id)) {
                                         updateItem(id, { folderIds: [...existing.folderIds, pl.id] });
                                      }
                                    });
                                    setSelectedItems([]);
                                 }}
                                 className="w-full text-left px-3 py-2 text-xs hover:bg-slate-50 flex items-center gap-2"
                              >
                                 <div className={cn("w-2 h-2 rounded-full", colorSwatchProps(pl.color).className)} style={colorSwatchProps(pl.color).style} />
                                 <span className="truncate">{pl.name}</span>
                              </button>
                           ))
                        )}
                     </div>
                  </div>
               </div>
               <div className="flex gap-2">
                  <button 
                     onClick={() => {
                        window.dispatchEvent(new CustomEvent('bulk-mark-read', { detail: { items: selectedItems }}));
                        setSelectedItems([]);
                     }}
                     className="px-3 py-1.5 hover:bg-slate-700 rounded-lg text-sm transition-colors flex items-center gap-2 text-emerald-400"
                  >
                     <BookMarked className="w-4 h-4" /> Leídos
                  </button>
                  <button 
                     onClick={() => setSelectedItems([])}
                     className="px-3 py-1.5 hover:bg-slate-700 rounded-lg text-sm transition-colors flex items-center gap-2 text-slate-400"
                  >
                     <X className="w-4 h-4" /> Cancelar
                  </button>
               </div>
            </div>
          )}
        </div>
      </main>
      
      {showMobileProfile && <SettingsModal onClose={() => setShowMobileProfile(false)} />}
      {showAdminPanel && <AdminPanel onClose={() => setShowAdminPanel(false)} />}
      {showManualAdd && (
        <AddManualModal
          onClose={() => { setShowManualAdd(false); refreshQuota(); }}
          onAdd={(b) => { addItem(b); setShowManualAdd(false); setActiveTab(b.category); refreshQuota(); }}
          demoQuota={demoQuota}
        />
      )}
      </div>
    </DndContext>
  );
}
