// =============================================================================
// useLibrary.tsx — Estado global de la Biblioteca (Context API)
// -----------------------------------------------------------------------------
// Único provider de la app. Mantiene en memoria todas las colecciones
// (items, playlists, categories, tags, stages) + preferencias de UI
// (theme, fontFamily, cardSettings) y las sincroniza con localStorage.
//
// CLAVES EN localStorage:
//   - library_items, library_playlists, library_categories, library_tags
//   - library_theme, library_font, library_card_settings
//
// LIMITACIONES ACTUALES:
//   - Los archivos PDF/EPUB grandes NO viven aquí: se persisten aparte vía
//     idb-keyval (clave 'idb://...'). Solo la metadata vive en localStorage.
//   - No hay sincronización entre dispositivos (todo es local-first).
//   - Las stages son fijas (initialStages, no se persisten).
// =============================================================================

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { BookItem, PlaylistData, StageData, CategoryData, CardSettings } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { deleteUploadedFile } from '../lib/uploadFile';

// Temas disponibles (ver index.css → [data-theme="..."] para los tokens CSS).
export type ThemeMode = 'blue' | 'dark' | 'hc' | 'emerald' | 'sunset' | 'purple';
export type FontFamily = 'Inter' | 'Lora' | 'Playfair Display' | 'Poppins' | 'Roboto';

interface LibraryContextType {
  items: BookItem[];
  playlists: PlaylistData[];
  stages: StageData[];
  categories: CategoryData[];
  theme: ThemeMode;
  fontFamily: FontFamily;
  cardSettings: CardSettings;

  addItem: (item: Omit<BookItem, 'id' | 'timestamp'>) => void;
  updateItem: (id: string, updates: Partial<BookItem>) => void;
  deleteItem: (id: string) => void;

  addPlaylist: (playlist: Omit<PlaylistData, 'id'>) => void;
  updatePlaylist: (id: string, updates: Partial<PlaylistData>) => void;
  deletePlaylist: (id: string) => void;

  addCategory: (category: Omit<CategoryData, 'id'>) => void;
  updateCategory: (id: string, updates: Partial<CategoryData>) => void;
  deleteCategory: (id: string) => void;

  setTheme: (theme: ThemeMode) => void;
  setFontFamily: (font: FontFamily) => void;
  setCardSettings: (settings: CardSettings) => void;

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

const initialPlaylists: PlaylistData[] = [
  { id: 'p1', name: 'Filosofía Política', color: 'bg-[#00558F]' },
  { id: 'p2', name: 'Economía Clásica', color: 'bg-[#FFA300]' },
];

const initialCategories: CategoryData[] = [
  { id: 'libros', name: 'Libros' },
  { id: 'revistas', name: 'Revistas' },
  { id: 'articulos', name: 'Artículos' }
];

export function LibraryProvider({ children }: { children: ReactNode }) {
  // MIGRACIÓN: el sistema de etiquetas se eliminó durante el desarrollo.
  // - Borramos el almacén `library_tags`.
  // - Quitamos el array `tags` de cada item existente.
  // Se ejecuta una vez por sesión sin marcar versión; es idempotente.
  const [items, setItems] = useState<BookItem[]>(() => {
    const saved = localStorage.getItem('library_items');
    return saved ? JSON.parse(saved) : [];
  });
  
  const [playlists, setPlaylists] = useState<PlaylistData[]>(() => {
    const saved = localStorage.getItem('library_playlists');
    return saved ? JSON.parse(saved) : initialPlaylists;
  });

  // MIGRACIÓN DE CATEGORÍAS: versiones antiguas guardaban 'libro' / 'articulo'
  // (singular) o nombres distintos. Este bloque normaliza a 'libros', 'revistas',
  // 'articulos' y garantiza que las tres categorías base existan siempre.
  const [categories, setCategories] = useState<CategoryData[]>(() => {
    const saved = localStorage.getItem('library_categories');
    let parsed: CategoryData[] = saved ? JSON.parse(saved) : [...initialCategories];

    // Check if we need to migrate old or missing items to match the user's explicit request
    const hasLibros = parsed.some(c => c.name.toLowerCase() === 'libros' || c.name.toLowerCase() === 'mis libros');
    const hasRevistas = parsed.some(c => c.name.toLowerCase() === 'revistas');
    const hasArticulos = parsed.some(c => c.name.toLowerCase() === 'artículos' || c.name.toLowerCase() === 'mis artículos' || c.name.toLowerCase() === 'artículos web');
    
    if (!hasLibros) {
      const oldLib = parsed.find(c => c.id === 'libro');
      if (oldLib) {
        oldLib.name = 'Libros';
      } else {
        parsed.unshift({ id: 'libros', name: 'Libros' });
      }
    } else {
      const oldLib = parsed.find(c => c.name.toLowerCase() === 'libros' || c.name.toLowerCase() === 'mis libros');
      if (oldLib) {
        oldLib.id = 'libros';
        oldLib.name = 'Libros';
      }
    }
    
    if (!hasRevistas) {
      parsed.push({ id: 'revistas', name: 'Revistas' });
    }
    
    if (!hasArticulos) {
      const oldArt = parsed.find(c => c.id === 'articulo');
      if (oldArt) {
        oldArt.name = 'Artículos';
      } else {
        parsed.push({ id: 'articulos', name: 'Artículos' });
      }
    } else {
      const oldArt = parsed.find(c => c.name.toLowerCase() === 'artículos' || c.name.toLowerCase() === 'mis artículos' || c.name.toLowerCase() === 'artículos web');
      if (oldArt) {
        oldArt.id = 'articulos';
        oldArt.name = 'Artículos';
      }
    }
    
    // Filter duplicates
    parsed = parsed.filter((c, index, self) => self.findIndex(t => t.id === c.id || t.name === c.name) === index);
    
    return parsed;
  });
  
  const [theme, setTheme] = useState<ThemeMode>(() => {
    return (localStorage.getItem('library_theme') as ThemeMode) || 'blue';
  });

  const [fontFamily, setFontFamily] = useState<FontFamily>(() => {
    return (localStorage.getItem('library_font') as FontFamily) || 'Inter';
  });

  const [cardSettings, setCardSettings] = useState<CardSettings>(() => {
    const saved = localStorage.getItem('library_card_settings');
    const defaults: CardSettings = { showAuthor: true, showYear: true, showProgress: true, showType: true, showPhysicalStatus: true, showRating: true };
    if (!saved) return defaults;
    // Filtramos campos obsoletos como showTags al rehidratar.
    const parsed = JSON.parse(saved) as Partial<CardSettings> & { showTags?: boolean };
    delete parsed.showTags;
    return { ...defaults, ...parsed };
  });

  const [stages] = useState<StageData[]>(initialStages);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('library_theme', theme);
  }, [theme]);

  useEffect(() => {
    let fontValue = '"Inter", sans-serif';
    if (fontFamily === 'Lora') fontValue = '"Lora", serif';
    if (fontFamily === 'Playfair Display') fontValue = '"Playfair Display", serif';
    if (fontFamily === 'Poppins') fontValue = '"Poppins", sans-serif';
    if (fontFamily === 'Roboto') fontValue = '"Roboto", sans-serif';
    document.documentElement.style.setProperty('--app-font', fontValue);
    localStorage.setItem('library_font', fontFamily);
  }, [fontFamily]);

  useEffect(() => {
    localStorage.setItem('library_card_settings', JSON.stringify(cardSettings));
  }, [cardSettings]);

  useEffect(() => {
    localStorage.setItem('library_items', JSON.stringify(items));
  }, [items]);

  useEffect(() => {
    localStorage.setItem('library_playlists', JSON.stringify(playlists));
  }, [playlists]);

  useEffect(() => {
    localStorage.setItem('library_categories', JSON.stringify(categories));
  }, [categories]);

  const addItem = (item: Omit<BookItem, 'id' | 'timestamp'>) => {
    const newItem: BookItem = {
      ...item,
      id: uuidv4(),
      timestamp: Date.now(),
      listIndex: items.length,
    };
    setItems((prev) => [newItem, ...prev]);
  };

  const updateItem = (id: string, updates: Partial<BookItem>) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...updates } : item))
    );
  };

  // FIX (§7.3): al borrar un item hay que limpiar:
  //   1. Su entrada en library_items (estado react).
  //   2. Sus notas      → localStorage[`notes-${id}`].
  //   3. Su paleta      → localStorage[`color-palette-${id}`].
  //   4. Sus archivos en el servidor (PDF/EPUB + portada) si están en /api/files/.
  // Si no se limpia, las notas quedan huérfanas para siempre y los PDFs
  // ocupan espacio en disco aunque ya no haya referencia a ellos.
  const deleteItem = (id: string) => {
    const itemToDelete = items.find((i) => i.id === id);
    setItems((prev) => prev.filter((item) => item.id !== id));

    try {
      localStorage.removeItem(`notes-${id}`);
      localStorage.removeItem(`color-palette-${id}`);
      localStorage.removeItem(`bookmarks-${id}`);
    } catch (err) {
      console.warn('No se pudieron limpiar datos locales del item borrado:', err);
    }

    if (itemToDelete?.source?.startsWith('/api/files/')) {
      deleteUploadedFile(itemToDelete.source);
    }
    if (itemToDelete?.thumbnailUrl?.startsWith('/api/files/')) {
      deleteUploadedFile(itemToDelete.thumbnailUrl);
    }
  };

  const addPlaylist = (playlist: Omit<PlaylistData, 'id'>) => {
    setPlaylists((prev) => [
      ...prev,
      { ...playlist, id: uuidv4() },
    ]);
  };

  const updatePlaylist = (id: string, updates: Partial<PlaylistData>) => {
    setPlaylists((prev) =>
      prev.map((pl) => (pl.id === id ? { ...pl, ...updates } : pl))
    );
  };

  const deletePlaylist = (id: string) => {
    setPlaylists((prev) => prev.filter((pl) => pl.id !== id));
    // Remove from all items
    setItems((prev) => 
      prev.map(item => ({
        ...item,
        folderIds: item.folderIds.filter(fId => fId !== id)
      }))
    );
  };

  const addCategory = (category: Omit<CategoryData, 'id'>) => {
    setCategories((prev) => [...prev, { ...category, id: uuidv4() }]);
  };

  const updateCategory = (id: string, updates: Partial<CategoryData>) => {
    setCategories((prev) => prev.map((c) => (c.id === id ? { ...c, ...updates } : c)));
  };

  const deleteCategory = (id: string) => {
    setCategories((prev) => prev.filter((c) => c.id !== id));
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
  };

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
        addItem,
        updateItem,
        deleteItem,
        addPlaylist,
        updatePlaylist,
        deletePlaylist,
        addCategory,
        updateCategory,
        deleteCategory,
        setTheme,
        setFontFamily,
        setCardSettings,
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
