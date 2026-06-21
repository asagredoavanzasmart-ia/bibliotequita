// =============================================================================
// useLibrary.tsx — Estado global de la Biblioteca (Context API)
// -----------------------------------------------------------------------------
// Único provider de la app. Mantiene en memoria todas las colecciones
// (items, playlists, categories, stages) + preferencias de UI (theme,
// fontFamily, cardSettings) y las sincroniza con el backend (Supabase) vía
// /api/library/*.
//
// Al montar, hace GET /api/library/state (que crea valores por defecto si el
// usuario es nuevo) y luego cada mutación llama al endpoint correspondiente,
// actualizando el estado local con la respuesta del servidor.
//
// LIMITACIONES ACTUALES:
//   - Los archivos PDF/EPUB grandes NO viven aquí: se persisten aparte
//     (servidor / idb-keyval legado). Solo la metadata vive en library_items.
//   - Las stages son fijas (initialStages, no se persisten).
// =============================================================================

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { BookItem, PlaylistData, StageData, CategoryData, CardSettings } from '../types';
import { deleteUploadedFile } from '../lib/uploadFile';

// Temas disponibles (ver index.css → [data-theme="..."] para los tokens CSS).
export type ThemeMode = 'blue' | 'dark' | 'hc' | 'emerald' | 'sunset' | 'purple' | 'aurora' | 'custom';
export type FontFamily = 'Inter' | 'Lora' | 'Playfair Display' | 'Poppins' | 'Roboto';

interface LibraryContextType {
  items: BookItem[];
  playlists: PlaylistData[];
  stages: StageData[];
  categories: CategoryData[];
  theme: ThemeMode;
  fontFamily: FontFamily;
  cardSettings: CardSettings;
  viewMode: 'covers' | 'grid' | 'grid-compact' | 'list';
  sortBy: 'manual' | 'recent' | 'oldest' | 'alpha';

  addItem: (item: Omit<BookItem, 'id' | 'timestamp'>) => void;
  updateItem: (id: string, updates: Partial<BookItem>) => void;
  deleteItem: (id: string) => void;
  trashItems: BookItem[];
  restoreItem: (id: string) => void;
  permanentlyDeleteItem: (id: string) => void;

  addPlaylist: (playlist: Omit<PlaylistData, 'id'>) => void;
  updatePlaylist: (id: string, updates: Partial<PlaylistData>) => void;
  deletePlaylist: (id: string) => void;

  addCategory: (category: Omit<CategoryData, 'id'>) => void;
  updateCategory: (id: string, updates: Partial<CategoryData>) => void;
  deleteCategory: (id: string) => void;

  setTheme: (theme: ThemeMode) => void;
  setFontFamily: (font: FontFamily) => void;
  setCardSettings: (settings: CardSettings) => void;
  setViewMode: (mode: 'covers' | 'grid' | 'grid-compact' | 'list') => void;
  setSortBy: (sort: 'manual' | 'recent' | 'oldest' | 'alpha') => void;

  reorderItems: (activeId: string, overId: string) => void;
}

const LibraryContext = createContext<LibraryContextType | undefined>(undefined);

const initialStages: StageData[] = [
  { id: '1', name: 'Prehistoria' },
  { id: '2', name: 'Edad Antigua' },
  { id: '3', name: 'Edad Media' },
  { id: '4', name: 'Edad Moderna' },
  { id: '5', name: 'Edad Contemporánea' },
];

const DEFAULT_CARD_SETTINGS: CardSettings = {
  showAuthor: true,
  showYear: true,
  showProgress: true,
  showType: true,
  showPhysicalStatus: true,
  showRating: true,
  navFavoritos: true,
  navLeidos: true,
  navPorLeer: true,
  navDestacados: true,
  navFisico: true,
  navDigital: true,
};

async function apiFetch(url: string, options?: RequestInit) {
  const res = await fetch(url, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Error en ${url}`);
  }
  return res.json();
}

export function LibraryProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<BookItem[]>([]);
  const [trashItems, setTrashItems] = useState<BookItem[]>([]);
  const [playlists, setPlaylists] = useState<PlaylistData[]>([]);
  const [categories, setCategories] = useState<CategoryData[]>([]);
  const [theme, setThemeState] = useState<ThemeMode>('blue');
  const [fontFamily, setFontFamilyState] = useState<FontFamily>('Inter');
  const [cardSettings, setCardSettingsState] = useState<CardSettings>(DEFAULT_CARD_SETTINGS);
  const [viewMode, setViewModeState] = useState<'covers' | 'grid' | 'grid-compact' | 'list'>('grid');
  const [sortBy, setSortByState] = useState<'manual' | 'recent' | 'oldest' | 'alpha'>('manual');
  const [stages] = useState<StageData[]>(initialStages);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    apiFetch('/api/library/state')
      .then((data) => {
        setItems(data.items ?? []);
        setPlaylists(data.playlists ?? []);
        setCategories(data.categories ?? []);
        if (data.settings) {
          setThemeState(data.settings.theme || 'blue');
          setFontFamilyState(data.settings.fontFamily || 'Inter');
          setCardSettingsState({ ...DEFAULT_CARD_SETTINGS, ...(data.settings.cardSettings || {}) });
          if (data.settings.viewMode) setViewModeState(data.settings.viewMode);
          if (data.settings.sortBy) setSortByState(data.settings.sortBy);
        }
      })
      .catch((err) => console.error('No se pudo cargar la biblioteca:', err))
      .finally(() => setLoaded(true));

    apiFetch('/api/library/trash')
      .then((data) => {
        setTrashItems(data.items ?? []);
      })
      .catch((err) => console.error('No se pudo cargar la papelera:', err));
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Tema "custom": empuja los 3 colores elegidos por el usuario como variables
  // CSS (--custom-dark/mid/light), que index.css lee en [data-theme="custom"].
  useEffect(() => {
    const palette = cardSettings.customPalette;
    if (theme === 'custom' && palette) {
      document.documentElement.style.setProperty('--custom-dark', palette.dark);
      document.documentElement.style.setProperty('--custom-mid', palette.mid);
      document.documentElement.style.setProperty('--custom-light', palette.light);
    }
  }, [theme, cardSettings.customPalette]);

  useEffect(() => {
    let fontValue = '"Inter", sans-serif';
    if (fontFamily === 'Lora') fontValue = '"Lora", serif';
    if (fontFamily === 'Playfair Display') fontValue = '"Playfair Display", serif';
    if (fontFamily === 'Poppins') fontValue = '"Poppins", sans-serif';
    if (fontFamily === 'Roboto') fontValue = '"Roboto", sans-serif';
    document.documentElement.style.setProperty('--app-font', fontValue);
  }, [fontFamily]);

  const setTheme = (next: ThemeMode) => {
    setThemeState(next);
    apiFetch('/api/library/settings', { method: 'PUT', body: JSON.stringify({ theme: next }) }).catch((err) => console.error(err));
  };

  const setFontFamily = (next: FontFamily) => {
    setFontFamilyState(next);
    apiFetch('/api/library/settings', { method: 'PUT', body: JSON.stringify({ fontFamily: next }) }).catch((err) => console.error(err));
  };

  const setCardSettings = (next: CardSettings) => {
    setCardSettingsState(next);
    apiFetch('/api/library/settings', { method: 'PUT', body: JSON.stringify({ cardSettings: next }) }).catch((err) => console.error(err));
  };

  const setViewMode = (next: 'covers' | 'grid' | 'grid-compact' | 'list') => {
    setViewModeState(next);
    apiFetch('/api/library/settings', { method: 'PUT', body: JSON.stringify({ viewMode: next }) }).catch((err) => console.error(err));
  };

  const setSortBy = (next: 'manual' | 'recent' | 'oldest' | 'alpha') => {
    setSortByState(next);
    apiFetch('/api/library/settings', { method: 'PUT', body: JSON.stringify({ sortBy: next }) }).catch((err) => console.error(err));
  };

  const addItem = (item: Omit<BookItem, 'id' | 'timestamp'>) => {
    const payload = { ...item, timestamp: Date.now(), listIndex: 0 };
    apiFetch('/api/library/items', { method: 'POST', body: JSON.stringify(payload) })
      .then((data) => setItems((prev) => [data.item, ...prev]))
      .catch((err) => console.error('No se pudo crear el item:', err));
  };

  const updateItem = (id: string, updates: Partial<BookItem>) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...updates } : item)));
    apiFetch(`/api/library/items/${id}`, { method: 'PUT', body: JSON.stringify(updates) })
      .catch((err) => console.error('No se pudo actualizar el item:', err));
  };

  // Al borrar un item, se realiza un borrado lógico (mover a la papelera).
  const deleteItem = (id: string) => {
    const itemToDelete = items.find((i) => i.id === id);
    if (!itemToDelete) return;

    setItems((prev) => prev.filter((item) => item.id !== id));
    setTrashItems((prev) => [
      { ...itemToDelete, deletedAt: new Date().toISOString() },
      ...prev,
    ]);

    apiFetch(`/api/library/items/${id}`, { method: 'DELETE' })
      .catch((err) => console.error('No se pudo borrar el item (soft delete):', err));
  };

  const restoreItem = (id: string) => {
    const itemToRestore = trashItems.find((i) => i.id === id);
    if (!itemToRestore) return;

    setTrashItems((prev) => prev.filter((item) => item.id !== id));
    const { deletedAt, ...cleanItem } = itemToRestore;
    setItems((prev) => [cleanItem, ...prev]);

    apiFetch(`/api/library/items/${id}/restore`, { method: 'POST' })
      .catch((err) => console.error('No se pudo restaurar el item:', err));
  };

  const permanentlyDeleteItem = (id: string) => {
    setTrashItems((prev) => prev.filter((item) => item.id !== id));

    apiFetch(`/api/library/items/${id}/permanent`, { method: 'DELETE' })
      .catch((err) => console.error('No se pudo borrar permanentemente el item:', err));
  };

  const addPlaylist = (playlist: Omit<PlaylistData, 'id'>) => {
    apiFetch('/api/library/playlists', { method: 'POST', body: JSON.stringify(playlist) })
      .then((data) => setPlaylists((prev) => [...prev, data.playlist]))
      .catch((err) => console.error('No se pudo crear la lista:', err));
  };

  const updatePlaylist = (id: string, updates: Partial<PlaylistData>) => {
    setPlaylists((prev) => prev.map((pl) => (pl.id === id ? { ...pl, ...updates } : pl)));
    apiFetch(`/api/library/playlists/${id}`, { method: 'PUT', body: JSON.stringify(updates) })
      .catch((err) => console.error('No se pudo actualizar la lista:', err));
  };

  const deletePlaylist = (id: string) => {
    setPlaylists((prev) => prev.filter((pl) => pl.id !== id));
    setItems((prev) => prev.map((item) => ({ ...item, folderIds: item.folderIds.filter((fId) => fId !== id) })));
    apiFetch(`/api/library/playlists/${id}`, { method: 'DELETE' })
      .catch((err) => console.error('No se pudo borrar la lista:', err));
  };

  const addCategory = (category: Omit<CategoryData, 'id'>) => {
    apiFetch('/api/library/categories', { method: 'POST', body: JSON.stringify(category) })
      .then((data) => setCategories((prev) => [...prev, data.category]))
      .catch((err) => console.error('No se pudo crear la categoría:', err));
  };

  const updateCategory = (id: string, updates: Partial<CategoryData>) => {
    setCategories((prev) => prev.map((c) => (c.id === id ? { ...c, ...updates } : c)));
    apiFetch(`/api/library/categories/${id}`, { method: 'PUT', body: JSON.stringify(updates) })
      .catch((err) => console.error('No se pudo actualizar la categoría:', err));
  };

  const deleteCategory = (id: string) => {
    setCategories((prev) => prev.filter((c) => c.id !== id));
    apiFetch(`/api/library/categories/${id}`, { method: 'DELETE' })
      .catch((err) => console.error('No se pudo borrar la categoría:', err));
  };

  const reorderItems = (activeId: string, overId: string) => {
    setItems((items) => {
      const oldIndex = items.findIndex((i) => i.id === activeId);
      const newIndex = items.findIndex((i) => i.id === overId);

      const newItems = [...items];
      const [removed] = newItems.splice(oldIndex, 1);
      newItems.splice(newIndex, 0, removed);

      return newItems.map((item, index) => ({ ...item, listIndex: index }));
    });
    apiFetch('/api/library/items/reorder', { method: 'PUT', body: JSON.stringify({ activeId, overId }) })
      .catch((err) => console.error('No se pudo reordenar:', err));
  };

  if (!loaded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg-app)]">
        <div className="w-8 h-8 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <LibraryContext.Provider
      value={{
        items,
        playlists,
        stages,
        categories,
        theme,
        fontFamily,
        cardSettings,
        viewMode,
        sortBy,
        addItem,
        updateItem,
        deleteItem,
        trashItems,
        restoreItem,
        permanentlyDeleteItem,
        addPlaylist,
        updatePlaylist,
        deletePlaylist,
        addCategory,
        updateCategory,
        deleteCategory,
        setTheme,
        setFontFamily,
        setCardSettings,
        setViewMode,
        setSortBy,
        reorderItems,
      }}
    >
      {children}
    </LibraryContext.Provider>
  );
}

export function useLibrary() {
  const context = useContext(LibraryContext);
  if (context === undefined) {
    throw new Error('useLibrary must be used within a LibraryProvider');
  }
  return context;
}
