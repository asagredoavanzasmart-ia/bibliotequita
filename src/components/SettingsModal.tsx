import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Settings2, Palette, Library, Plus, Trash2, Edit2, AppWindow, Eye, EyeOff, ChevronUp, ChevronDown, Tag, AlertTriangle } from 'lucide-react';
import { cn, colorSwatchProps, getOrderedNavSections, NAV_SECTIONS_META } from '../lib/utils';
import { useLibrary, ThemeMode } from '../hooks/useLibrary';
import { ColorPicker, APP_COLOR_PALETTE } from './ColorPicker';

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const {
    theme, setTheme, fontFamily, setFontFamily,
    categories, addCategory, updateCategory, deleteCategory,
    playlists, addPlaylist, updatePlaylist, deletePlaylist,
    tags, addTag, updateTag, deleteTag,
    cardSettings, setCardSettings
  } = useLibrary();

  const [activeTab, setActiveTab] = useState<'theme' | 'categories' | 'cards' | 'playlists' | 'tags'>('theme');
  
  // Custom theme array
  const themes: { id: ThemeMode; name: string; desc: string; colors: string[] }[] = [
    { id: 'blue', name: 'Azul Institucional', desc: 'Tema predeterminado. Profesional y relajado.', colors: ['bg-[#00558F]', 'bg-[#A0CFEB]', 'bg-[#f1f5f9]'] },
    { id: 'dark', name: 'Oscuro Minimalista', desc: 'Alto contraste invertido ideal para descansar la vista.', colors: ['bg-slate-800', 'bg-slate-900', 'bg-emerald-500'] },
    { id: 'hc', name: 'Alto Contraste', desc: 'Blanco y negro puro para legibilidad extrema.', colors: ['bg-black', 'bg-white', 'bg-black'] },
    { id: 'emerald', name: 'Verde Bosque', desc: 'Tonos esmeralda que transmiten calma y concentración.', colors: ['bg-[#059669]', 'bg-[#6EE7B7]', 'bg-[#ecfdf5]'] },
    { id: 'sunset', name: 'Atardecer Cálido', desc: 'Naranjas vibrantes para mayor energía.', colors: ['bg-[#EA580C]', 'bg-[#FDBA74]', 'bg-[#fff7ed]'] },
    { id: 'purple', name: 'Noche Púrpura', desc: 'Estilo creativo y elegante en tonos violeta.', colors: ['bg-[#6D28D9]', 'bg-[#C4B5FD]', 'bg-[#f5f3ff]'] },
    { id: 'aurora', name: 'Aurora', desc: 'Degradado azul-violeta de la nueva identidad visual.', colors: ['bg-[#1e2986]', 'bg-[#1f93ff]', 'bg-[#a789fd]'] },
  ];

  const fonts: { id: typeof fontFamily; name: string }[] = [
    { id: 'Inter', name: 'Inter (Sans-serif)' },
    { id: 'Roboto', name: 'Roboto (Sans-serif)' },
    { id: 'Poppins', name: 'Poppins (Sans-serif)' },
    { id: 'Lora', name: 'Lora (Serif)' },
    { id: 'Playfair Display', name: 'Playfair Display (Serif)' }
  ];

  // States for Categories
  const [newCatName, setNewCatName] = useState('');
  const [editCatId, setEditCatId] = useState<string | null>(null);
  const [editCatName, setEditCatName] = useState('');

  // States for Playlists
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [newPlaylistColor, setNewPlaylistColor] = useState(APP_COLOR_PALETTE[0]);
  const [editPlaylistId, setEditPlaylistId] = useState<string | null>(null);
  const [editPlaylistName, setEditPlaylistName] = useState('');
  const [editPlaylistColor, setEditPlaylistColor] = useState('');

  // States for Tags
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState(APP_COLOR_PALETTE[3]);
  const [editTagId, setEditTagId] = useState<string | null>(null);
  const [editTagName, setEditTagName] = useState('');
  const [editTagColor, setEditTagColor] = useState('');
  const [confirmDeleteTagId, setConfirmDeleteTagId] = useState<string | null>(null);

  // Paleta personalizada (tema "custom")
  const customDark = cardSettings.customPalette?.dark || '#1e2986';
  const customMid = cardSettings.customPalette?.mid || '#1f93ff';
  const customLight = cardSettings.customPalette?.light || '#a789fd';
  const applyCustomPalette = (next: { dark: string; mid: string; light: string }) => {
    setCardSettings({ ...cardSettings, customPalette: next });
    setTheme('custom');
  };

  const modalContent = (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-[var(--bg-app)] border border-[var(--border-card)] shadow-2xl rounded-2xl w-full max-w-2xl flex flex-col overflow-hidden max-h-[95vh] animate-in zoom-in-95 duration-300">
        
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-200/50 bg-[var(--bg-card)]">
           <h2 className="text-xl font-bold text-[var(--text-main)] flex items-center gap-3">
              <span className="bg-[var(--primary)] text-[var(--bg-app)] p-2 rounded-xl shadow-md">
                 <Settings2 className="w-5 h-5" />
              </span>
              Ajustes del Sistema
           </h2>
           <div className="flex items-center gap-2">
             <span className="hidden sm:inline-block text-[10px] text-[var(--text-muted)] opacity-70 italic font-medium tracking-wide">
                Autoguardado activado
             </span>
             <button onClick={() => {
                const btn = document.getElementById('settings-save-btn');
                if (btn) {
                  btn.textContent = '¡Guardado!';
                  btn.classList.add('bg-emerald-500', 'text-white');
                  btn.classList.remove('bg-[var(--primary)]/10', 'text-[var(--primary)]');
                  setTimeout(() => {
                     btn.textContent = 'Guardar';
                     btn.classList.remove('bg-emerald-500', 'text-white');
                     btn.classList.add('bg-[var(--primary)]/10', 'text-[var(--primary)]');
                  }, 2000);
                }
             }} id="settings-save-btn" className="px-3 py-1.5 text-xs font-bold rounded-lg transition-all bg-[var(--primary)]/10 text-[var(--primary)] hover:bg-[var(--primary)]/20 shadow-sm flex items-center gap-1">
                Guardar
             </button>
             <button onClick={onClose} className="p-2 ml-1 text-slate-400 hover:text-[var(--primary)] transition-colors rounded-full hover:bg-[var(--primary)]/10">
               <X className="w-5 h-5" />
             </button>
           </div>
        </div>

        <div className="flex flex-col sm:flex-row flex-1 overflow-hidden min-h-0">
           {/* Tab Sidebar */}
           <div className="w-full sm:w-48 shrink-0 bg-[var(--sidebar-bg)] text-white p-4 flex sm:flex-col gap-2 overflow-x-auto sm:overflow-y-auto settings-scrollbar">
              <button onClick={() => setActiveTab('theme')} className={cn("flex shrink-0 items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left", activeTab === 'theme' ? "bg-[var(--primary)]" : "hover:bg-white/10")}>
                <Palette className="w-4 h-4" /> Apariencia
              </button>
              <button onClick={() => setActiveTab('categories')} className={cn("flex shrink-0 items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left", activeTab === 'categories' ? "bg-[var(--primary)]" : "hover:bg-white/10")}>
                <Library className="w-4 h-4" /> Categorías
              </button>
              <button onClick={() => setActiveTab('playlists')} className={cn("flex shrink-0 items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left", activeTab === 'playlists' ? "bg-[var(--primary)]" : "hover:bg-white/10")}>
                <Library className="w-4 h-4" /> Listas
              </button>
              <button onClick={() => setActiveTab('tags')} className={cn("flex shrink-0 items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left", activeTab === 'tags' ? "bg-[var(--primary)]" : "hover:bg-white/10")}>
                <Tag className="w-4 h-4" /> Etiquetas
              </button>
              <button onClick={() => setActiveTab('cards')} className={cn("flex shrink-0 items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left", activeTab === 'cards' ? "bg-[var(--primary)]" : "hover:bg-white/10")}>
                <AppWindow className="w-4 h-4" /> Tarjetas
              </button>
           </div>

           {/* Content */}
           <div className="flex-1 p-6 overflow-y-auto settings-scrollbar bg-[var(--bg-app)] text-[var(--text-main)]">
              {activeTab === 'theme' && (
                <div className="space-y-8">
                   <div>
                       <h3 className="text-lg font-bold mb-4">Tema Visual</h3>
                       <div className="grid gap-3">
                         {themes.map(t => (
                            <button
                              key={t.id}
                              onClick={() => setTheme(t.id)}
                              className={cn("flex items-start gap-4 p-4 rounded-xl border text-left transition-all", theme === t.id ? "border-[var(--primary)] bg-[var(--primary)]/5 ring-1 ring-[var(--primary)] shadow-sm" : "border-slate-200/50 hover:border-[var(--primary)]/50 bg-[var(--bg-card)]")}
                            >
                               <div className="flex gap-1 flex-shrink-0 mt-1">
                                  {t.colors.map((c, i) => <div key={i} className={cn("w-4 h-4 rounded-full shadow-sm", c)} />)}
                               </div>
                               <div>
                                  <div className="font-bold text-sm mb-1">{t.name}</div>
                                  <div className="text-xs text-[var(--text-muted)] leading-relaxed">{t.desc}</div>
                               </div>
                            </button>
                         ))}

                         {/* Paleta personalizada: el usuario elige 3 colores (oscuro/medio/claro)
                             y se aplican en vivo como tema "custom" (ver index.css). */}
                         <div className={cn("p-4 rounded-xl border transition-all", theme === 'custom' ? "border-[var(--primary)] bg-[var(--primary)]/5 ring-1 ring-[var(--primary)] shadow-sm" : "border-slate-200/50 bg-[var(--bg-card)]")}>
                            <button
                              onClick={() => setTheme('custom')}
                              className="w-full flex items-start gap-4 text-left mb-3"
                            >
                               <div className="flex gap-1 flex-shrink-0 mt-1">
                                  <div className="w-4 h-4 rounded-full shadow-sm border border-black/10" style={{ backgroundColor: customDark }} />
                                  <div className="w-4 h-4 rounded-full shadow-sm border border-black/10" style={{ backgroundColor: customMid }} />
                                  <div className="w-4 h-4 rounded-full shadow-sm border border-black/10" style={{ backgroundColor: customLight }} />
                               </div>
                               <div>
                                  <div className="font-bold text-sm mb-1">Paleta personalizada</div>
                                  <div className="text-xs text-[var(--text-muted)] leading-relaxed">Elige 3 colores (oscuro, medio y claro) para crear tu propio tema.</div>
                               </div>
                            </button>
                            <div className="flex items-center gap-3 pl-1">
                               <label className="flex flex-col items-center gap-1 cursor-pointer">
                                  <input type="color" value={customDark} onChange={e => applyCustomPalette({ dark: e.target.value, mid: customMid, light: customLight })} className="w-9 h-9 rounded-lg border border-slate-200/50 cursor-pointer bg-transparent" />
                                  <span className="text-[10px] text-[var(--text-muted)]">Oscuro</span>
                               </label>
                               <label className="flex flex-col items-center gap-1 cursor-pointer">
                                  <input type="color" value={customMid} onChange={e => applyCustomPalette({ dark: customDark, mid: e.target.value, light: customLight })} className="w-9 h-9 rounded-lg border border-slate-200/50 cursor-pointer bg-transparent" />
                                  <span className="text-[10px] text-[var(--text-muted)]">Medio</span>
                               </label>
                               <label className="flex flex-col items-center gap-1 cursor-pointer">
                                  <input type="color" value={customLight} onChange={e => applyCustomPalette({ dark: customDark, mid: customMid, light: e.target.value })} className="w-9 h-9 rounded-lg border border-slate-200/50 cursor-pointer bg-transparent" />
                                  <span className="text-[10px] text-[var(--text-muted)]">Claro</span>
                               </label>
                            </div>
                         </div>
                       </div>
                   </div>

                   <div>
                       <h3 className="text-lg font-bold mb-4">Tipografía (Google Fonts)</h3>
                       <div className="grid gap-3">
                          {fonts.map(f => (
                             <button
                               key={f.id}
                               onClick={() => setFontFamily(f.id)}
                               className={cn("flex items-center justify-between p-4 rounded-xl border text-left transition-all", fontFamily === f.id ? "border-[var(--primary)] bg-[var(--primary)]/5 ring-1 ring-[var(--primary)] shadow-sm" : "border-slate-200/50 hover:border-[var(--primary)]/50 bg-[var(--bg-card)]")}
                             >
                                <span className={cn("font-bold", f.id === 'Inter' ? 'font-sans' : f.id === 'Lora' ? 'font-serif' : f.id === 'Playfair Display' ? 'font-serif' : f.id === 'Poppins' ? 'font-sans tracking-wide' : 'font-sans')} style={{ fontFamily: f.id }}>{f.name}</span>
                                {fontFamily === f.id && <div className="w-2 h-2 rounded-full bg-[var(--primary)]" />}
                             </button>
                          ))}
                       </div>
                   </div>
                </div>
              )}

              {activeTab === 'categories' && (
                <div className="space-y-6">
                   <h3 className="text-lg font-bold">Configuración de Categorías</h3>
                   <div className="flex gap-2">
                      <input 
                         value={newCatName} onChange={e => setNewCatName(e.target.value)} 
                         className="flex-1 px-3 py-2 rounded-lg border border-slate-200/50 text-sm focus:ring-2 focus:ring-[var(--primary)] bg-[var(--bg-card)] text-[var(--text-main)] outline-none"
                         placeholder="Nueva categoría..."
                      />
                      <button 
                        onClick={() => { if(newCatName.trim()) { addCategory({ name: newCatName.trim() }); setNewCatName(''); } }}
                        className="bg-[var(--primary)] text-white px-3 py-2 rounded-lg flex items-center justify-center hover:opacity-90"
                      >
                         <Plus className="w-4 h-4" />
                      </button>
                   </div>
                   
                   <p className="text-xs text-[var(--text-muted)] -mt-3">
                      Las categorías base (Libros, Revistas, Artículos, Estudio) no se
                      pueden borrar, pero puedes ocultarlas de la barra lateral.
                   </p>
                   <div className="space-y-2 max-h-64 overflow-y-auto pr-2">
                      {categories.map(cat => {
                         const isBase = ['libros', 'revistas', 'artículos', 'articulos', 'estudio'].includes(cat.name.toLowerCase());
                         return (
                         <div key={cat.id} className={cn("flex items-center justify-between p-3 rounded-lg border border-slate-200/50 bg-[var(--bg-card)]", cat.hidden && "opacity-50")}>
                            {editCatId === cat.id ? (
                               <input autoFocus value={editCatName} onChange={e => setEditCatName(e.target.value)} onBlur={() => { updateCategory(cat.id, { name: editCatName || cat.name }); setEditCatId(null); }} onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()} className="flex-1 bg-transparent outline-none text-sm font-medium" />
                            ) : (
                               <span className="text-sm font-medium">{cat.name}{isBase && <span className="ml-2 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">base</span>}</span>
                            )}
                            <div className="flex items-center gap-1">
                               <button onClick={() => { setEditCatId(cat.id); setEditCatName(cat.name); }} className="p-1.5 text-slate-400 hover:text-[var(--primary)] rounded-md" title="Renombrar"><Edit2 className="w-4 h-4" /></button>
                               {isBase ? (
                                  <button onClick={() => updateCategory(cat.id, { hidden: !cat.hidden })} className="p-1.5 text-slate-400 hover:text-[var(--primary)] rounded-md" title={cat.hidden ? 'Mostrar en la barra lateral' : 'Ocultar de la barra lateral'}>
                                     {cat.hidden ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                  </button>
                               ) : (
                                  <button onClick={() => deleteCategory(cat.id)} className="p-1.5 text-slate-400 hover:text-rose-500 rounded-md" title="Borrar"><Trash2 className="w-4 h-4" /></button>
                               )}
                            </div>
                         </div>
                         );
                      })}
                   </div>
                </div>
              )}

              {activeTab === 'playlists' && (
                <div className="space-y-6">
                   <h3 className="text-lg font-bold">Configuración de Listas</h3>
                   <div className="flex gap-2 items-center">
                      <ColorPicker value={newPlaylistColor} onChange={setNewPlaylistColor} label="Color de la lista" />
                      <input
                         value={newPlaylistName} onChange={e => setNewPlaylistName(e.target.value)}
                         onKeyDown={e => { if (e.key === 'Enter' && newPlaylistName.trim()) { addPlaylist({ name: newPlaylistName.trim(), color: newPlaylistColor }); setNewPlaylistName(''); } }}
                         className="flex-1 px-3 py-2 rounded-lg border border-slate-200/50 text-sm focus:ring-2 focus:ring-[var(--primary)] bg-[var(--bg-card)] text-[var(--text-main)] outline-none"
                         placeholder="Nueva lista..."
                      />
                      <button
                        onClick={() => { if(newPlaylistName.trim()) { addPlaylist({ name: newPlaylistName.trim(), color: newPlaylistColor }); setNewPlaylistName(''); } }}
                        className="bg-[var(--primary)] text-white px-3 py-2 rounded-lg flex items-center justify-center hover:opacity-90"
                      >
                         <Plus className="w-4 h-4" />
                      </button>
                   </div>

                   <div className="space-y-2 max-h-64 overflow-y-auto pr-2">
                      {playlists.map(pl => (
                         <div key={pl.id} className="flex items-center justify-between p-3 rounded-lg border border-slate-200/50 bg-[var(--bg-card)]">
                            {editPlaylistId === pl.id ? (
                               <div className="flex items-center gap-2 flex-1">
                                  <ColorPicker value={editPlaylistColor} onChange={(c) => { setEditPlaylistColor(c); updatePlaylist(pl.id, { color: c }); }} />
                                  <input autoFocus value={editPlaylistName} onChange={e => setEditPlaylistName(e.target.value)} onBlur={() => { updatePlaylist(pl.id, { name: editPlaylistName || pl.name }); setEditPlaylistId(null); }} onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()} className="flex-1 bg-transparent outline-none text-sm font-medium" />
                               </div>
                            ) : (
                               <div className="flex items-center gap-2">
                                  <div className={cn("w-3 h-3 rounded-full", colorSwatchProps(pl.color).className)} style={colorSwatchProps(pl.color).style} />
                                  <span className="text-sm font-medium">{pl.name}</span>
                               </div>
                            )}
                            <div className="flex items-center gap-1">
                               <button onClick={() => { setEditPlaylistId(pl.id); setEditPlaylistName(pl.name); setEditPlaylistColor(pl.color || 'bg-slate-800'); }} className="p-1.5 text-slate-400 hover:text-[var(--primary)] rounded-md"><Edit2 className="w-4 h-4" /></button>
                               <button onClick={() => deletePlaylist(pl.id)} className="p-1.5 text-slate-400 hover:text-rose-500 rounded-md"><Trash2 className="w-4 h-4" /></button>
                            </div>
                         </div>
                      ))}
                   </div>
                </div>
              )}

              {activeTab === 'tags' && (
                <div className="space-y-6">
                   <h3 className="text-lg font-bold">Etiquetas</h3>
                   <p className="text-xs text-[var(--text-muted)] -mt-4">Renombrar una etiqueta conserva su asignación en todos los libros que la tengan.</p>
                   <div className="flex gap-2 items-center">
                      <ColorPicker value={newTagColor} onChange={setNewTagColor} label="Color de la etiqueta" />
                      <input
                         value={newTagName} onChange={e => setNewTagName(e.target.value)}
                         onKeyDown={e => { if (e.key === 'Enter' && newTagName.trim()) { addTag({ name: newTagName.trim(), color: newTagColor }).catch(() => {}); setNewTagName(''); } }}
                         className="flex-1 px-3 py-2 rounded-lg border border-slate-200/50 text-sm focus:ring-2 focus:ring-[var(--primary)] bg-[var(--bg-card)] text-[var(--text-main)] outline-none"
                         placeholder="Nueva etiqueta..."
                      />
                      <button
                        onClick={() => { if(newTagName.trim()) { addTag({ name: newTagName.trim(), color: newTagColor }).catch(() => {}); setNewTagName(''); } }}
                        className="bg-[var(--primary)] text-white px-3 py-2 rounded-lg flex items-center justify-center hover:opacity-90"
                      >
                         <Plus className="w-4 h-4" />
                      </button>
                   </div>

                   <div className="space-y-2 max-h-64 overflow-y-auto pr-2">
                      {tags.length === 0 && <p className="text-sm text-[var(--text-muted)] italic">No hay etiquetas todavía.</p>}
                      {tags.map(tag => (
                         <div key={tag.id} className="flex items-center justify-between p-3 rounded-lg border border-slate-200/50 bg-[var(--bg-card)]">
                            {editTagId === tag.id ? (
                               <div className="flex items-center gap-2 flex-1">
                                  <ColorPicker value={editTagColor} onChange={(c) => { setEditTagColor(c); updateTag(tag.id, { color: c }); }} />
                                  <input autoFocus value={editTagName} onChange={e => setEditTagName(e.target.value)} onBlur={() => { updateTag(tag.id, { name: editTagName || tag.name }); setEditTagId(null); }} onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()} className="flex-1 bg-transparent outline-none text-sm font-medium" />
                               </div>
                            ) : (
                               <div className="flex items-center gap-2">
                                  <div className={cn("w-3 h-3 rounded-full", colorSwatchProps(tag.color).className)} style={colorSwatchProps(tag.color).style} />
                                  <span className="text-sm font-medium">{tag.name}</span>
                               </div>
                            )}
                            <div className="flex items-center gap-1">
                               <button onClick={() => { setEditTagId(tag.id); setEditTagName(tag.name); setEditTagColor(tag.color || 'bg-slate-800'); }} className="p-1.5 text-slate-400 hover:text-[var(--primary)] rounded-md"><Edit2 className="w-4 h-4" /></button>
                               <button onClick={() => setConfirmDeleteTagId(tag.id)} className="p-1.5 text-slate-400 hover:text-rose-500 rounded-md"><Trash2 className="w-4 h-4" /></button>
                            </div>
                         </div>
                      ))}
                   </div>

                   {/* Confirmación antes de borrar una etiqueta. */}
                   {confirmDeleteTagId && (
                     <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4" onClick={() => setConfirmDeleteTagId(null)}>
                       <div className="bg-[var(--bg-app)] border border-[var(--border-card)] rounded-2xl shadow-2xl max-w-sm w-full p-5" onClick={e => e.stopPropagation()}>
                         <div className="flex items-start gap-3 mb-4">
                           <div className="bg-rose-100 text-rose-600 p-2 rounded-xl shrink-0"><AlertTriangle className="w-5 h-5" /></div>
                           <div>
                             <h4 className="font-bold text-[var(--text-main)]">Eliminar etiqueta</h4>
                             <p className="text-sm text-[var(--text-muted)] mt-1">Se quitará de todos los libros que la tengan. Esta acción no se puede deshacer.</p>
                           </div>
                         </div>
                         <div className="flex justify-end gap-2">
                           <button onClick={() => setConfirmDeleteTagId(null)} className="px-4 py-2 rounded-lg text-sm font-bold bg-slate-200 text-slate-600 hover:bg-slate-300">Cancelar</button>
                           <button onClick={() => { deleteTag(confirmDeleteTagId); setConfirmDeleteTagId(null); }} className="px-4 py-2 rounded-lg text-sm font-bold bg-rose-500 text-white hover:bg-rose-600">Eliminar</button>
                         </div>
                       </div>
                     </div>
                   )}
                </div>
              )}

              {activeTab === 'cards' && (
                <div className="space-y-6">
                   <h3 className="text-lg font-bold">Tarjeta de Libro</h3>
                   <div className="space-y-4">
                      {[
                        { id: 'showAuthor', label: 'Mostrar Autor', desc: 'Muestra el autor debajo del título.' },
                        { id: 'showYear', label: 'Mostrar Año', desc: 'Muestra el año de publicación.' },
                        { id: 'showType', label: 'Mostrar Formato', desc: 'Etiqueta en la portada (e.g., pdf, epub).' },
                        { id: 'showPhysicalStatus', label: 'Mostrar Estado Físico', desc: 'Indica si se posee el libro físico.' },
                        { id: 'showProgress', label: 'Mostrar Progreso', desc: 'Muestra la barra de porcentaje de lectura.' },
                        { id: 'showRating', label: 'Mostrar Rating', desc: 'Muestra las 5 estrellas de calificación.' }
                      ].map(opt => (
                        <label key={opt.id} className="flex items-center justify-between p-4 rounded-xl border border-slate-200/50 bg-[var(--bg-card)] cursor-pointer hover:border-[var(--primary)]/50 transition-colors">
                           <div>
                              <div className="font-bold text-sm">{opt.label}</div>
                              <div className="text-xs text-[var(--text-muted)]">{opt.desc}</div>
                           </div>
                           <div className="relative inline-flex items-center cursor-pointer">
                              <input 
                                type="checkbox" 
                                className="sr-only peer" 
                                checked={(cardSettings as any)[opt.id]}
                                onChange={(e) => setCardSettings({ ...cardSettings, [opt.id]: e.target.checked })}
                              />
                              <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[var(--primary)]"></div>
                           </div>
                        </label>
                      ))}
                   </div>

                   <h3 className="text-lg font-bold pt-2">Secciones del menú</h3>
                   <p className="text-xs text-[var(--text-muted)] -mt-4">Activa, desactiva y reordena las clasificaciones que aparecen en la barra lateral.</p>
                   <div className="space-y-2">
                      {(() => {
                        const ordered = getOrderedNavSections(cardSettings);
                        const settingKeyOf = (id: string) => NAV_SECTIONS_META.find(m => m.id === id)!.settingKey;
                        const moveSection = (index: number, dir: -1 | 1) => {
                           const target = index + dir;
                           if (target < 0 || target >= ordered.length) return;
                           const newOrder = ordered.map(s => s.id);
                           [newOrder[index], newOrder[target]] = [newOrder[target], newOrder[index]];
                           setCardSettings({ ...cardSettings, navOrder: newOrder });
                        };
                        return ordered.map((sec, index) => (
                          <div key={sec.id} className="flex items-center gap-2 p-3 rounded-xl border border-slate-200/50 bg-[var(--bg-card)]">
                             <div className="flex flex-col -my-1">
                                <button
                                  type="button"
                                  disabled={index === 0}
                                  onClick={() => moveSection(index, -1)}
                                  className="p-0.5 text-[var(--text-muted)] hover:text-[var(--primary)] disabled:opacity-30 disabled:cursor-not-allowed"
                                  title="Subir"
                                >
                                  <ChevronUp className="w-4 h-4" />
                                </button>
                                <button
                                  type="button"
                                  disabled={index === ordered.length - 1}
                                  onClick={() => moveSection(index, 1)}
                                  className="p-0.5 text-[var(--text-muted)] hover:text-[var(--primary)] disabled:opacity-30 disabled:cursor-not-allowed"
                                  title="Bajar"
                                >
                                  <ChevronDown className="w-4 h-4" />
                                </button>
                             </div>
                             <span className="font-bold text-sm flex-1">{sec.label}</span>
                             <label className="relative inline-flex items-center cursor-pointer">
                                <input
                                  type="checkbox"
                                  className="sr-only peer"
                                  checked={sec.show}
                                  onChange={(e) => setCardSettings({ ...cardSettings, [settingKeyOf(sec.id)]: e.target.checked })}
                                />
                                <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[var(--primary)]"></div>
                             </label>
                          </div>
                        ));
                      })()}
                   </div>
                </div>
              )}
           </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
