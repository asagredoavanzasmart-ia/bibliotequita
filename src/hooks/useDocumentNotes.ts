// =============================================================================
// useDocumentNotes.ts — Fuente única de verdad para notas/citas y paleta de
// colores de un documento (libro o recurso).
// -----------------------------------------------------------------------------
// Antes, NotesPanel y CitationsManager tenían cada uno su propio useState<Note[]>
// + fetch a los mismos endpoints, y ReaderView creaba citas vía un canal
// indirecto (setSelectedCitation) que solo se persistía si NotesPanel estaba
// MONTADO para escucharlo. Como NotesPanel solo se monta cuando el panel de
// Anotaciones está abierto, las citas creadas durante la lectura por voz (TTS)
// con el panel cerrado se perdían: se sobreescribían en el estado de React de
// ReaderView antes de que nada las guardara.
//
// Este hook vive en ReaderView (mismo ciclo de vida que el lector, no el del
// panel) y es la única fuente de verdad: NotesPanel y CitationsManager reciben
// `notes`/`activePalette` y las funciones de mutación por props, en vez de
// tener su propio estado. Crear una cita ya no depende de qué esté montado.
// =============================================================================

import { useState, useEffect, useCallback, useRef } from 'react';

export interface Note {
  id: string;
  documentId: string;
  quote?: string;
  content: string;                  // Markdown. Las citas vienen prefijadas con "> "
  pageReference?: number | string;
  timestamp: number;
  color?: string;                   // 'rose-400' | 'sky-400' | 'emerald-400' | ...
  type?: 'note' | 'bookmark';
}

export interface ColorDefinition {
  id: string;
  color: string;
  bgClass: string;
  borderClass: string;
  textClass: string;
  name: string;
  hex: string;
}

const DEFAULT_PALETTE: ColorDefinition[] = [
  { id: 'rose-400', color: 'rose-400', bgClass: 'bg-rose-50/50', borderClass: 'border-rose-400', textClass: 'text-rose-600', name: 'Rojo', hex: '#fb7185' },
  { id: 'sky-400', color: 'sky-400', bgClass: 'bg-sky-50/50', borderClass: 'border-sky-400', textClass: 'text-sky-600', name: 'Azul', hex: '#38bdf8' },
  { id: 'emerald-400', color: 'emerald-400', bgClass: 'bg-emerald-50/50', borderClass: 'border-emerald-400', textClass: 'text-emerald-600', name: 'Verde', hex: '#34d399' },
  { id: 'amber-400', color: 'amber-400', bgClass: 'bg-amber-50/50', borderClass: 'border-amber-400', textClass: 'text-amber-600', name: 'Amarillo', hex: '#fbbf24' },
  { id: 'slate-400', color: 'slate-400', bgClass: 'bg-slate-50/50', borderClass: 'border-slate-400', textClass: 'text-slate-600', name: 'Gris', hex: '#94a3b8' },
];

const parsePageNum = (ref: any): number => {
  if (typeof ref === 'number') return ref > 0 ? ref : 0;
  if (typeof ref !== 'string') return 0;
  const str = ref.trim();
  if (!/^\d+$/.test(str)) return 0;
  return parseInt(str, 10);
};

const sortNotes = (list: Note[]): Note[] =>
  [...list].sort((a, b) => {
    const pageA = parsePageNum(a.pageReference);
    const pageB = parsePageNum(b.pageReference);
    const hasPageA = pageA > 0;
    const hasPageB = pageB > 0;
    if (hasPageA && hasPageB) {
      if (pageA !== pageB) return pageA - pageB;
    } else if (hasPageA) {
      return -1;
    } else if (hasPageB) {
      return 1;
    }
    return a.timestamp - b.timestamp;
  });

export function useDocumentNotes(documentId: string) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [activePalette, setActivePalette] = useState<ColorDefinition[]>(DEFAULT_PALETTE);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setLoaded(false);
    let cancelled = false;

    Promise.all([
      fetch(`/api/documents/${documentId}/notes`, { credentials: 'include' }).then(r => r.json()).catch(() => ({ notes: [] })),
      fetch(`/api/documents/${documentId}/settings`, { credentials: 'include' }).then(r => r.json()).catch(() => ({ settings: null })),
    ]).then(([notesData, settingsData]) => {
      if (cancelled) return;
      setNotes(Array.isArray(notesData?.notes) ? notesData.notes : []);
      setActivePalette(settingsData?.settings?.colorPalette ?? DEFAULT_PALETTE);
      setLoaded(true);
    });

    return () => { cancelled = true; };
  }, [documentId]);

  // PUT con el array completo (mismo contrato que antes). Al vivir en un único
  // hook compartido, ya no hay dos copias de estado que puedan pisarse entre sí.
  const persistNotes = useCallback((list: Note[]) => {
    fetch(`/api/documents/${documentId}/notes`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: list }),
    }).catch(err => console.error('No se pudieron guardar las notas:', err));
  }, [documentId]);

  const saveNotes = useCallback((updater: Note[] | ((prev: Note[]) => Note[])) => {
    setNotes(prev => {
      const updated = typeof updater === 'function' ? updater(prev) : updater;
      const sorted = sortNotes(updated);
      persistNotes(sorted);
      return sorted;
    });
  }, [persistNotes]);

  // Al escribir el nombre de un color se llama una vez por tecla. Sin debounce,
  // cada pulsación dispara su propio PUT y, si dos llegan al servidor fuera de
  // orden (la del penúltimo carácter responde después que la del último), el
  // nombre final visible queda con una versión vieja. Se debounce 400ms y solo
  // se envía la versión más reciente; si el componente se desmonta antes de
  // que venza el debounce, el guardado pendiente se envía de inmediato (no se
  // pierde un cambio reciente por cerrar el panel rápido).
  const savePaletteTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPaletteRef = useRef<ColorDefinition[] | null>(null);
  const flushPalette = useCallback(async (palette: ColorDefinition[]) => {
    pendingPaletteRef.current = null;
    try {
      const res = await fetch(`/api/documents/${documentId}/settings`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ colorPalette: palette }),
      });
      // fetch NO rechaza en 4xx/5xx: un fallo del servidor (columna, RLS,
      // sesión) llegaba como respuesta OK-a-nivel-promesa y se perdía en
      // silencio ("los colores no se guardan"). Ahora se detecta y se avisa.
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        console.error(`No se pudo guardar la paleta (HTTP ${res.status}):`, body.slice(0, 300));
      }
    } catch (err) {
      console.error('Error de red al guardar la paleta de colores:', err);
    }
  }, [documentId]);

  const savePalette = useCallback((updater: ColorDefinition[] | ((prev: ColorDefinition[]) => ColorDefinition[])) => {
    setActivePalette(prev => {
      const updated = typeof updater === 'function' ? updater(prev) : updater;
      pendingPaletteRef.current = updated;
      if (savePaletteTimeoutRef.current) clearTimeout(savePaletteTimeoutRef.current);
      // Debounce corto: agrupa el tecleo del nombre sin arriesgar perder el
      // cambio si el usuario cierra el modal enseguida (además hay flush
      // explícito en flushPaletteNow y al desmontar).
      savePaletteTimeoutRef.current = setTimeout(() => flushPalette(updated), 250);
      return updated;
    });
  }, [flushPalette]);

  // Fuerza el guardado inmediato de la paleta pendiente (p. ej. al cerrar el
  // modal de configuración de colores): garantiza que el cambio se escriba
  // sin esperar al debounce ni depender del desmontaje.
  const flushPaletteNow = useCallback(() => {
    if (savePaletteTimeoutRef.current) { clearTimeout(savePaletteTimeoutRef.current); savePaletteTimeoutRef.current = null; }
    if (pendingPaletteRef.current) flushPalette(pendingPaletteRef.current);
  }, [flushPalette]);

  useEffect(() => () => {
    if (savePaletteTimeoutRef.current) clearTimeout(savePaletteTimeoutRef.current);
    if (pendingPaletteRef.current) flushPalette(pendingPaletteRef.current);
  }, [flushPalette]);

  // Evita crear la misma cita dos veces si addCitation se invoca con el mismo
  // timestamp (p.ej. doble disparo de un evento) y deduplica por contenido+página.
  const lastCitationTimestampRef = useRef<number | null>(null);
  const addCitation = useCallback((params: { text: string; color: string; page?: number | string; timestamp?: number }) => {
    const timestamp = params.timestamp ?? Date.now();
    if (lastCitationTimestampRef.current === timestamp) return;
    lastCitationTimestampRef.current = timestamp;

    const newNote: Note = {
      id: crypto.randomUUID(),
      documentId,
      content: `> ${params.text}`,
      pageReference: params.page,
      timestamp,
      color: params.color,
      type: 'note',
    };
    const isDuplicate = (list: Note[]) => list.some(n =>
      n.type !== 'bookmark' &&
      n.content.trim() === newNote.content.trim() &&
      String(n.pageReference ?? '') === String(newNote.pageReference ?? '')
    );
    saveNotes(prev => isDuplicate(prev) ? prev : [...prev, newNote]);
  }, [documentId, saveNotes]);

  const addNote = useCallback((content: string, page?: number | string) => {
    const newNote: Note = {
      id: crypto.randomUUID(),
      documentId,
      content,
      pageReference: page,
      timestamp: Date.now(),
      type: 'note',
    };
    saveNotes(prev => [...prev, newNote]);
  }, [documentId, saveNotes]);

  const addBookmark = useCallback((page?: number | string) => {
    const newBookmark: Note = {
      id: crypto.randomUUID(),
      documentId,
      content: 'Nuevo Marcador',
      pageReference: page,
      timestamp: Date.now(),
      type: 'bookmark',
      color: 'sky-400',
    };
    saveNotes(prev => [...prev, newBookmark]);
  }, [documentId, saveNotes]);

  const editNote = useCallback((id: string, patch: Partial<Pick<Note, 'content' | 'pageReference' | 'color'>>) => {
    saveNotes(prev => prev.map(n => n.id === id ? { ...n, ...patch } : n));
  }, [saveNotes]);

  const deleteNote = useCallback((id: string) => {
    saveNotes(prev => prev.filter(n => n.id !== id));
  }, [saveNotes]);

  return {
    notes,
    activePalette,
    loaded,
    saveNotes,
    savePalette,
    flushPaletteNow,
    addCitation,
    addNote,
    addBookmark,
    editNote,
    deleteNote,
  };
}
