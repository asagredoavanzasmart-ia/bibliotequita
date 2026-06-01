import { Book, Globe, UploadCloud, Link as LinkIcon, LayoutGrid, List as ListIcon, Save, Search, Settings, Menu, LogOut } from 'lucide-react';
import React, { useState } from 'react';
import { useLibrary } from '../hooks/useLibrary';
import { cn } from '../lib/utils';
import { AddManualModal } from './AddManualModal';
import { SettingsModal } from './SettingsModal';

interface ToolbarProps {
  onOpenSidebar?: () => void;
  activeTab: string;
  setActiveTab: (cat: string) => void;
  viewMode: 'grid' | 'list' | 'grid-compact';
  setViewMode: (mode: 'grid' | 'list' | 'grid-compact') => void;
  sortBy: 'manual' | 'recent' | 'oldest' | 'alpha';
  setSortBy: (sort: 'manual' | 'recent' | 'oldest' | 'alpha') => void;
  filters: any;
  setFilters: (filters: any) => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  onOpenAddManual: () => void;
  user?: { name: string; email: string; photo: string };
}

export function Toolbar({ onOpenSidebar, activeTab, setActiveTab, viewMode, setViewMode, sortBy, setSortBy, filters, setFilters, searchQuery, setSearchQuery, onOpenAddManual, user }: ToolbarProps) {
  const [showSettings, setShowSettings] = useState(false);
  const { addItem, items } = useLibrary();

  // Create suggestions for search
  const suggestions = Array.from(new Set(items.flatMap(i => [i.title, i.author, i.subject]))).filter(Boolean);

  return (
    <>
      <div className="flex flex-col gap-4 w-full border-b border-slate-200/50 pb-4 relative z-10 shrink-0">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          
          <div className="flex-1 w-full flex items-center gap-2">
             {onOpenSidebar && (
               <button 
                 className="lg:hidden p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 rounded-lg shrink-0 transition-colors -ml-2"
                 onClick={onOpenSidebar}
               >
                 <Menu className="w-6 h-6" />
               </button>
             )}
             <div className="flex items-center w-full max-w-2xl relative group">
               <Search className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-[var(--primary)] transition-colors" />
               <input 
                 type="text" 
                 value={searchQuery}
                 onChange={(e) => setSearchQuery(e.target.value)}
                 placeholder="Buscar títulos, autores, materias o etiquetas..." 
                 list="search-suggestions"
                 className="w-full pl-12 pr-4 py-3 border-2 border-transparent bg-[var(--bg-card)]/80 backdrop-blur-md rounded-2xl text-base focus:outline-none focus:border-[var(--primary)] focus:bg-white dark:focus:bg-slate-800 text-[var(--text-main)] shadow-sm hover:bg-white/90 dark:hover:bg-slate-800/90 transition-all font-medium placeholder-slate-400"
               />
               <datalist id="search-suggestions">
                 {suggestions.map((s, i) => <option key={i} value={s as string} />)}
               </datalist>
             </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3 w-full md:w-auto shrink-0">
            
            <button 
               onClick={onOpenAddManual}
               className="hidden md:flex bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white px-8 py-3 rounded-xl text-sm font-bold shadow-md shadow-[var(--primary)]/20 items-center gap-2 transition-all hover:-translate-y-0.5 active:scale-95"
            >
               Añadir Recurso
            </button>

            <div className="hidden sm:flex items-center gap-3 border-l border-slate-200/50 pl-4 ml-2">
              <select 
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="text-sm font-medium border border-slate-200/50 rounded-xl px-3 py-2 text-[var(--text-main)] bg-[var(--bg-card)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] hover:border-[var(--primary)]/50 transition-colors cursor-pointer"
              >
                <option value="manual">Orden Manual</option>
                <option value="recent">Más recientes</option>
                <option value="oldest">Más antiguos</option>
                <option value="alpha">Alfabético</option>
              </select>

              <div className="flex bg-[var(--bg-card)] border border-slate-200/50 p-1 rounded-xl shadow-sm">
                 <button
                    onClick={() => setViewMode('grid')}
                    className={cn("p-2 rounded-lg transition-colors", viewMode === 'grid' ? "bg-[var(--primary)]/10 text-[var(--primary)]" : "text-slate-500 hover:text-[var(--text-main)] hover:bg-slate-100/50")}
                 >
                    <LayoutGrid className="w-4 h-4" />
                 </button>
                 <button
                    onClick={() => setViewMode('list')}
                    className={cn("p-2 rounded-lg transition-colors", viewMode === 'list' ? "bg-[var(--primary)]/10 text-[var(--primary)]" : "text-slate-500 hover:text-[var(--text-main)] hover:bg-slate-100/50")}
                 >
                    <ListIcon className="w-4 h-4" />
                 </button>
              </div>

              <button onClick={() => setShowSettings(true)} className="p-2.5 text-slate-500 hover:text-[var(--primary)] bg-[var(--bg-card)] border border-slate-200/50 rounded-xl hover:border-[var(--primary)]/50 transition-all shadow-sm">
                 <Settings className="w-5 h-5" />
              </button>

              {/* Avatar + logout */}
              {user && (
                <div className="flex items-center gap-2 pl-1">
                  {user.photo ? (
                    <img src={user.photo} alt={user.name} className="w-8 h-8 rounded-full border-2 border-[var(--primary)]/30 object-cover" title={user.name} />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-[var(--primary)]/20 flex items-center justify-center text-[var(--primary)] font-bold text-sm">
                      {user.name?.[0]?.toUpperCase()}
                    </div>
                  )}
                  <a href="/auth/logout" title="Cerrar sesión"
                    className="p-1.5 text-slate-400 hover:text-red-500 transition-colors rounded-lg hover:bg-red-50"
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
