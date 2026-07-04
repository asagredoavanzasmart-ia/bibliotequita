// =============================================================================
// ReaderView.tsx — Pantalla de lectura
// -----------------------------------------------------------------------------
// Hub central de la experiencia de lectura. Coordina:
//   - <PDFReader>      → render de PDF con react-pdf (zoom, paginación, scroll).
//   - <EPUBReader>     → render de EPUB con react-reader.
//   - <iframe>         → para recursos 'externa' (URLs web).
//   - <NotesPanel>     → panel lateral/inferior de notas y citas.
//   - <CitationsManager> → administrador completo de citas + resúmenes IA.
//   - <EditBookModal>  → vista de metadatos del recurso (inline=true).
//
// Características clave:
//   * Split-view redimensionable (horizontal en desktop, vertical en móvil).
//   * Selección de texto → toolbar flotante con colores para crear cita.
//   * Bookmarks: guarda página actual en BookItem.bookmarkPage → reanuda lectura.
//   * Brillo, pantalla completa y posición notes (izq/der) son estado local.
//   * activePalette (colores de citas) se persiste por libro en
//     localStorage[`color-palette-${bookId}`].
// =============================================================================

import { useLibrary } from '../hooks/useLibrary';
import { ChevronLeft, Maximize, View, Columns, Check, Edit2, MessageSquareQuote, ArrowRightLeft, ArrowUpDown, Minimize, Hand, Type, Sun, BookOpen, Book as BookIcon, ClipboardList, Info, Volume2, Play, Pause, Square, Loader2, SkipBack, SkipForward, Rewind, FastForward, FlaskConical, X, Settings, ChevronUp, FolderOpen } from 'lucide-react';
import { useState, useRef, FormEvent, ChangeEvent, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import type { Rendition } from 'epubjs';
import { cn, getBookSources, resolvePrimarySource } from '../lib/utils';
import type { ResourceType } from '../types';
import { PDFReader } from './PDFReader';
import { EPUBReader } from './EPUBReader';
import { TxtReader } from './TxtReader';
import { FolderManagerModal } from './FolderManagerModal';
import { NotesPanel } from './NotesPanel';
import { EditBookModal } from './EditBookModal';
import { CitationsManager } from './CitationsManager';
import { BookmarksMenu } from './BookmarksMenu';
import { AuditorPanel } from './AuditorPanel';
import { ResourcesPanel } from './ResourcesPanel';
import { useReadingTimeTracker } from '../hooks/useReadingTime';
import { useWakeLock } from '../hooks/useWakeLock';
import { useDocumentNotes } from '../hooks/useDocumentNotes';

interface ReaderViewProps {
  bookId: string;
  onClose: () => void;
}

// Abreviaturas comunes en español académico/literario que terminan en punto
// pero NO marcan fin de oración. Usadas por splitIntoPhrases (segmentador de
// oraciones del lector de voz) para no cortar en medio de "Dr.", "p.ej.", etc.
const SENTENCE_ABBREVIATIONS = new Set([
  'sr', 'sra', 'srta', 'dr', 'dra', 'prof', 'profa', 'ud', 'uds', 'vd', 'vds',
  'etc', 'vs', 'ej', 'núm', 'num', 'av', 'avda', 'art', 'pág', 'pag', 'cap',
  'vol', 'fig', 'ed', 'eds', 'excmo', 'excma', 'ilmo', 'ilma', 'gob', 'depto',
  'cía', 'ca', 'sa', 'ltda',
]);

// Una línea es "número de página" si es solo dígitos, o dígitos rodeados de
// guiones/puntos/espacios ("- 18 -", "19.", "Pág. 20", "[20]") → no se lee.
function isPageNumberLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  return /^[\s.\-–—[\]()]*\d{1,4}[\s.\-–—[\]()]*$/.test(t) ||
         /^(p[aá]g(\.|ina)?|page)\s*\.?\s*\d{1,4}\.?$/i.test(t);
}

// Una línea es "título/encabezado" si NO termina en signo de oración ni coma,
// es relativamente corta y no es un párrafo → se lee como unidad propia.
function isHeadingLine(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 90) return false;
  if (/[.,;:?!…]$/.test(t)) return false;
  if (t.split(/\s+/).length > 14) return false;
  return true;
}

// Convierte un color hex (#rgb o #rrggbb) a rgba(r,g,b,alpha). Si el color ya
// viene en otro formato (rgb/rgba/nombre), lo devuelve tal cual.
// Se usa para resaltar citas SIN la propiedad `opacity` (que rompe el
// mix-blend-mode: multiply al crear un stacking context aislado). Metiendo el
// alfa dentro del color, el multiply sigue mezclándose con el texto negro del
// canvas que está debajo y el negro no queda cubierto.
function toRgba(color: string, alpha: number): string {
  const hex = color.trim();
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex);
  if (!m) return color;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function ReaderView({ bookId, onClose }: ReaderViewProps) {
  const { items, updateItem, categories } = useLibrary();
  const item = items.find(i => i.id === bookId);
  // Nombre de la categoría del item (BookItem.category guarda el id).
  const itemCategoryName = categories.find(c => c.id === item?.category)?.name ?? '';
  const isPhysicalOnly = item ? (item.ownedPhysical && (!item.source || item.source.trim() === '')) : false;

  // Registra tiempo de lectura diario mientras este libro está abierto.
  useReadingTimeTracker(!!item);

  // Fuente única de verdad de notas/citas y paleta de colores del libro: vive
  // aquí (mismo ciclo de vida que el lector) para que crear una cita NO
  // dependa de que el panel de Anotaciones esté montado — antes, las citas
  // creadas durante la lectura por voz (TTS) con el panel cerrado se perdían
  // porque la persistencia ocurría en un efecto dentro de NotesPanel.
  const {
    notes: documentNotes,
    activePalette,
    savePalette,
    saveNotes: saveDocumentNotes,
    addCitation,
    addNote: addDocumentNote,
    addBookmark: addDocumentBookmark,
    editNote: editDocumentNote,
    deleteNote: deleteDocumentNote,
  } = useDocumentNotes(bookId);

  const [activeTab, setActiveTab ] = useState<'reader' | 'edit' | 'citations' | 'auditor' | 'resources'>('reader');
  
  const [showFolderManager, setShowFolderManager ] = useState(false);
  const [showNotes, setShowNotes ] = useState(false);

  const [selectedText, setSelectedText ] = useState('');
  const [selectionRect, setSelectionRect ] = useState<{ top: number, left: number, width: number, bottom: number } | null>(null);

  // Referencia a la Rendition de epubjs — necesaria para acceder al contenido
  // del iframe interno (selección de texto para citas y extracción para TTS).
  const epubRenditionRef = useRef<Rendition | null>(null);
  
  // Start from bookmark page if saved to re-resume exactly where reader left off 
  const [currentPage, setCurrentPage ] = useState<number | string>(item?.bookmarkPage || 1);
  const [targetPage, setTargetPage ] = useState<{ page: number, t: number } | undefined>(
    item?.bookmarkPage ? { page: Number(item.bookmarkPage), t: Date.now() } : undefined
  );
  
  const [totalPages, setTotalPages ] = useState<number>(100);

  // Resaltado pendiente al navegar desde una cita guardada (CitationsManager):
  // se aplica una vez que la página/sección destino termina de renderizarse.
  const [pendingHighlight, setPendingHighlight] = useState<{ text: string; color: string } | null>(null);

  // --- Estados de Lector de Voz (TTS ElevenLabs) ------------------------------
  const [showTtsWidget, setShowTtsWidget] = useState(false);
  // El panel de configuración (modelo/voz/origen de lectura) queda colapsado
  // por defecto para que la barra inferior del reproductor sea compacta.
  const [showTtsSettings, setShowTtsSettings] = useState(false);
  const ttsWidgetRef = useRef<HTMLDivElement>(null);
  // Slot DOM dentro de la fila de controles del widget TTS donde PDFReader/
  // EPUBReader portan (createPortal) sus controles de índice/página/zoom
  // cuando el TTS está abierto, fusionándolos junto a los puntos de color.
  const [mergedBarSlotEl, setMergedBarSlotEl] = useState<HTMLDivElement | null>(null);
  const [ttsStatus, setTtsStatus] = useState<'idle' | 'loading' | 'playing' | 'paused' | 'error'>('idle');
  // Mantener la pantalla encendida mientras se genera o reproduce audio.
  useWakeLock(ttsStatus === 'playing' || ttsStatus === 'loading');
  const [ttsErrorMessage, setTtsErrorMessage] = useState('');
  const [currentAudio, setCurrentAudio] = useState<HTMLAudioElement | null>(null);
  const [ttsTextSource, setTtsTextSource] = useState<'selection' | 'page'>('page');

  // Origen de inicio de la lectura al presionar Play (no aplica si hay texto
  // seleccionado, que siempre se lee tal cual).
  const [ttsStartSource, setTtsStartSource] = useState<'visible' | 'chapter' | 'lastRead'>('visible');

  // Proveedores de Voz
  const [selectedProvider, setSelectedProvider] = useState<'elevenlabs' | 'google' | 'google-standard'>('elevenlabs');

  // Voces favoritas persistidas en localStorage
  const [favoriteVoices, setFavoriteVoices] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('tts-favorite-voices') || '[]'); } catch { return []; }
  });
  const [showVoiceDropdown, setShowVoiceDropdown] = useState(false);
  // El dropdown de voces se renderiza vía portal en document.body (en vez de
  // dentro del widget TTS) porque el widget tiene overflow-hidden para
  // limitar su alto en móvil — sin el portal, las voces que sobresalían del
  // recuadro del widget quedaban recortadas/invisibles ("no cargan todas").
  const voiceButtonRef = useRef<HTMLButtonElement>(null);
  // anchorBottom=true ancla el panel por abajo (crece hacia arriba, caso normal:
  // el botón de voz está cerca del borde inferior, p.ej. en el widget TTS). Si no
  // hay espacio suficiente arriba (botón muy alto en la pantalla, común en el
  // widget TTS compacto de móvil), se ancla por arriba en su lugar y la lista se
  // limita con maxHeight al espacio real disponible — antes, al anclar siempre
  // por abajo, el panel podía salirse del viewport por arriba y solo se veía la
  // primera voz (Catalina), con el resto recortado fuera de la pantalla.
  const [voiceDropdownPos, setVoiceDropdownPos] = useState<{ left: number; top?: number; bottom?: number; maxHeight: number } | null>(null);

  const computeVoiceDropdownPos = useCallback(() => {
    if (!voiceButtonRef.current) return;
    const rect = voiceButtonRef.current.getBoundingClientRect();
    const spaceAbove = rect.top - 8;
    const spaceBelow = window.innerHeight - rect.bottom - 8;
    const left = rect.right - 256;
    if (spaceAbove >= 120 || spaceAbove >= spaceBelow) {
      setVoiceDropdownPos({ left, bottom: window.innerHeight - rect.top + 4, maxHeight: Math.min(280, Math.max(120, spaceAbove)) });
    } else {
      setVoiceDropdownPos({ left, top: rect.bottom + 4, maxHeight: Math.min(280, Math.max(120, spaceBelow)) });
    }
  }, []);

  // El botón "Voz" suele abrirse justo después del widget TTS, que todavía
  // se está deslizando hacia arriba (animate-in slide-in-from-bottom-2,
  // 300ms). Si el usuario toca "Voz" durante esa animación, el rect medido en
  // el click queda obsoleto (posición intermedia, no final) y el desplegable
  // se planta mal — pareciendo que "no se abrió" hasta otra interacción que
  // fuerce un recálculo correcto. Mientras el desplegable está abierto, se
  // re-mide la posición en cada frame durante ~350ms (cubre la animación) para
  // que se autocorrija sin que el usuario tenga que volver a tocar nada.
  useEffect(() => {
    if (!showVoiceDropdown) return;
    let frame: number;
    const deadline = performance.now() + 350;
    const tick = () => {
      computeVoiceDropdownPos();
      if (performance.now() < deadline) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [showVoiceDropdown, computeVoiceDropdownPos]);

  const toggleFavoriteVoice = useCallback((voiceId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setFavoriteVoices(prev => {
      const next = prev.includes(voiceId) ? prev.filter(id => id !== voiceId) : [...prev, voiceId];
      localStorage.setItem('tts-favorite-voices', JSON.stringify(next));
      return next;
    });
  }, []);

  // Voces de ElevenLabs
  const ELEVENLABS_VOICES = useMemo(() => [
    // 🇨🇱 Voces chilenas
    { id: '6Gr4AVmTax1pMJO0lHRK', name: '🇨🇱 Catalina (Femenina Chilena)' },
    { id: 'Fd38GRHtJllY0CuguAy9', name: '🇨🇱 Victoria (Femenina Profesional)' },
    { id: 'lLsDvdl6OjtZfLJPM2HA', name: '🇨🇱 Isa Pro (Femenina Cálida)' },
    { id: 'cLzIVykddLltvgkzos6C', name: '🇨🇱 Vale (Femenina Amigable)' },
    { id: 'OFrdGXwCzoE56a9sp1fk', name: '🇨🇱 Marco (Masculino Cálido)' },
    { id: '6WgXEzo1HGn3i7ilT4Fh', name: '🇨🇱 Vicente Pro (Masculino Profesional)' },
    { id: 'ClNifCEVq1smkl4M3aTk', name: '🇨🇱 Cristian (Masculino Fluido)' },
    { id: '0cheeVA5B3Cv6DGq65cT', name: '🇨🇱 Alejandro (Conversacional)' },
    { id: '9ZVfdvBemUaGEWZgCiv0', name: '🇨🇱 Mateo (Masculino)' },
    { id: '6ZDFxWiAykFxCoe683WK', name: '🇨🇱 El Cordovez (Masculino)' },
    // 🌎 Voces latinoamericanas
    { id: '9EU0h6CVtEDS6vriwwq5', name: '🌎 Verónica (Femenina Suave)' },
    { id: 'V6isiXLBuRuM7uwHOVBA', name: '🌎 Luisa (Femenina Calmada)' },
    { id: 'p5EUznrYaWnafKvUkNiR', name: '🌎 Gaby (Natural Casual)' },
    { id: '4XUsiqPDK4UACIM2BILe', name: '🌎 JC (Locutor Enérgico)' },
  ], []);

  // Voces de Google Gemini TTS
  const GOOGLE_VOICES = useMemo(() => [
    { id: 'Erinome', name: '🇨🇱 Erinome (Ágil y Alegre)' },
    { id: 'Autonoe', name: '🇨🇱 Autonoe (Energía y Alegría)' },
    { id: 'Erin', name: '🇨🇱 Erin (Voz Activa 20a)' },
    { id: 'Aoede', name: '🇨🇱 Aoede (Voz Alegre 20a)' }
  ], []);

  // Modelos de Google Gemini TTS
  const GOOGLE_MODELS = useMemo(() => [
    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash (Recomendado)' },
    { id: 'gemini-2.5-pro-preview-tts', name: 'Gemini 2.5 Pro (Estudio - Cuota Baja)' }
  ], []);

  // Voces de Google Cloud TTS Standard (gratis hasta 4M chars/mes)
  const GOOGLE_STANDARD_VOICES = useMemo(() => [
    { id: 'es-ES-Standard-A', name: 'es-ES Standard A (Femenina)' },
    { id: 'es-ES-Standard-B', name: 'es-ES Standard B (Masculina)' },
    { id: 'es-ES-Standard-C', name: 'es-ES Standard C (Femenina)' },
    { id: 'es-ES-Standard-D', name: 'es-ES Standard D (Femenina)' },
    { id: 'es-US-Standard-A', name: 'es-US Standard A (Femenina)' },
    { id: 'es-US-Standard-B', name: 'es-US Standard B (Masculina)' },
    { id: 'es-ES-Neural2-A', name: 'es-ES Neural2 A (Femenina)' },
    { id: 'es-ES-Neural2-B', name: 'es-ES Neural2 B (Masculina)' },
    { id: 'es-ES-Neural2-C', name: 'es-ES Neural2 C (Femenina)' },
  ], []);

  const [selectedVoice, setSelectedVoice] = useState('6Gr4AVmTax1pMJO0lHRK');
  const [selectedModel, setSelectedModel] = useState('gemini-2.0-flash');

  // Al abrir el lector, si el usuario tiene voces marcadas como favoritas,
  // arrancar con la primera favorita (y su proveedor correspondiente) en vez de
  // la voz por defecto. Solo se aplica una vez al montar para no pisar la
  // elección manual del usuario durante la sesión.
  const appliedFavoriteVoiceRef = useRef(false);
  useEffect(() => {
    if (appliedFavoriteVoiceRef.current) return;
    if (!favoriteVoices || favoriteVoices.length === 0) return;
    const favId = favoriteVoices[0];
    const provider: 'elevenlabs' | 'google' | 'google-standard' | null =
      ELEVENLABS_VOICES.some(v => v.id === favId) ? 'elevenlabs' :
      GOOGLE_VOICES.some(v => v.id === favId) ? 'google' :
      GOOGLE_STANDARD_VOICES.some(v => v.id === favId) ? 'google-standard' : null;
    if (provider) {
      appliedFavoriteVoiceRef.current = true;
      setSelectedProvider(provider);
      setSelectedVoice(favId);
    }
  }, [favoriteVoices, ELEVENLABS_VOICES, GOOGLE_VOICES, GOOGLE_STANDARD_VOICES]);

  // Frases extraídas para navegación paso a paso
  const [phrases, setPhrases] = useState<string[]>([]);
  const [currentPhraseIndex, setCurrentPhraseIndex] = useState(-1);

  // --- Memoria de posición del lector de voz ---------------------------------
  // Guarda en localStorage la última frase reproducida (página/CFI + índice +
  // texto) para que, al volver a presionar "Play", la lectura continúe donde
  // quedó en vez de reiniciar siempre desde el primer párrafo visible.
  const ttsPositionKey = `tts-position-${bookId}`;

  const saveTtsPosition = useCallback((phraseIndex: number, phraseText: string) => {
    try {
      localStorage.setItem(ttsPositionKey, JSON.stringify({
        page: item?.type === 'epub' ? null : currentPage,
        phraseIndex,
        phraseText,
      }));
    } catch { /* localStorage no disponible */ }
  }, [ttsPositionKey, item?.type, currentPage]);

  const loadTtsPosition = useCallback((phraseList: string[]): number => {
    try {
      const raw = localStorage.getItem(ttsPositionKey);
      if (!raw) return 0;
      const saved = JSON.parse(raw) as { page: number | string | null; phraseIndex: number; phraseText: string };
      // Para PDF/TXT la posición solo aplica si seguimos en la misma página;
      // para EPUB (sin páginas) basta con que la frase exacta siga presente
      // en el texto visible actual.
      if (item?.type !== 'epub' && String(saved.page) !== String(currentPage)) return 0;
      if (saved.phraseIndex >= 0 && saved.phraseIndex < phraseList.length && phraseList[saved.phraseIndex] === saved.phraseText) {
        return saved.phraseIndex;
      }
    } catch { /* posición inválida o inexistente */ }
    return 0;
  }, [ttsPositionKey, item?.type, currentPage]);

  // Referencia para la precarga (pre-fetching) de la siguiente frase de audio
  const preloadedAudioRef = useRef<{ index: number; audio: HTMLAudioElement; url: string } | null>(null);

  // AbortController para cancelar fetches TTS en vuelo al cambiar proveedor/modelo
  const ttsAbortRef = useRef<AbortController | null>(null);

  // Debounce de avance/retroceso rápido de frase (ver scheduleTtsStep más abajo)
  const ttsStepTargetRef = useRef<number | null>(null);
  const ttsStepTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Ref estable a playPhrase para usarla desde onended sin capturar closures stale
  const playPhraseRef = useRef<((index: number, phraseList: string[]) => Promise<void>) | null>(null);
  // Ref estable a "avanzar página y seguir leyendo" para encadenar al terminar
  // la página actual sin que la lectura se detenga (lectura continua).
  const handleTtsNextPageRef = useRef<(() => void | Promise<void>) | null>(null);
  // true mientras hay una sesión de lectura activa: distingue "se acabó la
  // página" (debe avanzar a la siguiente) de "el usuario detuvo" (no avanza).
  const ttsActiveRef = useRef(false);

  // Timeout del reintento de resaltado EPUB (ver highlightPhraseInEpub más abajo)
  const epubHighlightRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Timeout del reintento de resaltado PDF (la página destino puede no estar
  // montada todavía si el visor virtualiza páginas — ver highlightPhraseInDOM).
  const pdfHighlightRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Resaltados de cita (persistentes) pintados sobre el PDF visible y última
  // frase no persistente del TTS: los rects son píxeles absolutos calculados
  // para la escala vigente al pintarlos, así que al cambiar el zoom hay que
  // repintarlos desde estos registros (ver handlePdfScaleChange).
  const paintedCitationsRef = useRef<{ phrase: string; hex: string }[]>([]);
  const lastTtsHighlightRef = useRef<{ phrase: string; hex?: string } | null>(null);
  const scaleRepaintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Texto visible en los iframes internos de la rendition de epubjs (vista
  // de página única o doble — concatena todas las páginas activas).
  const getEpubVisibleText = useCallback(() => {
    const contentsList = (epubRenditionRef.current as any)?.manager?.getContents?.() || [];
    return contentsList
      .map((c: any) => c?.document?.body?.textContent || '')
      .map((t: string) => t.replace(/\s+/g, ' ').trim())
      .filter((t: string) => t.length > 0)
      .join(' \n');
  }, []);

  // rendition.next()/prev() de epubjs son asíncronos; esperar un timeout fijo
  // antes de leer el contenido nuevo es poco fiable (en secciones grandes o
  // dispositivos lentos el render todavía no terminó, y se lee/lleva texto
  // desincronizado de lo que el usuario ve en pantalla). El evento
  // 'relocated' confirma cuándo el cambio de sección ya se aplicó.
  const waitForEpubRelocated = useCallback((timeoutMs = 2000): Promise<void> => {
    return new Promise((resolve) => {
      const rendition = epubRenditionRef.current as any;
      if (!rendition) { resolve(); return; }
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        rendition.off?.('relocated', onRelocated);
        clearTimeout(timer);
        resolve();
      };
      const onRelocated = () => finish();
      const timer = setTimeout(finish, timeoutMs);
      rendition.on?.('relocated', onRelocated);
    });
  }, []);

  // Agrupa los spans de la capa de texto de pdf.js en LÍNEAS reales (por
  // posición vertical) y cada línea conserva sus spans en orden. Es la ÚNICA
  // función que decide "qué es una línea" — la usan tanto getActivePageText
  // (para construir el string que se segmenta) como highlightPhraseInDOM
  // (para resaltar). Antes existían dos reconstrucciones de texto
  // independientes (una para extraer, otra para resaltar) que normalizaban
  // espacios de forma sutilmente distinta entre renglones — cuando el join
  // insertaba un espacio que el DOM plano no tenía (común en texto
  // justificado, donde una línea no siempre termina en espacio real), los
  // índices de carácter se desalineaban, el match exacto fallaba, y el
  // resaltado caía al respaldo impreciso de "primeras palabras" — lo cual
  // pintaba de más (un párrafo entero en vez de una oración).
  // Cada línea produce, además del texto normalizado, un charMap con UNA
  // entrada por carácter de `text` apuntando al nodo de texto del DOM y al
  // offset crudo del que proviene. Con eso el resaltado puede construir
  // Ranges exactos por carácter (getClientRects) en vez de pintar spans
  // enteros — que era la causa de que la marca cubriera renglones completos
  // cruzando límites de oración (1 span de pdf.js ≈ 1 renglón).
  //
  // La normalización se hace carácter a carácter con NFKC (ligaduras 'ﬁ'→'fi'),
  // descartando invisibles (soft hyphen U+00AD, zero-width) y colapsando
  // rachas de espacios — PDFs con ese tipo de caracteres hacían fallar el
  // match exacto de la frase ("en este PDF no marca nada").
  const buildPageLines = useCallback((pageEl: Element): { top: number; text: string; charMap: { node: Text; offset: number }[] }[] => {
    const textLayer = pageEl.querySelector('.react-pdf__Page__textContent');
    if (!textLayer) return [];
    const allSpans = Array.from(textLayer.querySelectorAll('span')) as HTMLElement[];
    const realSpans = allSpans.filter(s => (s.textContent || '').trim().length > 0);
    if (realSpans.length === 0) return [];

    const TOLERANCE = 6; // px: spans con top dentro de este margen = misma línea
    const rawLines: { top: number; spans: HTMLElement[] }[] = [];
    for (const span of realSpans) {
      const top = span.offsetTop;
      const existing = rawLines.find(l => Math.abs(l.top - top) <= TOLERANCE);
      if (existing) existing.spans.push(span);
      else rawLines.push({ top, spans: [span] });
    }
    rawLines.sort((a, b) => a.top - b.top);

    const INVISIBLES = new Set(['\u00AD', '\u200B', '\u200C', '\u200D', '\uFEFF']);
    const lines: { top: number; text: string; charMap: { node: Text; offset: number }[] }[] = [];
    for (const rl of rawLines) {
      let text = '';
      const charMap: { node: Text; offset: number }[] = [];
      let prevSpace = true; // true inicial = trim izquierdo implícito
      for (const span of rl.spans) {
        const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
        let tn: Node | null;
        while ((tn = walker.nextNode())) {
          const raw = tn.textContent || '';
          for (let i = 0; i < raw.length; i++) {
            const expanded = raw[i].normalize('NFKC'); // 'ﬁ' → 'fi', etc.
            for (const c of expanded) {
              if (INVISIBLES.has(c)) continue;
              if (/\s/.test(c)) {
                if (prevSpace) continue;
                text += ' ';
                charMap.push({ node: tn as Text, offset: i });
                prevSpace = true;
              } else {
                text += c;
                charMap.push({ node: tn as Text, offset: i });
                prevSpace = false;
              }
            }
          }
        }
      }
      // Trim derecho (el izquierdo lo hace prevSpace=true inicial).
      while (text.endsWith(' ')) { text = text.slice(0, -1); charMap.pop(); }
      if (text.length > 0) lines.push({ top: rl.top, text, charMap });
    }
    return lines;
  }, []);

  // Texto ESTRUCTURADO de una página PDF concreta (bloques '\n\n' por gap
  // vertical, renglones '\n'). Parametrizado por número de página para que el
  // avance automático de página del audiolibro use EXACTAMENTE la misma
  // extracción que el Play inicial — antes ese camino usaba textContent plano
  // + split('.') ingenuo, y todo el sistema (segmentación de punto a punto,
  // títulos, resaltado) se degradaba en cuanto el lector pasaba de página.
  const getPdfPageStructuredText = useCallback((pageNum: number | string): string => {
    const pageEl = document.getElementById(`pdf-page-${pageNum}`);
    if (!pageEl) return '';

    const textLayer = pageEl.querySelector('.react-pdf__Page__textContent');
    const cleanLines = buildPageLines(pageEl);

    if (cleanLines.length > 0) {
      // Interlineado típico = mediana de los gaps verticales entre
      // renglones consecutivos. Un gap claramente mayor (~1.6×) indica
      // separación de BLOQUE (título ↔ párrafo, párrafo ↔ párrafo): se
      // marca con doble salto '\n\n'. Dentro de un mismo bloque, los
      // renglones van con un solo '\n' (wrap de columna).
      const gaps: number[] = [];
      for (let i = 1; i < cleanLines.length; i++) gaps.push(cleanLines[i].top - cleanLines[i - 1].top);
      const sortedGaps = [...gaps].sort((a, b) => a - b);
      const medianGap = sortedGaps.length > 0 ? sortedGaps[Math.floor(sortedGaps.length / 2)] : 0;
      const blockThreshold = medianGap > 0 ? medianGap * 1.6 : Infinity;

      let out = cleanLines[0].text;
      for (let i = 1; i < cleanLines.length; i++) {
        const gap = cleanLines[i].top - cleanLines[i - 1].top;
        out += (gap > blockThreshold ? '\n\n' : '\n') + cleanLines[i].text;
      }
      if (out.trim()) return out;
    }
    // Respaldo si no hay capa de texto con spans posicionados.
    const text = textLayer ? textLayer.textContent : pageEl.textContent;
    return text ? text.replace(/\s+/g, ' ').trim() : '';
  }, [buildPageLines]);

  // Función para extraer texto del DOM de la página activa del PDF, TXT o EPUB
  const getActivePageText = useCallback(() => {
    if (item?.type === 'pdf') {
      return getPdfPageStructuredText(currentPage);
    }
    if (item?.type === 'txt') {
      const el = document.getElementById('txt-content');
      if (!el) return '';
      // En TXT los saltos de línea reales ya están en el innerText; se conservan.
      return ((el as HTMLElement).innerText || el.textContent || '').replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
    }
    if (item?.type === 'epub') {
      return getEpubVisibleText();
    }
    return '';
  }, [item?.type, currentPage, getEpubVisibleText, getPdfPageStructuredText]);

  // Divide el texto en unidades de lectura SIEMPRE de punto a punto (seguido
  // o aparte — ambos son el mismo carácter ".", la diferencia es de formato
  // de párrafo, no de criterio de corte). Es la única regla: no se corta en
  // "?"/"!"/"…"/";" — quedan dentro de la misma frase hasta el próximo punto.
  // Así "Frase Siguiente"/"Frase Anterior" avanzan siempre la misma distancia
  // conceptual, sin que el criterio cambie según el tipo de oración.
  //
  // El criterio anterior (`text.split('.')` ingenuo) cortaba también en
  // abreviaturas ("Dr.", "p.ej.", "Av."), iniciales ("J.R.R.") y números
  // decimales ("3.14") — de ahí que el TTS "seleccionara frases casi
  // aleatorias". Aquí se recorre el texto carácter a carácter y solo se corta
  // en un punto cuando el contexto inmediato descarta esos falsos positivos.
  // Corta UN párrafo (texto ya en una sola línea) en oraciones de punto a
  // punto, descartando los falsos positivos de "." (decimales, iniciales,
  // abreviaturas, elipsis). No corta en "?"/"!"/";".
  const splitParagraphIntoSentences = useCallback((paragraph: string): string[] => {
    const normalized = paragraph.replace(/\s+/g, ' ').trim();
    if (!normalized) return [];
    const sentences: string[] = [];
    let start = 0;
    for (let i = 0; i < normalized.length; i++) {
      if (normalized[i] !== '.') continue;
      if (/\d/.test(normalized[i - 1] ?? '') && /\d/.test(normalized[i + 1] ?? '')) continue;
      if (normalized[i + 1] === '.') continue;
      const prevChar = normalized[i - 1] ?? '';
      const beforePrev = normalized[i - 2] ?? '';
      const isInitial = /[A-ZÁÉÍÓÚÑ]/.test(prevChar) && (beforePrev === '' || beforePrev === ' ' || beforePrev === '.');
      if (isInitial) continue;
      const wordMatch = normalized.slice(0, i).match(/([a-záéíóúñ]+)$/i);
      if (wordMatch && SENTENCE_ABBREVIATIONS.has(wordMatch[1].toLowerCase())) continue;
      if (/[a-záéíóúñ]/.test(normalized[i + 1] ?? '')) continue;
      let end = i + 1;
      while (end < normalized.length && /["'”’)\]]/.test(normalized[end])) end++;
      const sentence = normalized.slice(start, end).trim();
      if (sentence.length > 0) sentences.push(sentence);
      start = end;
    }
    const rest = normalized.slice(start).trim();
    if (rest.length > 0) sentences.push(rest);
    return sentences;
  }, []);

  // Convierte el texto de la página en las unidades de lectura del TTS. El
  // texto viene separado en BLOQUES por '\n\n' (cada bloque es un párrafo, un
  // título o un número de página — detectados en getActivePageText por el gap
  // vertical real entre renglones). Dentro de un bloque, los renglones van con
  // un solo '\n' (wrap de columna) y se unen en un párrafo:
  //   - bloque que es número de página → se descarta (no se lee);
  //   - bloque-título (corto, sin punto final) → una unidad propia;
  //   - bloque-párrafo → se corta en oraciones de punto a punto.
  const splitIntoPhrases = useCallback((text: string): string[] => {
    if (!text) return [];
    // Compatibilidad: si el texto no trae bloques '\n\n' (TXT/EPUB o respaldo),
    // se trata todo como un único bloque.
    const blocks = text.includes('\n\n')
      ? text.split(/\n{2,}/)
      : [text];

    const units: string[] = [];
    for (const block of blocks) {
      // Unir los renglones del bloque (wrap de columna) en un solo párrafo.
      const paragraph = block.split('\n').map(l => l.trim()).filter(Boolean).join(' ').trim();
      if (!paragraph) continue;
      if (isPageNumberLine(paragraph)) continue;          // número de página → no se lee
      if (isHeadingLine(paragraph)) { units.push(paragraph); continue; }  // título → unidad propia
      units.push(...splitParagraphIntoSentences(paragraph));              // párrafo → punto a punto
    }

    return units.filter(u => u.trim().length > 0);
  }, [splitParagraphIntoSentences]);

  // Recorre los nodos de texto de un elemento y devuelve el texto del primer
  // nodo cuyo rect intersecta verticalmente con el rect del viewport dado.
  // Usado para identificar desde qué frase debe comenzar la lectura: la
  // primera que esté actualmente visible en pantalla, no la primera del
  // documento/página completo.
  const getFirstVisibleTextSnippet = useCallback((root: HTMLElement, viewportRect: { top: number; bottom: number }, doc: Document = document): string | null => {
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => (node.textContent || '').trim().length > 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
    });
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const range = doc.createRange();
      range.selectNodeContents(node);
      const rects = range.getClientRects();
      for (let i = 0; i < rects.length; i++) {
        const rect = rects[i];
        if (rect.bottom > viewportRect.top && rect.top < viewportRect.bottom) {
          const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
          if (text.length > 0) return text;
        }
      }
    }
    return null;
  }, []);

  // Dado el texto completo de la página y la lista de frases ya segmentadas,
  // busca la frase que contiene (o está más cerca de) el fragmento visible
  // y devuelve su índice. Si no se encuentra, devuelve 0.
  const findPhraseIndexForSnippet = useCallback((phraseList: string[], snippet: string | null): number => {
    if (!snippet) return 0;
    // El snippet viene del DOM crudo: aplicar la misma normalización que el
    // pipeline de extracción (NFKC, sin invisibles, espacios colapsados) para
    // que compare bien contra las frases ya normalizadas.
    snippet = snippet.normalize('NFKC').replace(/[\u00AD\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, ' ').trim();
    const needle = snippet.slice(0, 40).toLowerCase();
    for (let i = 0; i < phraseList.length; i++) {
      if (phraseList[i].toLowerCase().includes(needle) || needle.includes(phraseList[i].toLowerCase().replace(/\.$/, ''))) {
        return i;
      }
    }
    // Fallback: comparar solo las primeras palabras
    const firstWords = snippet.split(' ').slice(0, 4).join(' ').toLowerCase();
    if (firstWords.length >= 3) {
      for (let i = 0; i < phraseList.length; i++) {
        if (phraseList[i].toLowerCase().includes(firstWords)) return i;
      }
    }
    return 0;
  }, []);

  // Patrón heurístico para detectar encabezados de capítulo en el texto de
  // una página de PDF/TXT: "Capítulo 4", "CAPITULO IV", "Chapter 4", etc.
  const CHAPTER_HEADING_RE = /\b(cap[ií]tulo|chapter)\s+([0-9]+|[ivxlcdm]+)\b/i;

  // Busca el inicio del capítulo dentro del texto de la página actual (PDF/TXT).
  // Si no se encuentra un encabezado en la página, devuelve 0 (inicio de página).
  const getChapterStartIndexInPage = useCallback((phraseList: string[]): number => {
    for (let i = 0; i < phraseList.length; i++) {
      if (CHAPTER_HEADING_RE.test(phraseList[i])) return i;
    }
    return 0;
  }, []);

  // Para EPUB: usa la API de ubicación de epub.js (currentLocation) para
  // obtener el CFI del contenido visible al inicio del scroll actual, lo
  // resuelve a un Range con getRange(cfi) y devuelve el texto desde ahí.
  //
  // Por qué no usar geometría (getClientRects) aquí: el contenido del EPUB
  // vive dentro de iframes que epub.js posiciona y desplaza con su propio
  // "manager.container". Las coordenadas que devuelve getClientRects() de
  // nodos DENTRO del iframe están en el sistema de coordenadas interno del
  // iframe, que no es directamente comparable con el rect de <main> (el
  // contenedor exterior, que ni siquiera es el elemento que hace scroll).
  // epub.js, en cambio, ya resuelve esa geometría internamente y expone el
  // resultado como un CFI a través de currentLocation().
  const getEpubVisibleTextFromLocation = useCallback(async (): Promise<string | null> => {
    const rendition = epubRenditionRef.current as any;
    if (!rendition) return null;
    try {
      const location = await rendition.currentLocation();
      const cfi: string | undefined = location?.start?.cfi;
      if (!cfi) return null;

      const range: Range | undefined = rendition.getRange(cfi);
      if (!range) return null;

      // Texto desde el punto de inicio del rango visible hasta el final de
      // ese nodo de texto, para tener un fragmento representativo a buscar
      // en phraseList.
      const node = range.startContainer;
      const text = (node?.textContent || '').slice(range.startOffset);
      const snippet = text.replace(/\s+/g, ' ').trim();
      if (snippet.length > 0) return snippet;

      // Si el nodo de inicio no tiene texto suficiente (p.ej. es un elemento,
      // no un nodo de texto), usar el texto completo del contenedor desde ahí.
      const container = (node as any)?.parentElement as HTMLElement | undefined;
      const fallback = (container?.textContent || '').replace(/\s+/g, ' ').trim();
      return fallback.length > 0 ? fallback : null;
    } catch {
      return null;
    }
  }, []);

  // Captura la posición actualmente visible en el EPUB como ancla de marcador:
  // el CFI de epubjs (posición exacta) + un fragmento de texto (primera palabra/
  // frase visible) como etiqueta legible. No usa número de página.
  const getEpubBookmarkAnchor = useCallback(async (): Promise<{ cfi: string; label: string } | null> => {
    const rendition = epubRenditionRef.current as any;
    if (!rendition) return null;
    try {
      const location = await rendition.currentLocation();
      const cfi: string | undefined = location?.start?.cfi;
      if (!cfi) return null;
      const label = (await getEpubVisibleTextFromLocation()) || '';
      return { cfi, label };
    } catch {
      return null;
    }
  }, [getEpubVisibleTextFromLocation]);

  // Navega a una posición del EPUB a partir de su CFI.
  const navigateEpubToCfi = useCallback((cfi: string) => {
    const rendition = epubRenditionRef.current as any;
    if (rendition && cfi) {
      try { rendition.display(cfi); } catch { /* CFI inválido: se ignora */ }
    }
  }, []);

  // Determina el índice de la frase visible actualmente en pantalla para
  // comenzar la lectura desde ahí en vez de desde el inicio de la página.
  const getVisiblePhraseStartIndex = useCallback(async (phraseList: string[]): Promise<number> => {
    if (item?.type === 'pdf') {
      const container = containerRef.current;
      if (!container) return 0;
      const viewportRect = container.getBoundingClientRect();
      const pageEl = document.getElementById(`pdf-page-${currentPage}`);
      if (!pageEl) return 0;
      const snippet = getFirstVisibleTextSnippet(pageEl, viewportRect);
      return findPhraseIndexForSnippet(phraseList, snippet);
    }

    if (item?.type === 'txt') {
      const container = containerRef.current;
      if (!container) return 0;
      const viewportRect = container.getBoundingClientRect();
      const el = document.getElementById('txt-content');
      if (!el) return 0;
      const snippet = getFirstVisibleTextSnippet(el, viewportRect);
      return findPhraseIndexForSnippet(phraseList, snippet);
    }

    if (item?.type === 'epub') {
      // phraseList para EPUB ya se construye a partir de getEpubVisibleText()
      // (todo el texto actualmente visible en los iframes de epub.js), así que
      // la frase 0 de esa lista YA ES la primera frase en pantalla — no hace
      // falta (ni conviene) re-buscarla por fuzzy-matching de snippet: ese
      // matching fallaba con textos largos/repetidos y arrancaba la lectura
      // en un punto que no coincidía con lo que el usuario veía en pantalla.
      return 0;
    }

    return 0;
  }, [item?.type, currentPage, getFirstVisibleTextSnippet, findPhraseIndexForSnippet]);

  // Para EPUB: navega la rendition al inicio del capítulo actual usando la
  // tabla de contenidos (TOC) del libro. Devuelve true si pudo navegar.
  const navigateEpubToChapterStart = useCallback(async (): Promise<boolean> => {
    const rendition = epubRenditionRef.current as any;
    if (!rendition) return false;
    try {
      const toc = rendition.book?.navigation?.toc as { href: string; subitems?: any[] }[] | undefined;
      if (!toc || toc.length === 0) return false;

      // Aplanar el TOC (incluye subcapítulos) para buscar el item activo
      const flatToc: { href: string }[] = [];
      const flatten = (items: any[]) => {
        items.forEach(it => {
          flatToc.push({ href: it.href });
          if (it.subitems?.length) flatten(it.subitems);
        });
      };
      flatten(toc);

      const currentHref: string | undefined = rendition.currentLocation?.()?.start?.href || rendition.location?.start?.href;
      if (!currentHref) return false;

      // Normalizar quitando anclas (#...) para comparar rutas de archivo
      const stripAnchor = (href: string) => href.split('#')[0];
      const currentPath = stripAnchor(currentHref);

      // Buscar el último item del TOC cuya ruta sea <= la ruta actual
      let targetHref: string | null = null;
      for (const tocItem of flatToc) {
        const tocPath = stripAnchor(tocItem.href);
        if (tocPath === currentPath) {
          targetHref = tocItem.href;
          break;
        }
      }
      if (!targetHref) return false;

      await rendition.display(targetHref);
      return true;
    } catch {
      return false;
    }
  }, []);

  // Resalta de manera no destructiva y súper premium la frase actual en el DOM del PDF.
  // persistent=true marca los spans con data-citation-highlight="true" para que el
  // resaltado de una cita guardada no sea borrado por el siguiente paso del TTS
  // (que solo limpia spans sin esa marca).
  // Resalta con precisión POR CARÁCTER usando una capa overlay de rectángulos
  // (Range.getClientRects), el mismo patrón que usan los lectores PDF
  // profesionales. El sistema anterior pintaba spans ENTEROS del text layer de
  // pdf.js — y como un span ≈ un renglón visual, una oración que empezaba a
  // mitad de renglón pintaba el renglón completo, incluyendo la cola de la
  // oración anterior y la cabeza de la siguiente: la marca nunca era
  // estrictamente "de punto a punto" aunque la segmentación fuera correcta.
  // Con el charMap de buildPageLines, la marca empieza y termina exactamente
  // en los caracteres de la oración.
  const ensurePdfHighlightLayer = (pageEl: Element): HTMLElement => {
    let layer = pageEl.querySelector(':scope > .tts-hl-layer') as HTMLElement | null;
    if (!layer) {
      layer = document.createElement('div');
      layer.className = 'tts-hl-layer';
      layer.style.position = 'absolute';
      layer.style.inset = '0';
      layer.style.pointerEvents = 'none';
      layer.style.zIndex = '3';
      // darken: el texto negro del canvas siempre gana → letras intactas bajo el color.
      layer.style.mixBlendMode = 'darken';
      pageEl.appendChild(layer);
    }
    return layer;
  };

  const highlightPhraseInDOM = useCallback((phraseText: string, color: string = '#fbbf24', persistent: boolean = false, retriesLeft: number = 8, scrollToMatch: boolean = true) => {
    // Cancelar cualquier reintento pendiente de una llamada anterior.
    if (pdfHighlightRetryRef.current) {
      clearTimeout(pdfHighlightRetryRef.current);
      pdfHighlightRetryRef.current = null;
    }

    // Limpiar rectángulos NO persistentes en todas las páginas montadas.
    document.querySelectorAll('.tts-hl-layer > div:not([data-persistent])').forEach(d => d.remove());

    if (!phraseText || phraseText.trim().length === 0) return;

    // La frase proviene del MISMO pipeline de normalización de buildPageLines
    // (vía getPdfPageStructuredText → splitIntoPhrases), así que basta
    // lowercase + colapso de espacios para el matching.
    const cleanPhrase = phraseText.replace(/\s+/g, ' ').trim().toLowerCase();
    if (cleanPhrase.length < 3) return;

    const pageEls = Array.from(document.querySelectorAll('.react-pdf__Page'));
    let highlightedAny = false;

    for (const pageEl of pageEls) {
      const cleanLines = buildPageLines(pageEl);
      if (cleanLines.length === 0) continue;

      // Texto de página + charMap global (misma construcción que la extracción:
      // renglones unidos con un espacio — el separador se marca con null, no se
      // pinta y simplemente parte el run en dos rectángulos, uno por renglón).
      let normText = '';
      const charMap: ({ node: Text; offset: number } | null)[] = [];
      cleanLines.forEach((line, idx) => {
        if (idx > 0) { normText += ' '; charMap.push(null); }
        normText += line.text.toLowerCase();
        charMap.push(...line.charMap);
      });

      let matchIndex = normText.indexOf(cleanPhrase);
      let matchLen = cleanPhrase.length;
      if (matchIndex === -1) {
        // Respaldo acotado: primeras palabras con longitud mínima exigente,
        // para no pintar por una coincidencia trivial.
        const firstWords = cleanPhrase.split(' ').slice(0, 6).join(' ');
        const partial = firstWords.length >= 12 ? normText.indexOf(firstWords) : -1;
        if (partial === -1) continue;
        matchIndex = partial;
        matchLen = firstWords.length;
      }

      // Agrupar los caracteres del match en "runs" contiguos por nodo de texto.
      // Dentro de un mismo nodo los offsets crudos son crecientes; cualquier
      // hueco entre ellos son espacios colapsados/invisibles que también deben
      // quedar cubiertos, así que el run simplemente se extiende.
      const runs: { node: Text; a: number; b: number }[] = [];
      for (let k = matchIndex; k < matchIndex + matchLen && k < charMap.length; k++) {
        const e = charMap[k];
        if (!e) continue;
        const last = runs[runs.length - 1];
        if (last && last.node === e.node && e.offset >= last.b) last.b = e.offset;
        else runs.push({ node: e.node, a: e.offset, b: e.offset });
      }
      if (runs.length === 0) continue;

      const layer = ensurePdfHighlightLayer(pageEl);
      const baseRect = pageEl.getBoundingClientRect();
      let firstDiv: HTMLElement | null = null;
      for (const run of runs) {
        try {
          const range = document.createRange();
          range.setStart(run.node, Math.min(run.a, run.node.length));
          range.setEnd(run.node, Math.min(run.b + 1, run.node.length));
          for (const r of Array.from(range.getClientRects())) {
            if (r.width <= 0 || r.height <= 0) continue;
            const d = document.createElement('div');
            d.style.position = 'absolute';
            d.style.left = `${r.left - baseRect.left}px`;
            d.style.top = `${r.top - baseRect.top}px`;
            d.style.width = `${r.width}px`;
            d.style.height = `${r.height}px`;
            d.style.backgroundColor = toRgba(color, 0.45);
            d.style.borderRadius = '3px';
            if (persistent) d.dataset.persistent = 'true';
            layer.appendChild(d);
            if (!firstDiv) firstDiv = d;
          }
        } catch { /* el nodo pudo mutar entre la extracción y el pintado */ }
      }
      if (firstDiv) {
        // 'nearest': solo desplaza lo mínimo para que la frase entre en vista.
        // En repintados (p. ej. tras un cambio de zoom) no se desplaza nada:
        // el usuario está justamente ajustando su encuadre.
        if (scrollToMatch) firstDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        highlightedAny = true;
      }
      if (highlightedAny) break;
    }

    // Si no se encontró en ninguna página montada, la página destino puede estar
    // todavía montándose tras un salto a la cita: reintentar unas pocas veces.
    // (En PDFs escaneados sin capa de texto no hay nada que pintar: los
    // reintentos se agotan en silencio y el audio sigue normalmente.)
    if (!highlightedAny && retriesLeft > 0) {
      pdfHighlightRetryRef.current = setTimeout(() => {
        pdfHighlightRetryRef.current = null;
        highlightPhraseInDOM(phraseText, color, persistent, retriesLeft - 1, scrollToMatch);
      }, 250);
    }
  }, [buildPageLines]);

  // Resalta la frase actual dentro del/los iframe(s) del EPUB visible.
  // A diferencia del PDF (que ya tiene spans por carácter del text layer),
  // el body del EPUB es HTML arbitrario, así que se recorren los nodos de
  // texto, se busca la frase con una regex tolerante a espacios/saltos y se
  // envuelve el rango encontrado en un <mark> temporal con el mismo estilo
  // premium usado en PDF.
  const highlightPhraseInEpub = useCallback((phraseText: string, color: string = '#fbbf24', retriesLeft: number = 3, persistent: boolean = false) => {
    // Cancelar cualquier reintento pendiente de una llamada anterior
    if (epubHighlightRetryRef.current) {
      clearTimeout(epubHighlightRetryRef.current);
      epubHighlightRetryRef.current = null;
    }

    const contentsList = (epubRenditionRef.current as any)?.manager?.getContents?.() || [];
    let matchedInAnySection = false;

    contentsList.forEach((contents: any) => {
      const doc: Document = contents?.document;
      if (!doc?.body) return;

      // 1. Limpiar resaltados previos, desenvolviendo los <mark> insertados
      doc.querySelectorAll('mark.__tts-highlight__').forEach((mark) => {
        const parent = mark.parentNode;
        if (!parent) return;
        while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
        parent.removeChild(mark);
        parent.normalize();
      });

      if (!phraseText || phraseText.replace(/\s+/g, ' ').trim().length < 3) return;

      // 2. Recorrer nodos de texto y construir el texto completo + mapa de offsets
      const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
      const nodeRanges: { node: Text; start: number; end: number }[] = [];
      let fullText = '';
      let current: Node | null;
      while ((current = walker.nextNode())) {
        const text = current.textContent || '';
        if (!text) continue;
        const start = fullText.length;
        fullText += text;
        nodeRanges.push({ node: current as Text, start, end: fullText.length });
      }
      if (!fullText) return;

      // 3. Buscar la frase tolerando diferencias de espacios/saltos de línea
      const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = phraseText
        .trim()
        .split(/\s+/)
        .map(escapeRegExp)
        .join('\\s+');
      const regex = new RegExp(pattern, 'i');
      const match = fullText.match(regex);
      if (!match || match.index === undefined) return;

      matchedInAnySection = true;

      const startPos = match.index;
      const endPos = startPos + match[0].length;

      // 4. Envolver cada nodo de texto que solape el rango encontrado
      let highlightedAny = false;
      nodeRanges.forEach(({ node, start, end }) => {
        if (end <= startPos || start >= endPos) return;
        const sliceStart = Math.max(0, startPos - start);
        const sliceEnd = Math.min(node.length, endPos - start);
        if (sliceStart >= sliceEnd) return;

        const range = doc.createRange();
        range.setStart(node, sliceStart);
        range.setEnd(node, sliceEnd);

        const mark = doc.createElement('mark');
        mark.className = persistent ? '__citation-highlight__' : '__tts-highlight__';
        // Alfa dentro del color (NO usar opacity: rompe el multiply). En EPUB el
        // <mark> sí puede partirse en varias líneas, así que box-decoration-break:
        // clone mantiene el resaltado continuo entre líneas.
        mark.style.backgroundColor = toRgba(color, 0.5);
        mark.style.mixBlendMode = 'multiply';
        mark.style.boxDecorationBreak = 'clone';
        (mark.style as any).webkitBoxDecorationBreak = 'clone';
        mark.style.borderRadius = '3px';
        mark.style.transition = 'background-color 0.25s ease-in-out';

        try {
          range.surroundContents(mark);
          if (!highlightedAny) {
            // No usar mark.scrollIntoView(): scrollea el documento INTERNO del
            // iframe, lo cual entra en conflicto con el contenedor de scroll
            // que maneja epub.js en modo "scrolled-doc"/continuous (provoca
            // saltos/"peleas" de scroll). En su lugar, centramos la frase
            // resaltada desplazando el contenedor exterior del manager.
            const manager = (epubRenditionRef.current as any)?.manager;
            const scrollContainer: HTMLElement | undefined = manager?.container;
            // El <mark> vive dentro del documento del iframe de esta sección,
            // así que su getBoundingClientRect() está en coordenadas internas
            // del iframe, no del documento exterior donde vive scrollContainer.
            // Hay que sumarle la posición del propio iframe dentro del
            // documento exterior para poder compararlo con scrollContainer.
            const iframeEl: HTMLElement | undefined = contents?.iframe || (doc.defaultView?.frameElement as HTMLElement | undefined);
            if (scrollContainer && iframeEl) {
              const markRect = mark.getBoundingClientRect();
              const iframeRect = iframeEl.getBoundingClientRect();
              const containerRect = scrollContainer.getBoundingClientRect();
              const markTop = iframeRect.top + markRect.top;
              const markBottom = markTop + markRect.height;
              // Igual que 'nearest' en scrollIntoView: si la frase ya está
              // dentro del área visible del contenedor, no se mueve nada. Solo
              // si queda por encima o por debajo se desplaza lo justo para que
              // su borde más cercano quede al ras del viewport — nunca se
              // fuerza al centro (eso producía un salto grande en cada Play
              // aunque el texto ya estuviera a la vista).
              let delta = 0;
              if (markTop < containerRect.top) {
                delta = markTop - containerRect.top;
              } else if (markBottom > containerRect.bottom) {
                delta = markBottom - containerRect.bottom;
              }
              if (delta !== 0) scrollContainer.scrollBy({ top: delta, behavior: 'smooth' });
            } else {
              mark.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
            highlightedAny = true;
          }
        } catch {
          // surroundContents falla si el rango cruza límites de elementos no
          // homogéneos; en ese caso se omite el resaltado de ese nodo.
        }
      });
    });

    // Si la frase no se encontró en ninguna sección actualmente renderizada,
    // es probable que el manager "continuous" de epub.js todavía no haya
    // montado el iframe de la siguiente sección (esto ocurre cuando el
    // scroll programático va más rápido que el precargado de capítulos).
    // Reintentamos un par de veces dejando tiempo a que epub.js la monte,
    // en vez de quedarnos sin resaltar/centrar para el resto de la lectura.
    if (!matchedInAnySection && retriesLeft > 0 && phraseText && phraseText.replace(/\s+/g, ' ').trim().length >= 3) {
      epubHighlightRetryRef.current = setTimeout(() => {
        epubHighlightRetryRef.current = null;
        highlightPhraseInEpub(phraseText, color, retriesLeft - 1, persistent);
      }, 400);
    }
  }, []);

  // Despacha el resaltado al lector correspondiente (PDF o EPUB).
  // persistent=true crea un resaltado permanente (cita guardada) que no se
  // borra en el siguiente paso del TTS.
  const highlightCurrentPhrase = useCallback((phraseText: string, color?: string, persistent: boolean = false) => {
    // Registro para el repintado tras cambios de zoom del PDF (los rects del
    // overlay son píxeles absolutos y quedan corridos al re-renderizarse la
    // capa de texto). El EPUB usa <mark> en el flujo del documento y refluye
    // solo, no necesita registro.
    if (item?.type !== 'epub') {
      if (persistent && phraseText) {
        const hex = color || '#fbbf24';
        paintedCitationsRef.current = [
          ...paintedCitationsRef.current.filter(e => e.phrase !== phraseText),
          { phrase: phraseText, hex },
        ];
      } else if (!persistent) {
        lastTtsHighlightRef.current = phraseText ? { phrase: phraseText, hex: color } : null;
      }
    }
    if (item?.type === 'epub') {
      highlightPhraseInEpub(phraseText, color, 3, persistent);
    } else {
      highlightPhraseInDOM(phraseText, color, persistent);
    }
  }, [item?.type, highlightPhraseInEpub, highlightPhraseInDOM]);

  // Borra TODOS los resaltados de cita persistentes (data-citation-highlight en
  // PDF, mark.__citation-highlight__ en EPUB). El resaltado normal de
  // highlightPhraseInDOM/Epub NO los limpia a propósito (para no borrar la cita
  // mientras el TTS avanza), pero al navegar a OTRA cita hay que partir de cero;
  // si no, el color de la cita anterior queda pegado y se ve un color distinto
  // al de la cita destino.
  const clearPersistentHighlights = useCallback(() => {
    if (item?.type === 'epub') {
      const contentsList = (epubRenditionRef.current as any)?.manager?.getContents?.() || [];
      contentsList.forEach((contents: any) => {
        const doc: Document = contents?.document;
        if (!doc?.body) return;
        doc.querySelectorAll('mark.__citation-highlight__').forEach((mark) => {
          const parent = mark.parentNode;
          if (!parent) return;
          while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
          parent.removeChild(mark);
          parent.normalize();
        });
      });
    } else {
      // Rectángulos persistentes del overlay nuevo.
      paintedCitationsRef.current = [];
      document.querySelectorAll('.tts-hl-layer > div[data-persistent]').forEach(d => d.remove());
      // Limpieza legacy: citas antiguas que hubieran quedado con estilos
      // directamente sobre los spans del text layer (sistema anterior).
      document.querySelectorAll('.react-pdf__Page__textContent span[data-citation-highlight="true"]').forEach((span: any) => {
        span.style.backgroundColor = '';
        span.style.borderRadius = '';
        span.style.transition = '';
        span.style.mixBlendMode = '';
        span.style.opacity = '';
        delete span.dataset.citationHighlight;
      });
    }
  }, [item?.type]);

  // Al cambiar la escala del PDF los rects del overlay (píxeles absolutos)
  // quedan corridos respecto al texto re-renderizado. Se espera a que el zoom
  // se asiente (debounce: pinch/rueda disparan muchos cambios seguidos), se
  // descartan los rects viejos y se repintan citas y frase actual del TTS
  // desde los registros — sin scrollIntoView, para no mover el encuadre que
  // el usuario está ajustando.
  const handlePdfScaleChange = useCallback(() => {
    if (scaleRepaintTimerRef.current) clearTimeout(scaleRepaintTimerRef.current);
    scaleRepaintTimerRef.current = setTimeout(() => {
      scaleRepaintTimerRef.current = null;
      document.querySelectorAll('.tts-hl-layer > div').forEach(d => d.remove());
      for (const entry of paintedCitationsRef.current) {
        highlightPhraseInDOM(entry.phrase, entry.hex, true, 8, false);
      }
      const tts = lastTtsHighlightRef.current;
      if (tts && ttsActiveRef.current) {
        highlightPhraseInDOM(tts.phrase, tts.hex, false, 8, false);
      }
    }, 350);
  }, [highlightPhraseInDOM]);

  useEffect(() => () => {
    if (scaleRepaintTimerRef.current) clearTimeout(scaleRepaintTimerRef.current);
  }, []);

  // Crea una nota/cita a partir de la frase que el TTS está leyendo actualmente,
  // marcándola con el color elegido — sin abrir el panel de Anotaciones.
  // Llama directamente a addCitation() del hook useDocumentNotes: la
  // persistencia ya NO depende de que NotesPanel esté montado (antes pasaba
  // por setSelectedCitation + un efecto dentro de NotesPanel, que solo existe
  // si el panel de notas está abierto — si el usuario marcaba varias frases
  // mientras escuchaba el TTS con el panel cerrado, todas menos la última se
  // perdían en silencio).
  const createNoteFromCurrentPhrase = useCallback((color: string, hex: string) => {
    const phraseText = phrases[currentPhraseIndex];
    if (!phraseText) return;

    addCitation({
      text: phraseText,
      color,
      page: item?.type === 'epub' ? undefined : currentPage,
    });

    // Resalta visualmente la frase en el color elegido de forma persistente,
    // para que no se borre cuando el TTS avance a la siguiente frase.
    highlightCurrentPhrase(phraseText, hex, true);
  }, [phrases, currentPhraseIndex, item?.type, currentPage, highlightCurrentPhrase, addCitation]);

  // Detener la reproducción de voz
  const handleTtsStop = useCallback(() => {
    // Cancelar cualquier fetch TTS en vuelo antes de todo lo demás
    if (ttsAbortRef.current) {
      ttsAbortRef.current.abort();
      ttsAbortRef.current = null;
    }
    if (ttsStepTimeoutRef.current) {
      clearTimeout(ttsStepTimeoutRef.current);
      ttsStepTimeoutRef.current = null;
    }
    if (epubHighlightRetryRef.current) {
      clearTimeout(epubHighlightRetryRef.current);
      epubHighlightRetryRef.current = null;
    }
    ttsStepTargetRef.current = null;
    if (currentAudio) {
      currentAudio.onended = null;
      currentAudio.onerror = null;
      currentAudio.pause();
      currentAudio.src = '';
      setCurrentAudio(null);
    }
    // Liberar recursos de la precarga si existen
    if (preloadedAudioRef.current) {
      URL.revokeObjectURL(preloadedAudioRef.current.url);
      preloadedAudioRef.current.audio.src = '';
      preloadedAudioRef.current = null;
    }
    ttsActiveRef.current = false;
    setTtsStatus('idle');
    setCurrentPhraseIndex(-1);
    highlightCurrentPhrase('');
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = 'none';
    }
  }, [currentAudio, highlightCurrentPhrase]);

  // Reproducción paso a paso frase por frase con pre-fetching asíncrono y resiliencia a errores.
  //
  // isInitial=true indica que esta es la PRIMERA frase de una nueva sesión de
  // lectura (al presionar Play). En ese caso, el resaltado dispara un scroll
  // automático para centrar la frase en pantalla — si empezamos a reproducir
  // el audio inmediatamente, el usuario ve/escucha la frase mientras la
  // pantalla todavía está "saltando" hacia esa posición (la sensación de
  // salto/desfase que reportó el usuario). Por eso esperamos a que el scroll
  // suave termine antes de pedir/reproducir el audio. En los avances
  // subsiguientes (onended) no se espera, para no introducir pausas entre
  // frases durante la lectura continua.
  const playPhrase = useCallback(async (index: number, phraseList: string[], isInitial: boolean = false) => {
    if (index < 0 || index >= phraseList.length) {
      handleTtsStop();
      return;
    }

    // Esta es una reproducción real (no un paso de debounce pendiente)
    ttsStepTargetRef.current = null;
    if (ttsStepTimeoutRef.current) {
      clearTimeout(ttsStepTimeoutRef.current);
      ttsStepTimeoutRef.current = null;
    }

    // Marca la sesión de lectura como activa: permite que onended encadene a la
    // siguiente página al terminar la actual (lectura continua).
    ttsActiveRef.current = true;

    setTtsStatus('loading');
    setCurrentPhraseIndex(index);
    const phraseText = phraseList[index];

    // Recordar esta posición para reanudar la lectura aquí la próxima vez
    // que se presione "Play" (solo para lectura de página, no de selección).
    if (ttsTextSource === 'page') {
      saveTtsPosition(index, phraseText);
    }

    // Resaltar visualmente la frase en curso (PDF por rangos de caracteres, EPUB por <mark>)
    // y centrarla en pantalla mediante scroll suave.
    highlightCurrentPhrase(phraseText);

    if (isInitial) {
      // Dar tiempo a que el scroll suave de centrado termine antes de
      // empezar a generar/reproducir el audio.
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Desconectar listeners del audio previo para evitar el "error fantasma"
    if (currentAudio) {
      currentAudio.onended = null;
      currentAudio.onerror = null;
      currentAudio.pause();
      currentAudio.src = '';
    }

    try {
      let audio: HTMLAudioElement;
      let audioUrl: string;

      // 1. Usar audio precargado si coincide con el índice solicitado
      if (preloadedAudioRef.current && preloadedAudioRef.current.index === index) {
        audio = preloadedAudioRef.current.audio;
        audioUrl = preloadedAudioRef.current.url;
        preloadedAudioRef.current = null; // Liberar la referencia de precarga
      } else {
        // Cancelar fetch anterior si aún está en vuelo
        if (ttsAbortRef.current) {
          ttsAbortRef.current.abort();
        }
        const controller = new AbortController();
        ttsAbortRef.current = controller;

        const response = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          signal: controller.signal,
          body: JSON.stringify({ text: phraseText, provider: selectedProvider, voiceId: selectedVoice, model: selectedModel })
        });

        ttsAbortRef.current = null;

        // 429 (límite de peticiones): NO matar la sesión de audiolibro — es un
        // estado transitorio. Se espera lo que indique Retry-After (o 20s) y se
        // reintenta la MISMA frase mientras la sesión siga activa. Antes esto
        // lanzaba error y detenía la lectura definitivamente, imposibilitando
        // sesiones largas si se rozaba el límite en algún momento.
        if (response.status === 429) {
          const retryAfter = Number(response.headers.get('retry-after'));
          const waitMs = (Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 60) : 20) * 1000;
          setTtsStatus('loading');
          await new Promise(resolve => setTimeout(resolve, waitMs));
          if (ttsActiveRef.current) playPhraseRef.current?.(index, phraseList);
          return;
        }

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.error || 'Fallo de respuesta de audio.');
        }

        const blob = await response.blob();
        audioUrl = URL.createObjectURL(blob);
        audio = new Audio(audioUrl);
      }

      audio.onended = () => {
        // Desconectar listeners de este audio antes de avanzar para evitar
        // que onerror se dispare cuando más adelante se vacíe audio.src
        audio.onended = null;
        audio.onerror = null;
        URL.revokeObjectURL(audioUrl);
        const nextIndex = index + 1;
        if (nextIndex < phraseList.length) {
          // Usar el ref estable — evita capturar el closure stale de playPhrase
          playPhraseRef.current?.(nextIndex, phraseList);
        } else if (ttsTextSource === 'page' && ttsActiveRef.current) {
          // Fin de la página actual: en lugar de detenerse, avanzar a la
          // siguiente página y seguir leyendo desde su primera frase. La
          // lectura continúa sin interrupción hasta el final del documento
          // o hasta que el usuario detenga manualmente. handleTtsNextPage ya
          // comprueba si es la última página (y entonces no hace nada → la
          // reproducción simplemente termina).
          handleTtsNextPageRef.current?.();
        } else {
          handleTtsStop();
        }
      };

      audio.onerror = () => {
        // Si src está vacío, el audio fue detenido intencionalmente — no es un error
        if (!audio.src || audio.src === '' || audio.src === window.location.href) return;
        setTtsStatus('error');
        setTtsErrorMessage('Error al reproducir esta frase.');
      };

      setCurrentAudio(audio);
      audio.play().then(() => {
        setTtsStatus('playing');
      }).catch((err) => {
        // play() puede rechazar si el audio precargado aún no estaba listo
        // (NotAllowedError/AbortError). Reintentar una vez tras recargarlo
        // evita que la lectura se quede "trabada" en silencio sin avanzar.
        console.warn('[WARN] audio.play() rechazada, reintentando:', err?.name || err);
        audio.load();
        audio.play().then(() => {
          setTtsStatus('playing');
        }).catch((err2) => {
          console.error('Error al reproducir audio tras reintento:', err2);
          setTtsStatus('error');
          setTtsErrorMessage('Error al reproducir esta frase.');
        });
      });

      // 2. Pre-cargar la siguiente frase de forma totalmente asíncrona y transparente
      const nextIndex = index + 1;
      if (nextIndex < phraseList.length) {
        // Limpiar precarga anterior si existiera
        if (preloadedAudioRef.current) {
          URL.revokeObjectURL(preloadedAudioRef.current.url);
          preloadedAudioRef.current.audio.src = '';
          preloadedAudioRef.current = null;
        }

        const nextPhraseText = phraseList[nextIndex];
        fetch('/api/tts', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          credentials: 'include',
          body: JSON.stringify({
            text: nextPhraseText,
            provider: selectedProvider,
            voiceId: selectedVoice,
            model: selectedModel
          })
        })
        .then(res => {
          if (res.ok) return res.blob();
          throw new Error('Error de precarga');
        })
        .then(blob => {
          const url = URL.createObjectURL(blob);
          const preloadedAudio = new Audio(url);
          preloadedAudio.load();
          preloadedAudioRef.current = { index: nextIndex, audio: preloadedAudio, url };
        })
        .catch(err => {
          console.warn('[WARN] No se pudo precargar la siguiente frase:', err.message || err);
        });
      }

      // Configurar API MediaSession para mandos Bluetooth (auriculares/auto) y pantalla de bloqueo
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'playing';
        navigator.mediaSession.metadata = new MediaMetadata({
          title: item?.title || 'Biblioteca Personal',
          artist: 'Lector de Voz Inteligente',
          album: `Pág. ${currentPage} · Frase ${index + 1} de ${phraseList.length}`,
          artwork: [
            { src: item?.thumbnailUrl || '/logo.png', sizes: '96x96', type: 'image/png' }
          ]
        });

        // Controles de auriculares o mandos inalámbricos
        navigator.mediaSession.setActionHandler('play', () => {
          audio.play();
          setTtsStatus('playing');
          navigator.mediaSession.playbackState = 'playing';
        });
        navigator.mediaSession.setActionHandler('pause', () => {
          audio.pause();
          setTtsStatus('paused');
          navigator.mediaSession.playbackState = 'paused';
        });
        
        navigator.mediaSession.setActionHandler('previoustrack', () => {
          if (index > 0) {
            playPhrase(index - 1, phraseList);
          }
        });
        navigator.mediaSession.setActionHandler('nexttrack', () => {
          if (index < phraseList.length - 1) {
            playPhrase(index + 1, phraseList);
          }
        });
      }
    } catch (error: any) {
      // AbortError ocurre al cambiar proveedor/modelo — no es un error real
      if (error?.name === 'AbortError') return;
      console.error('Error in playPhrase:', error);
      setTtsStatus('error');
      setTtsErrorMessage(error.message || 'No se pudo reproducir la frase actual.');
    }
  }, [currentAudio, item, currentPage, selectedVoice, selectedProvider, selectedModel, highlightCurrentPhrase, handleTtsStop, ttsTextSource, saveTtsPosition]);

  // Mantener el ref siempre apuntando a la versión más reciente de playPhrase
  playPhraseRef.current = playPhrase;

  // Controles directos de Adelantar (>>) y Retroceder (<<) en la interfaz.
  //
  // Si el usuario presiona el botón varias veces en menos de medio segundo,
  // está navegando rápido por el texto y NO quiere que se generen/reproduzcan
  // audios para cada frase intermedia (eso dispararía una llamada a la IA por
  // cada click). En vez de reproducir inmediatamente, se actualiza el índice
  // "objetivo" y se espera a que el usuario deje de presionar por 500ms antes
  // de pedir el audio de la frase final.
  const scheduleTtsStep = useCallback((targetIndex: number, phraseList: string[]) => {
    if (targetIndex < 0 || targetIndex >= phraseList.length) return;

    ttsStepTargetRef.current = targetIndex;
    setCurrentPhraseIndex(targetIndex);
    highlightCurrentPhrase(phraseList[targetIndex]);

    if (ttsStepTimeoutRef.current) clearTimeout(ttsStepTimeoutRef.current);
    ttsStepTimeoutRef.current = setTimeout(() => {
      const finalIndex = ttsStepTargetRef.current;
      ttsStepTimeoutRef.current = null;
      ttsStepTargetRef.current = null;
      if (finalIndex !== null) {
        playPhrase(finalIndex, phraseList);
      }
    }, 500);
  }, [highlightCurrentPhrase, playPhrase]);

  const handleTtsPrevious = useCallback(() => {
    const base = ttsStepTargetRef.current !== null ? ttsStepTargetRef.current : currentPhraseIndex;
    scheduleTtsStep(base - 1, phrases);
  }, [currentPhraseIndex, phrases, scheduleTtsStep]);

  const handleTtsNext = useCallback(() => {
    const base = ttsStepTargetRef.current !== null ? ttsStepTargetRef.current : currentPhraseIndex;
    scheduleTtsStep(base + 1, phrases);
  }, [currentPhraseIndex, phrases, scheduleTtsStep]);

  // Cancelar el debounce de avance/retroceso pendiente al desmontar o detener
  useEffect(() => {
    return () => {
      if (ttsStepTimeoutRef.current) clearTimeout(ttsStepTimeoutRef.current);
    };
  }, []);

  // Helper: obtiene texto de una página del DOM; si está vacío y es PDF server, usa OCR
  const getPageTextWithOcrFallback = useCallback(async (pageNum: number): Promise<string> => {
    // EPUB: epubjs renderiza cada "página" visible dentro de uno o más iframes
    // internos (vista de página única o doble). Leemos el texto visible de todos
    // los iframes activos de la rendition actual.
    if (item?.type === 'epub') {
      return getEpubVisibleText();
    }
    const pageEl = document.getElementById(`pdf-page-${pageNum}`);
    if (pageEl) {
      const textLayer = pageEl.querySelector('.react-pdf__Page__textContent');
      const domText = (textLayer ? textLayer.textContent : pageEl.textContent || '').replace(/\s+/g, ' ').trim();
      if (domText.length > 0) return domText;
    }
    // Fallback OCR para PDFs escaneados
    if (item?.type === 'pdf' && item.source?.startsWith('/api/files/')) {
      const fileName = item.source.replace('/api/files/', '');
      try {
        const ocrRes = await fetch('/api/ocr-page', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ fileName, pageNumber: pageNum }),
        });
        if (ocrRes.ok) {
          const { text } = await ocrRes.json();
          return (text || '').trim();
        }
      } catch { /* no-op */ }
    }
    return '';
  }, [item?.type, item?.source, getEpubVisibleText]);

  // Cambio de página desde el widget TTS con auto-lectura. Orden estricto
  // para EPUB: primero cambiar de sección y esperar a que epubjs confirme el
  // cambio (evento 'relocated'), y solo DESPUÉS extraer el texto y empezar a
  // leer — si se lee antes de tiempo, el texto extraído no es el que quedó
  // visible en pantalla.
  // NOTA CRÍTICA: estos dos handlers son el camino del avance AUTOMÁTICO del
  // audiolibro (onended → siguiente página). Deben usar EXACTAMENTE la misma
  // extracción (getPdfPageStructuredText) y el mismo segmentador
  // (splitIntoPhrases) que el Play inicial. Antes usaban text.split('.')
  // ingenuo + texto plano: en cuanto el lector pasaba de página, la
  // segmentación punto-a-punto y el resaltado se degradaban por completo
  // (frases cortadas en abreviaturas, números de página leídos, resaltado
  // que no coincidía con el texto de la página).
  const handleTtsPrevPage = useCallback(async () => {
    handleTtsStop();
    if (item?.type === 'epub') {
      epubRenditionRef.current?.prev();
      await waitForEpubRelocated();
      const text = getEpubVisibleText();
      const phraseList = splitIntoPhrases(text);
      if (phraseList.length > 0) {
        setPhrases(phraseList);
        setTtsTextSource('page');
        playPhrase(0, phraseList, true);
      }
      return;
    }
    const page = typeof currentPage === 'number' ? currentPage : parseInt(String(currentPage), 10);
    if (page <= 1) return;
    const newPage = page - 1;
    setTargetPage({ page: newPage, t: Date.now() });
    setCurrentPage(newPage);
    setTimeout(async () => {
      const text = getPdfPageStructuredText(newPage) || await getPageTextWithOcrFallback(newPage);
      const phraseList = splitIntoPhrases(text);
      if (phraseList.length > 0) {
        setPhrases(phraseList);
        setTtsTextSource('page');
        playPhrase(0, phraseList, true);
      }
    }, 800);
  }, [currentPage, item?.type, handleTtsStop, playPhrase, getPdfPageStructuredText, getPageTextWithOcrFallback, getEpubVisibleText, waitForEpubRelocated, splitIntoPhrases]);

  const handleTtsNextPage = useCallback(async () => {
    handleTtsStop();
    if (item?.type === 'epub') {
      epubRenditionRef.current?.next();
      await waitForEpubRelocated();
      const text = getEpubVisibleText();
      const phraseList = splitIntoPhrases(text);
      if (phraseList.length > 0) {
        setPhrases(phraseList);
        setTtsTextSource('page');
        playPhrase(0, phraseList, true);
      }
      return;
    }
    const page = typeof currentPage === 'number' ? currentPage : parseInt(String(currentPage), 10);
    if (page >= totalPages) return;
    const newPage = page + 1;
    setTargetPage({ page: newPage, t: Date.now() });
    setCurrentPage(newPage);
    setTimeout(async () => {
      const text = getPdfPageStructuredText(newPage) || await getPageTextWithOcrFallback(newPage);
      const phraseList = splitIntoPhrases(text);
      if (phraseList.length > 0) {
        setPhrases(phraseList);
        setTtsTextSource('page');
        playPhrase(0, phraseList, true);
      }
    }, 800);
  }, [currentPage, totalPages, item?.type, handleTtsStop, playPhrase, getPdfPageStructuredText, getPageTextWithOcrFallback, getEpubVisibleText, waitForEpubRelocated, splitIntoPhrases]);

  // Ref estable para encadenar el avance de página desde onended sin closures stale.
  handleTtsNextPageRef.current = handleTtsNextPage;

  // Play / Pausa general
  const handleTtsPlayPause = async () => {
    if (ttsStatus === 'playing' && currentAudio) {
      currentAudio.pause();
      setTtsStatus('paused');
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'paused';
      }
      return;
    }

    if (ttsStatus === 'paused' && currentAudio) {
      currentAudio.play();
      setTtsStatus('playing');
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'playing';
      }
      return;
    }

    // Nueva lectura
    setTtsStatus('loading');
    setTtsErrorMessage('');

    let textToRead = '';
    let source: 'selection' | 'page' = 'page';
    // Si se inició desde una selección, leemos la página/capítulo COMPLETO pero
    // arrancando en la frase de la selección, para que la lectura continúe con
    // el texto que sigue (no solo el fragmento seleccionado) y se pueda
    // pausar/detener con los controles normales.
    const selectionSnippet = (selectedText && selectedText.trim().length > 0) ? selectedText.trim() : null;

    {
      // "Inicio del capítulo" en EPUB requiere navegar la rendition al inicio
      // del capítulo actual ANTES de extraer el texto visible, ya que el
      // contenido renderizado cambia tras la navegación.
      if (item?.type === 'epub' && !selectionSnippet && ttsStartSource === 'chapter') {
        await navigateEpubToChapterStart();
        // Esperar a que epub.js termine de renderizar el nuevo contenido
        await new Promise(resolve => setTimeout(resolve, 400));
      }
      textToRead = getActivePageText();
      source = 'page';
    }

    if (!textToRead || textToRead.length === 0) {
      // Fallback OCR para PDFs escaneados (sin text layer)
      if (item?.type === 'pdf' && item.source?.startsWith('/api/files/')) {
        const fileName = item.source.replace('/api/files/', '');
        const pageNum = typeof currentPage === 'number' ? currentPage : parseInt(String(currentPage), 10);
        try {
          const ocrRes = await fetch('/api/ocr-page', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ fileName, pageNumber: pageNum }),
          });
          if (ocrRes.ok) {
            const { text: ocrText } = await ocrRes.json();
            if (ocrText && ocrText.trim().length > 0) {
              const phraseList = splitIntoPhrases(ocrText);
              if (phraseList.length > 0) {
                setTtsTextSource('page');
                setPhrases(phraseList);
                playPhrase(loadTtsPosition(phraseList), phraseList, true);
                return;
              }
            }
          }
        } catch { /* si el OCR falla, caemos al error original */ }
      }
      setTtsStatus('error');
      setTtsErrorMessage('No se encontró texto legible en la página actual. Intenta seleccionando texto.');
      return;
    }

    setTtsTextSource(source);

    const phraseList = splitIntoPhrases(textToRead);
    if (phraseList.length === 0) {
      setTtsStatus('error');
      setTtsErrorMessage('No se pudo segmentar el texto en frases legibles.');
      return;
    }

    setPhrases(phraseList);

    let startIndex = 0;
    if (selectionSnippet) {
      // Arrancar en la frase que coincide con el texto seleccionado y seguir
      // leyendo de corrido desde ahí.
      startIndex = findPhraseIndexForSnippet(phraseList, selectionSnippet);
    } else {
      switch (ttsStartSource) {
        case 'chapter':
          // EPUB ya navegó al inicio del capítulo; el texto extraído ya
          // corresponde a ese punto, así que empezamos desde lo visible ahí.
          startIndex = item?.type === 'epub' ? await getVisiblePhraseStartIndex(phraseList) : getChapterStartIndexInPage(phraseList);
          break;
        case 'lastRead':
          startIndex = loadTtsPosition(phraseList);
          break;
        case 'visible':
        default:
          startIndex = await getVisiblePhraseStartIndex(phraseList);
          break;
      }
    }

    playPhrase(startIndex, phraseList, true);
  };

  const handleTtsClose = useCallback(() => {
    handleTtsStop();
    setShowTtsWidget(false);
  }, [handleTtsStop]);

  useEffect(() => {
    return () => {
      if (currentAudio) {
        currentAudio.pause();
        currentAudio.src = '';
      }
    };
  }, [currentAudio]);

  const handlePageChange = useCallback((page: number | string, total?: number) => {
    setCurrentPage(page);
    if (total && total > 0) {
      setTotalPages(total);
    }
  }, []);

  // Aplica el resaltado pendiente al navegar desde una cita guardada
  // (CitationsManager). Para PDF se espera a que la página destino termine de
  // renderizarse; para EPUB, highlightPhraseInEpub ya reintenta mientras la
  // sección se monta.
  useEffect(() => {
    if (!pendingHighlight) return;
    const { text, color } = pendingHighlight;

    // Limpia el resaltado de la cita anterior antes de pintar la nueva, para que
    // no se quede pegado un color distinto al de la cita a la que navegamos.
    clearPersistentHighlights();

    // Tanto PDF como EPUB resaltan con reintentos internos mientras la página/
    // sección destino termina de montarse, así que se puede llamar de inmediato.
    highlightCurrentPhrase(text, color, true);
    setPendingHighlight(null);
  }, [pendingHighlight, item?.type, highlightCurrentPhrase, clearPersistentHighlights]);

  // Fuentes del libro (PDF/EPUB/TXT/externa) de forma retrocompatible.
  const bookSources = useMemo(() => getBookSources(item), [item]);
  const availableFormats = useMemo(
    () => (['pdf', 'epub', 'txt', 'externa'] as ResourceType[]).filter(t => bookSources[t as keyof typeof bookSources]),
    [bookSources]
  );
  // Versión seleccionada por el usuario cuando el libro tiene varias (PDF+EPUB).
  const [activeFormat, setActiveFormat] = useState<ResourceType | undefined>(undefined);
  const primary = useMemo(
    () => resolvePrimarySource(bookSources, activeFormat) ?? { source: item.source, type: item.type },
    [bookSources, activeFormat, item.source, item.type]
  );
  const activeSource = primary.source;
  const activeType = primary.type;

  // New states for fullscreen and split view
  const [isFullscreen, setIsFullscreen] = useState(typeof window !== 'undefined' ? window.innerWidth < 768 : false);
  // Intención del usuario de mantener pantalla completa: si es true, al salir
  // del fullscreen nativo por rotación del dispositivo (común en móvil) se
  // re-solicita automáticamente para que NO se pierda al rotar. Solo un gesto
  // explícito (botón/Esc) la pone en false.
  const fullscreenIntentRef = useRef(false);
  // Dispositivo táctil (móvil/tablet): el comportamiento de "mantener
  // fullscreen al rotar" solo aplica aquí, no en PC.
  const isTouchDevice = typeof window !== 'undefined' && (('ontouchstart' in window) || navigator.maxTouchPoints > 0);
  const [showControls, setShowControls] = useState(typeof window !== 'undefined' ? window.innerWidth >= 768 : true);
  const [notesPosition, setNotesPosition] = useState<'right' | 'left'>('right');
  const [splitRatio, setSplitRatio] = useState<number>(50);
  const [isDragging, setIsDragging] = useState(false);
  const [isPortrait, setIsPortrait] = useState(typeof window !== 'undefined' ? window.innerWidth < 768 : false);
  // Móvil en horizontal (no tablet/desktop): ancho típico de teléfono rotado
  // (≤ 950px) con altura baja (≤ 500px), que es justo cuando los controles
  // del reproductor TTS no entran en una sola fila visible.
  const [isMobileLandscape, setIsMobileLandscape] = useState(
    typeof window !== 'undefined' ? window.innerWidth > window.innerHeight && window.innerHeight <= 500 && window.innerWidth <= 950 : false
  );
  // Índice del PDF controlado desde la barra TTS compacta en móvil horizontal.
  const [pdfOutlineOpen, setPdfOutlineOpen] = useState(false);

  // En móvil horizontal los botones de reproducción se agrandan ~30% para que
  // sean más fáciles de tocar (padding e ícono mayores). En el resto, tamaño normal.
  const ttsBtnPad = isMobileLandscape ? "p-2.5" : "p-2";
  const ttsBtnIcon = isMobileLandscape ? "w-5 h-5" : "w-4 h-4";

  // Generación de índice con IA cuando el PDF no trae outline nativo (se
  // persiste en el propio item para no tener que regenerarlo cada vez).
  const [generatingToc, setGeneratingToc] = useState(false);
  const handleGenerateToc = useCallback(async (firstPagesText: string) => {
    if (!item || generatingToc) return;
    setGeneratingToc(true);
    try {
      const res = await fetch('/api/generate-toc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: firstPagesText }),
      });
      if (res.ok) {
        const { chapters } = await res.json();
        updateItem(item.id, { generatedToc: Array.isArray(chapters) && chapters.length > 0 ? chapters : null });
      }
    } catch (e) {
      console.error('No se pudo generar el índice con IA:', e);
    } finally {
      setGeneratingToc(false);
    }
  }, [item, generatingToc, updateItem]);

  useEffect(() => {
    const handleResize = () => {
       setIsPortrait(window.innerWidth < 768);
       setIsMobileLandscape(window.innerWidth > window.innerHeight && window.innerHeight <= 500 && window.innerWidth <= 950);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Pantalla completa REAL del navegador (Fullscreen API): oculta la barra de
  // direcciones, pestañas y todo el cromo del navegador. Debe dispararse desde
  // un gesto del usuario (click), por eso vive en el handler del botón.
  const toggleFullscreen = useCallback(() => {
    const docEl: any = document.documentElement;
    const doc: any = document;
    const isNativeFs = !!(doc.fullscreenElement || doc.webkitFullscreenElement);
    if (!isNativeFs) {
      const req = docEl.requestFullscreen || docEl.webkitRequestFullscreen || docEl.msRequestFullscreen;
      // Activamos también el modo expandido propio (oculta header/controles).
      fullscreenIntentRef.current = true;
      setIsFullscreen(true);
      setShowControls(false);
      if (req) {
        Promise.resolve(req.call(docEl)).catch(() => { /* algunos navegadores móviles lo rechazan; el modo CSS ya cubre el caso */ });
      }
    } else {
      // Salida explícita del usuario: ya no queremos mantener fullscreen.
      fullscreenIntentRef.current = false;
      const exit = doc.exitFullscreen || doc.webkitExitFullscreen || doc.msExitFullscreen;
      if (exit) {
        Promise.resolve(exit.call(doc)).catch(() => {});
      }
      setIsFullscreen(false);
    }
  }, []);

  // Sincroniza el estado si el usuario sale del fullscreen nativo con Esc o el
  // gesto del sistema. En táctil, si la salida fue provocada por una rotación
  // (no por el usuario), se re-solicita fullscreen para mantenerlo permanente.
  useEffect(() => {
    const onFsChange = () => {
      const doc: any = document;
      const isNativeFs = !!(doc.fullscreenElement || doc.webkitFullscreenElement);
      if (!isNativeFs) {
        // Si el usuario aún quiere fullscreen (no pulsó salir) y es táctil,
        // no degradamos el modo CSS: lo mantenemos. El re-request nativo se
        // intenta en el handler de orientationchange (requiere gesto en
        // algunos navegadores, pero el modo CSS fixed cubre el caso visual).
        if (fullscreenIntentRef.current && isTouchDevice) {
          setIsFullscreen(true);
          return;
        }
        setIsFullscreen(false);
        setShowControls(true);
      }
    };
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange as any);

    // Al rotar el dispositivo, si el usuario quiere mantener fullscreen, se
    // re-solicita el fullscreen nativo (best-effort).
    const onOrientationChange = () => {
      if (!fullscreenIntentRef.current || !isTouchDevice) return;
      const doc: any = document;
      const docEl: any = document.documentElement;
      const isNativeFs = !!(doc.fullscreenElement || doc.webkitFullscreenElement);
      if (!isNativeFs) {
        const req = docEl.requestFullscreen || docEl.webkitRequestFullscreen || docEl.msRequestFullscreen;
        if (req) Promise.resolve(req.call(docEl)).catch(() => {});
      }
    };
    window.addEventListener('orientationchange', onOrientationChange);

    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      document.removeEventListener('webkitfullscreenchange', onFsChange as any);
      window.removeEventListener('orientationchange', onOrientationChange);
    };
  }, [isTouchDevice]);

  // Ref siempre actualizada a handleTtsStop, para poder llamarla desde
  // listeners/cleanups sin que una closure vieja se quede "pegada".
  const handleTtsStopRef = useRef(handleTtsStop);
  useEffect(() => { handleTtsStopRef.current = handleTtsStop; }, [handleTtsStop]);

  // Detener la lectura de voz al bloquear/minimizar la pantalla (visibilitychange,
  // p.ej. el móvil se bloquea) o al salir de la vista del lector (desmontaje,
  // p.ej. el usuario vuelve a la biblioteca). Evita que el audio siga sonando
  // "en segundo plano" sin que el usuario lo vea ni pueda controlarlo.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        handleTtsStopRef.current();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      handleTtsStopRef.current();
    };
  }, []);

  // Auto-ocultado de la barra flotante de página/zoom tras 5s sin interacción.
  // Reaparece al tocar/hacer click en cualquier parte del lector.
  const [pageControlsVisible, setPageControlsVisible] = useState(true);
  useEffect(() => {
    const resetTimer = () => {
      setPageControlsVisible(true);
    };
    let timer = setTimeout(() => setPageControlsVisible(false), 5000);
    const handleActivity = () => {
      setPageControlsVisible(true);
      clearTimeout(timer);
      timer = setTimeout(() => setPageControlsVisible(false), 5000);
    };
    resetTimer();
    const container = containerRef.current;
    container?.addEventListener('pointerdown', handleActivity);
    return () => {
      clearTimeout(timer);
      container?.removeEventListener('pointerdown', handleActivity);
    };
  }, [bookId]);

  const containerRef = useRef<HTMLDivElement>(null);

  // Arrastre del divisor con Pointer Events: el handle captura el puntero
  // (setPointerCapture en onPointerDown) y tiene touch-action: none, así el
  // navegador no convierte el gesto en scroll ni "suelta" el arrastre a mitad
  // de camino en móvil (con mouse/touch events el scroll nativo secuestraba
  // el gesto tras unos píxeles). Con la captura activa, los pointermove
  // siguen llegando aunque el dedo pase por encima del PDF o del iframe EPUB.
  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
        if (!isDragging) return;
        const container = containerRef.current;
        if (!container) return;
        const rect = container.getBoundingClientRect();

        if (isPortrait) {
            // vertical split
            const y = Math.max(0, Math.min(e.clientY - rect.top, rect.height));
            const p = (y / rect.height) * 100;
            // if position is 'left' (which means top in portrait), Reader is at the top
            // actually let's say 'right' means Notes are at the bottom, so Reader is top
            setSplitRatio(notesPosition === 'right' ? p : 100 - p);
        } else {
            // horizontal split
            const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
            const p = (x / rect.width) * 100;
            setSplitRatio(notesPosition === 'right' ? p : 100 - p);
        }
    };
    const onPointerUp = () => setIsDragging(false);

    if (isDragging) {
        document.addEventListener('pointermove', onPointerMove);
        document.addEventListener('pointerup', onPointerUp);
        document.addEventListener('pointercancel', onPointerUp);
        document.body.style.userSelect = 'none'; // prevent text selection while dragging
    } else {
        document.body.style.userSelect = '';
    }
    return () => {
        document.removeEventListener('pointermove', onPointerMove);
        document.removeEventListener('pointerup', onPointerUp);
        document.removeEventListener('pointercancel', onPointerUp);
        document.body.style.userSelect = '';
    }
  }, [isDragging, notesPosition, isPortrait]);

  const handleDividerPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // Captura: todos los pointermove/up del gesto llegan a este elemento
    // aunque el dedo salga de él (imprescindible para un handle de 6px).
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* navegadores viejos */ }
    e.preventDefault();
    setIsDragging(true);
  }, []);

  // Handle controls disappearing when clicking the screen in fullscreen
  const handleScreenClick = (e: React.MouseEvent) => {
     if (isFullscreen) {
        setShowControls(prev => !prev);
     }
  };

  useEffect(() => {
    // El EPUB gestiona su propia selección/limpieza vía los eventos 'selected'
    // y 'click' de la rendition (la selección real vive dentro del iframe y
    // window.getSelection() del documento principal siempre está vacío aquí,
    // lo que borraría la toolbar de citas en cada mouseup).
    if (item?.type === 'epub') return;

    const captureSelection = () => {
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed && selection.rangeCount > 0) {
        const text = selection.toString().trim();
        if (text) {
          const range = selection.getRangeAt(0);
          const rect = range.getBoundingClientRect();
          setSelectedText(text);
          setSelectionRect({ top: rect.top, left: rect.left, width: rect.width, bottom: rect.bottom });
          return true;
        }
      }
      if (selectionRect) {
         setSelectionRect(null);
      }
      return false;
    };

    // Capturamos texto y posición SIN colapsar la selección: la selección
    // azul nativa se mantiene visible mientras el usuario elige color/parlante.
    // (Antes se llamaba a removeAllRanges() tras 250ms para ocultar la barra
    //  nativa de Chrome, pero eso hacía parpadear/desaparecer la selección.)
    const handleMouseUp = () => { captureSelection(); };

    // selectionchange refleja el estado en tiempo real, incluso mientras se
    // arrastran los handles de selección en móvil. Solo actualizamos texto/rect
    // (para reposicionar la toolbar de la app) y limpiamos cuando se colapsa.
    const handleSelectionChange = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) {
        if (selectionRect) setSelectionRect(null);
        return;
      }
      captureSelection();
    };

    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('touchend', handleMouseUp);
    document.addEventListener('selectionchange', handleSelectionChange);
    return () => {
       document.removeEventListener('mouseup', handleMouseUp);
       document.removeEventListener('touchend', handleMouseUp);
       document.removeEventListener('selectionchange', handleSelectionChange);
    };
  }, [selectionRect, item?.type]);



  const [brightness, setBrightness] = useState(100);
  const [showBrightnessPopup, setShowBrightnessPopup] = useState(false);
  const [interactionMode, setInteractionMode] = useState<'pan' | 'select'>(isPortrait ? 'pan' : 'select');

  if (!item) {
    return <div className="h-screen flex items-center justify-center font-bold">Elemento no encontrado</div>;
  }

  // Dashboard para libros que SOLO existen en físico (sin archivo digital).
  // Usa el mismo "motor" visual que el lector digital: ocupa todo el espacio
  // disponible (sin tarjeta flotante tipo modal), respeta las variables de
  // tema (--bg-app/--bg-card/--text-main/--primary) en vez de colores
  // hardcodeados, y reutiliza la etiqueta "Físico" (texto + icono) que ya usa
  // BookGrid, en vez de una píldora ad-hoc fuera de la línea gráfica.
  // Solo se desactiva lo que no aplica sin texto digital: TTS y resaltado.
  // Libro solo físico: no hay archivo que mostrar en el área de lectura, así
  // que esta queda neutra (mismo fondo que el lector digital) con un único
  // CTA para subir la versión digital. Título, portada, progreso, rating y
  // metadatos viven en la pestaña Info (EditBookModal), igual que en
  // digital — no se crea una "ventana"/tarjeta de detalle aparte.
  const renderPhysicalBookDashboard = () => {
    return (
      <div
        className="w-full h-full flex flex-col items-center justify-start gap-6 overflow-y-auto bg-[#e2e8f0] animate-in fade-in duration-300 py-8 px-4"
        onClick={handleScreenClick}
      >
        {item?.thumbnailUrl && (
          <img
            src={item.thumbnailUrl}
            alt={item.title}
            className="max-w-full max-h-[60vh] w-auto h-auto object-contain shadow-lg rounded-md"
          />
        )}
        <button
          onClick={(e) => { e.stopPropagation(); setActiveTab('edit'); }}
          className="flex flex-col items-center gap-3 px-8 py-6 rounded-2xl border border-dashed border-[var(--border-card)] hover:border-[var(--primary)] bg-[var(--bg-card)] text-[var(--text-muted)] hover:text-[var(--primary)] transition-all shadow-sm active:scale-95 shrink-0"
        >
          <BookIcon className="w-10 h-10" />
          <span className="font-bold text-sm">Subir versión digital</span>
          <span className="text-xs">Este libro solo está registrado como físico</span>
        </button>
      </div>
    );
  };

  const renderReader = () => {
    if (isPhysicalOnly) {
      return renderPhysicalBookDashboard();
    }
    return (
     <div 
        className={cn("w-full h-full flex flex-col relative transition-all duration-300 pointer-events-auto")}
        onClick={handleScreenClick}
     >
        <div className="flex-1 overflow-hidden pointer-events-auto">
          {activeType === 'pdf' && <PDFReader url={activeSource} hideControls={isFullscreen && !showControls} onPageChange={handlePageChange} targetPage={targetPage} controlsVisible={pageControlsVisible} outlineOpen={pdfOutlineOpen} onToggleOutline={() => setPdfOutlineOpen(v => !v)} generatedToc={item.generatedToc} onGenerateToc={handleGenerateToc} generatingToc={generatingToc} hideOwnBar={showTtsWidget} mergedBarPortalTarget={showTtsWidget ? mergedBarSlotEl : null} onScaleChange={handlePdfScaleChange} />}
          {activeType === 'epub' && (
            <EPUBReader
              url={activeSource}
              controlsVisible={pageControlsVisible}
              hideOwnBar={showTtsWidget}
              mergedBarPortalTarget={showTtsWidget ? mergedBarSlotEl : null}
              onContentTap={() => { if (isFullscreen) setShowControls(prev => !prev); }}
              getRendition={(rendition) => {
                epubRenditionRef.current = rendition;
                rendition.on('selected', (_cfiRange: string, contents: any) => {
                  const sel = contents?.window?.getSelection?.();
                  const text = sel?.toString().trim();
                  if (!text || !sel?.rangeCount) return;
                  const range = sel.getRangeAt(0);
                  const rect = range.getBoundingClientRect();
                  // El iframe interno de epubjs tiene su propio viewport; sumamos
                  // su offset para posicionar la toolbar flotante en coordenadas
                  // del documento principal.
                  const iframeEl = contents?.document?.defaultView?.frameElement as HTMLElement | undefined;
                  const iframeRect = iframeEl?.getBoundingClientRect();
                  setSelectedText(text);
                  setSelectionRect({
                    top: rect.top + (iframeRect?.top || 0),
                    left: rect.left + (iframeRect?.left || 0),
                    width: rect.width,
                    bottom: rect.bottom + (iframeRect?.top || 0),
                  });
                });
                // Sin esto, un click sin arrastre dentro del iframe no limpia
                // la toolbar de citas previa (el listener de mouseup del
                // documento principal no llega al iframe).
                rendition.on('click', () => {
                  const sel = (rendition as any).manager?.getContents?.()?.[0]?.window?.getSelection?.();
                  if (sel && !sel.isCollapsed) return;
                  setSelectedText('');
                  setSelectionRect(null);
                });
              }}
            />
          )}
          {activeType === 'txt' && <TxtReader url={activeSource} />}
          {activeType === 'externa' && (
            <div className="w-full h-full flex flex-col pointer-events-auto">
              <div className="bg-[#FFA300]/10 text-[#FFA300] p-3 text-sm font-medium text-center shadow-inner">
                 Estás viendo contenido externo. Algunas funciones pueden estar limitadas.
              </div>
              <iframe src={activeSource} className="w-full flex-1 border-0" sandbox="allow-scripts allow-same-origin bg-white" />
            </div>
          )}
        </div>

          {/* Reproductor de Lector de Voz (TTS) — barra inferior contenida en el
              panel del lector (no debe tapar el panel de Anotaciones) */}
          {showTtsWidget && (
             // flex-col: el panel de configuración (si está abierto) es la única
             // zona que hace scroll y se encoge; la fila de colores y la de
             // controles de reproducción son shrink-0 y SIEMPRE quedan visibles,
             // sin depender de hacer scroll para aparecer (eso era lo que las
             // "ocultaba" en móvil cuando el widget no entraba completo en pantalla).
             // shrink-0 (no absolute): el widget pasa a ocupar su propio
             // espacio en el flujo del flex-col, en vez de flotar encima del
             // documento. Así el contenedor del lector (flex-1, arriba) se
             // reduce automáticamente para dejarle sitio — antes, al ser
             // absolute, el EPUB/PDF se renderizaba a la altura completa sin
             // saber del widget y este quedaba tapando la parte de abajo.
             <div ref={ttsWidgetRef} onClick={(e) => e.stopPropagation()} className="shrink-0 w-full z-40 bg-[var(--bg-card)] border-t border-[var(--border-card)] shadow-2xl backdrop-blur-md animate-in slide-in-from-bottom-2 duration-300 flex flex-col overflow-hidden" style={{ paddingBottom: 'env(safe-area-inset-bottom)', maxHeight: '85dvh' }}>
                <div className="max-w-xl mx-auto px-3 pt-2 pb-2 sm:px-4 w-full flex flex-col min-h-0 overflow-hidden">

                   {/* Panel de configuración colapsable (modelo/voz/origen).
                       Única zona scrolleable del widget; nunca empuja ni oculta
                       la fila de colores ni los controles de reproducción. */}
                   {showTtsSettings && (
                      <div className="flex flex-col gap-2.5 mb-3 pb-3 border-b border-[var(--border-card)] overflow-y-auto custom-scrollbar shrink min-h-0">
                         {/* Selector de Proveedor / Motor de Voz */}
                         <div className="flex items-center justify-between text-xs bg-[var(--bg-app)]/40 border border-[var(--border-card)] rounded-xl p-2.5">
                            <span className="text-[var(--text-muted)] font-semibold">Modelo:</span>
                            <select
                               value={selectedProvider}
                               onChange={(e) => {
                                  const prov = e.target.value as 'elevenlabs' | 'google' | 'google-standard';
                                  handleTtsStop(); // cancela fetch en vuelo, limpia precarga y audio
                                  setSelectedProvider(prov);
                                  if (prov === 'elevenlabs') {
                                     setSelectedVoice('6Gr4AVmTax1pMJO0lHRK');
                                  } else if (prov === 'google') {
                                     setSelectedVoice('Erinome');
                                     setSelectedModel('gemini-2.0-flash');
                                  } else {
                                     setSelectedVoice('es-ES-Standard-A');
                                  }
                               }}
                               className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 text-xs font-bold text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-[var(--primary)] cursor-pointer transition-colors shadow-sm outline-none"
                            >
                               <option value="elevenlabs" className="bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100">ElevenLabs (Voz)</option>
                               <option value="google" className="bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100">Google Gemini (Voz/IA)</option>
                               <option value="google-standard" className="bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100">Google Standard (Gratis)</option>
                            </select>
                         </div>

                         {/* Selector de Modelo (Solo si el motor es Google Gemini) */}
                         {selectedProvider === 'google' && (
                            <div className="flex items-center justify-between text-xs bg-[var(--bg-app)]/40 border border-[var(--border-card)] rounded-xl p-2.5 gap-2">
                               <span className="text-[var(--text-muted)] font-semibold shrink-0">Modelo IA:</span>
                               <select
                                  value={selectedModel}
                                  onChange={(e) => {
                                     handleTtsStop(); // cancela fetch en vuelo antes de cambiar modelo
                                     setSelectedModel(e.target.value);
                                  }}
                                  className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 text-xs font-bold text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-[var(--primary)] cursor-pointer transition-colors shadow-sm outline-none max-w-[165px] truncate"
                               >
                                  {GOOGLE_MODELS.map(m => (
                                     <option key={m.id} value={m.id} className="bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100">{m.name}</option>
                                  ))}
                               </select>
                            </div>
                         )}

                         {/* Selector de Voz con favoritos */}
                         {(() => {
                            const allVoices = selectedProvider === 'elevenlabs' ? ELEVENLABS_VOICES : selectedProvider === 'google' ? GOOGLE_VOICES : GOOGLE_STANDARD_VOICES;
                            const favorites = allVoices.filter(v => favoriteVoices.includes(v.id));
                            const rest = allVoices.filter(v => !favoriteVoices.includes(v.id));
                            const currentVoiceName = allVoices.find(v => v.id === selectedVoice)?.name || selectedVoice;
                            return (
                              <div className="relative text-xs">
                                 <div className="flex items-center justify-between bg-[var(--bg-app)]/40 border border-[var(--border-card)] rounded-xl p-2.5 gap-2">
                                    <span className="text-[var(--text-muted)] font-semibold shrink-0">Voz:</span>
                                    <button
                                       ref={voiceButtonRef}
                                       onClick={() => {
                                          if (!showVoiceDropdown) computeVoiceDropdownPos();
                                          setShowVoiceDropdown(v => !v);
                                       }}
                                       className="flex items-center gap-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 font-bold text-slate-800 dark:text-slate-100 cursor-pointer transition-colors shadow-sm max-w-[170px] truncate"
                                    >
                                       {favoriteVoices.includes(selectedVoice) && <span className="text-yellow-400 text-[10px]">★</span>}
                                       <span className="truncate">{currentVoiceName}</span>
                                       <ChevronUp className="w-3 h-3 shrink-0 opacity-50" />
                                    </button>
                                 </div>
                                 {showVoiceDropdown && voiceDropdownPos && createPortal(
                                    <>
                                       {/* Capa invisible para cerrar el dropdown al tocar fuera */}
                                       <div className="fixed inset-0 z-[60]" onClick={() => setShowVoiceDropdown(false)} />
                                       <div
                                          className="fixed z-[61] w-64 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl overflow-hidden"
                                          style={{
                                             left: Math.max(8, voiceDropdownPos.left),
                                             ...(voiceDropdownPos.top !== undefined ? { top: voiceDropdownPos.top } : { bottom: voiceDropdownPos.bottom }),
                                          }}
                                          onClick={(e) => e.stopPropagation()}
                                       >
                                          <div className="overflow-y-auto custom-scrollbar" style={{ maxHeight: voiceDropdownPos.maxHeight }}>
                                             {favorites.length > 0 && (
                                                <div className="px-2 pt-2 pb-1">
                                                   <span className="text-[10px] text-yellow-500 font-bold uppercase tracking-wide px-1">★ Favoritas</span>
                                                   {favorites.map(v => (
                                                      <button key={v.id} onClick={() => { setSelectedVoice(v.id); handleTtsStop(); setShowVoiceDropdown(false); }}
                                                         className={cn("w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-left transition-colors", selectedVoice === v.id ? "bg-[var(--primary)]/15 text-[var(--primary)]" : "hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100")}
                                                      >
                                                         <span className="truncate text-xs">{v.name}</span>
                                                         <span onClick={(e) => toggleFavoriteVoice(v.id, e)} className="text-yellow-400 hover:text-yellow-500 shrink-0 px-1 cursor-pointer">★</span>
                                                      </button>
                                                   ))}
                                                </div>
                                             )}
                                             {rest.length > 0 && (
                                                <div className="px-2 pt-1 pb-2">
                                                   {favorites.length > 0 && <span className="text-[10px] text-[var(--text-muted)] font-bold uppercase tracking-wide px-1">Todas</span>}
                                                   {rest.map(v => (
                                                      <button key={v.id} onClick={() => { setSelectedVoice(v.id); handleTtsStop(); setShowVoiceDropdown(false); }}
                                                         className={cn("w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-left transition-colors", selectedVoice === v.id ? "bg-[var(--primary)]/15 text-[var(--primary)]" : "hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100")}
                                                      >
                                                         <span className="truncate text-xs">{v.name}</span>
                                                         <span onClick={(e) => toggleFavoriteVoice(v.id, e)} className="text-slate-300 hover:text-yellow-400 shrink-0 px-1 cursor-pointer">☆</span>
                                                      </button>
                                                   ))}
                                                </div>
                                             )}
                                          </div>
                                       </div>
                                    </>,
                                    document.body
                                 )}
                              </div>
                            );
                         })()}

                         {ttsTextSource === 'selection' && (
                            <div className="bg-[var(--bg-app)]/50 border border-[var(--border-card)] rounded-xl p-2.5 flex items-center justify-between text-xs">
                               <span className="text-[var(--text-muted)] text-[10px]">Origen de lectura:</span>
                               <span className="font-semibold text-[var(--text-main)] truncate max-w-[150px]">Texto Seleccionado</span>
                            </div>
                         )}

                         {/* Selector de punto de inicio de la lectura al presionar Play */}
                         <div className="flex items-center justify-between text-xs bg-[var(--bg-app)]/40 border border-[var(--border-card)] rounded-xl p-2.5 gap-2">
                            <span className="text-[var(--text-muted)] font-semibold shrink-0">Comenzar desde:</span>
                            <select
                               value={ttsStartSource}
                               onChange={(e) => setTtsStartSource(e.target.value as 'visible' | 'chapter' | 'lastRead')}
                               className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 text-xs font-bold text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-[var(--primary)] cursor-pointer transition-colors shadow-sm outline-none max-w-[150px] truncate"
                            >
                               <option value="visible" className="bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100">Texto en pantalla</option>
                               <option value="chapter" className="bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100">Inicio del capítulo</option>
                               <option value="lastRead" className="bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100">Última lectura</option>
                            </select>
                         </div>

                         {ttsStatus === 'error' && (
                            <div className="bg-red-500/10 border border-red-500/20 text-red-500 rounded-xl p-3 text-xs leading-relaxed max-h-24 overflow-y-auto custom-scrollbar">
                               {ttsErrorMessage}
                            </div>
                         )}
                      </div>
                   )}

                   {/* Fila de colores: resalta la frase actual y crea la nota en silencio.
                       shrink-0: nunca se comprime ni queda oculta por el panel de config.
                       En móvil horizontal se oculta aquí: se muestra como columna lateral
                       fija a la izquierda de la pantalla (ver bloque tras el widget). */}
                   {!isMobileLandscape && (
                      <div className="flex items-center justify-center gap-3 mb-2 shrink-0">
                         {activePalette.slice(0, 5).map((colorItem) => (
                            <button
                              key={colorItem.id}
                              disabled={currentPhraseIndex < 0 || phrases.length === 0}
                              onClick={(e) => { e.stopPropagation(); createNoteFromCurrentPhrase(colorItem.color, colorItem.hex); }}
                              style={{ backgroundColor: colorItem.hex }}
                              className="w-6 h-6 rounded-full hover:scale-110 active:scale-95 transition-transform ring-2 ring-transparent hover:ring-[var(--border-card)] disabled:opacity-30 disabled:pointer-events-none shadow-sm cursor-pointer"
                              title={`Resaltar y anotar (${colorItem.name})`}
                            />
                         ))}
                      </div>
                   )}

                   {/* Fila de controles de reproducción: [config] [pág◀] [◀◀frase] [stop]
                       [▶play] [frase▶▶] [▶pág] [cerrar]. shrink-0: siempre visible. En
                       móvil vertical NO lleva la paginación/zoom del lector (eso va en su
                       propia fila apilada debajo de los colores, no en este mismo scroll
                       lateral — antes todo iba en una sola fila con overflow-x-auto y
                       quedaba "escondido" a un slide de distancia). */}
                   <div className={cn(
                     "flex items-center justify-start sm:justify-center gap-1 sm:gap-2 overflow-x-auto no-scrollbar px-1 py-0.5 shrink-0 [&>button]:shrink-0",
                     // En horizontal, la columna lateral de colores (w-16, absolute
                     // left-0) tapa el inicio de esta fila: se reserva su ancho.
                     isMobileLandscape && "pl-16"
                   )}>

                      {/* En horizontal (tablet/desktop) el slot de paginación/zoom
                          fusionado sigue viviendo en esta misma fila, junto a los
                          controles de TTS, porque ahí sí hay espacio horizontal de sobra. */}
                      {!isPortrait && (activeType === 'pdf' || activeType === 'epub') && (
                        <>
                          <div ref={setMergedBarSlotEl} className="flex items-center gap-1" />
                          <span className="w-px h-4 bg-[var(--border-card)] mx-0.5" />
                        </>
                      )}

                      {/* Mostrar/ocultar configuración */}
                      <button
                        onClick={() => setShowTtsSettings(v => !v)}
                        className={cn(ttsBtnPad, "border rounded-full transition-all active:scale-95 shadow-sm", showTtsSettings ? "bg-[var(--primary)]/10 text-[var(--primary)] border-[var(--primary)]/30" : "bg-[var(--bg-app)] hover:bg-slate-200/50 border-[var(--border-card)] text-[var(--text-muted)] hover:text-[var(--primary)]")}
                        title="Configuración de voz"
                      >
                         <Settings className={ttsBtnIcon} />
                      </button>

                      {/* Página anterior — triángulo+línea izquierda */}
                      <button
                        disabled={item?.type !== 'epub' && (typeof currentPage === 'number' ? currentPage <= 1 : parseInt(String(currentPage)) <= 1)}
                        onClick={handleTtsPrevPage}
                        className={cn(ttsBtnPad, "bg-[var(--bg-app)] hover:bg-slate-200/50 border border-[var(--border-card)] text-[var(--text-muted)] hover:text-[var(--primary)] disabled:opacity-30 disabled:pointer-events-none rounded-full transition-all active:scale-95 shadow-sm")}
                        title="Página Anterior"
                      >
                         <SkipBack className={cn(ttsBtnIcon, "fill-current")} />
                      </button>

                      {/* Retroceder frase — flechas dobles */}
                      <button
                        disabled={currentPhraseIndex <= 0 || ttsStatus === 'loading' || ttsStatus === 'idle'}
                        onClick={handleTtsPrevious}
                        className={cn(ttsBtnPad, "bg-[var(--bg-app)] hover:bg-slate-200/50 border border-[var(--border-card)] text-[var(--text-muted)] hover:text-[var(--primary)] disabled:opacity-30 disabled:pointer-events-none rounded-full transition-all active:scale-95 shadow-sm")}
                        title="Frase Anterior"
                      >
                         <Rewind className={cn(ttsBtnIcon, "fill-current")} />
                      </button>

                      {/* Stop */}
                      <button
                        disabled={ttsStatus === 'idle' || ttsStatus === 'loading'}
                        onClick={handleTtsStop}
                        className={cn(ttsBtnPad, "bg-[var(--bg-app)] hover:bg-slate-200/50 border border-[var(--border-card)] text-[var(--text-muted)] hover:text-red-500 disabled:opacity-30 disabled:pointer-events-none rounded-full transition-all active:scale-95 shadow-sm")}
                        title="Detener"
                      >
                         <Square className={cn(ttsBtnIcon, "fill-current")} />
                      </button>

                      {/* Play / Pause. En móvil horizontal usa el mismo tamaño que el
                          resto de botones (p-2) para una configuración más fácil. */}
                      <button
                        disabled={ttsStatus === 'loading'}
                        onClick={handleTtsPlayPause}
                        className={cn(
                          "rounded-full text-white shadow-lg transition-all active:scale-95 duration-200 flex items-center justify-center",
                          isMobileLandscape ? "p-2.5" : "p-3.5",
                          ttsStatus === 'playing'
                            ? "bg-[var(--primary)] hover:bg-[var(--primary-hover)] ring-4 ring-[var(--primary)]/15"
                            : "bg-[var(--primary)] hover:bg-[var(--primary-hover)]"
                        )}
                        title={ttsStatus === 'playing' ? "Pausar" : "Reproducir"}
                      >
                         {ttsStatus === 'loading' ? (
                            <Loader2 className={cn(isMobileLandscape ? "w-6 h-6" : "w-5 h-5", "animate-spin")} />
                         ) : ttsStatus === 'playing' ? (
                            <Pause className={cn(isMobileLandscape ? "w-6 h-6" : "w-5 h-5", "fill-current")} />
                         ) : (
                            <Play className={cn(isMobileLandscape ? "w-6 h-6" : "w-5 h-5", "fill-current ml-0.5")} />
                         )}
                      </button>

                      {/* Adelantar frase — flechas dobles */}
                      <button
                        disabled={currentPhraseIndex >= phrases.length - 1 || ttsStatus === 'loading' || ttsStatus === 'idle'}
                        onClick={handleTtsNext}
                        className={cn(ttsBtnPad, "bg-[var(--bg-app)] hover:bg-slate-200/50 border border-[var(--border-card)] text-[var(--text-muted)] hover:text-[var(--primary)] disabled:opacity-30 disabled:pointer-events-none rounded-full transition-all active:scale-95 shadow-sm")}
                        title="Frase Siguiente"
                      >
                         <FastForward className={cn(ttsBtnIcon, "fill-current")} />
                      </button>

                      {/* Página siguiente — triángulo+línea derecha */}
                      <button
                        disabled={item?.type !== 'epub' && (typeof currentPage === 'number' ? currentPage >= totalPages : parseInt(String(currentPage)) >= totalPages)}
                        onClick={handleTtsNextPage}
                        className={cn(ttsBtnPad, "bg-[var(--bg-app)] hover:bg-slate-200/50 border border-[var(--border-card)] text-[var(--text-muted)] hover:text-[var(--primary)] disabled:opacity-30 disabled:pointer-events-none rounded-full transition-all active:scale-95 shadow-sm")}
                        title="Página Siguiente"
                      >
                         <SkipForward className={cn(ttsBtnIcon, "fill-current")} />
                      </button>

                      {/* Cerrar reproductor */}
                      <button
                        onClick={handleTtsClose}
                        className={cn(ttsBtnPad, "bg-[var(--bg-app)] hover:bg-red-50 border border-[var(--border-card)] text-[var(--text-muted)] hover:text-red-500 rounded-full transition-all active:scale-95 shadow-sm")}
                        title="Cerrar Lector de Voz"
                      >
                         <X className={ttsBtnIcon} />
                      </button>

                   </div>

                   {/* Móvil vertical: paginación/zoom del lector en su PROPIA fila,
                       apilada debajo (reproductor → colores → paginación/zoom), en vez
                       de compartir el scroll lateral de los controles de reproducción. */}
                   {isPortrait && (activeType === 'pdf' || activeType === 'epub') && (
                      <div className="flex items-center justify-center gap-1 overflow-x-auto no-scrollbar px-1 py-0.5 mt-1 shrink-0 [&>button]:shrink-0 border-t border-[var(--border-card)] pt-2">
                         <div ref={setMergedBarSlotEl} className="flex items-center gap-1" />
                      </div>
                   )}

                </div>
             </div>
          )}

          {/* Móvil horizontal: columna lateral fija de colores a la izquierda,
              fuera del recuadro del widget (como en la maqueta), para no robar
              ancho a la fila de controles cuando hay poco alto disponible. */}
          {/* Ancho fijo w-16 (64px): la fila de controles del widget lleva
              pl-16 en horizontal para empezar justo después de la columna,
              sin que los círculos tapen la paginación. Los círculos (máx. 5)
              se reparten el alto disponible con tamaño flexible (clamp). */}
          {showTtsWidget && isMobileLandscape && (
             <div onClick={(e) => e.stopPropagation()} className="absolute top-0 left-0 bottom-0 z-40 w-16 flex flex-col items-center justify-evenly gap-2 py-2 px-2 bg-[var(--bg-card)]/95 backdrop-blur-md border-r border-[var(--border-card)]">
                {activePalette.slice(0, 5).map((colorItem) => (
                   <button
                     key={colorItem.id}
                     disabled={currentPhraseIndex < 0 || phrases.length === 0}
                     onClick={(e) => { e.stopPropagation(); createNoteFromCurrentPhrase(colorItem.color, colorItem.hex); }}
                     style={{ backgroundColor: colorItem.hex }}
                     className="h-[clamp(1.75rem,10vh,3rem)] w-[clamp(1.75rem,10vh,3rem)] rounded-full hover:scale-110 active:scale-95 transition-transform ring-2 ring-transparent hover:ring-[var(--border-card)] disabled:opacity-30 disabled:pointer-events-none shadow-md cursor-pointer shrink"
                     title={`Resaltar y anotar (${colorItem.name})`}
                   />
                ))}
             </div>
          )}
     </div>
    );
  };

  const handleClearSelection = useCallback(() => {
     setSelectedText('');
     setSelectionRect(null);
  }, []);

  const renderNotes = () => (
     <div
        className="w-full h-full relative bg-white flex flex-col pointer-events-auto overflow-hidden text-sm"
     >
        <NotesPanel
            documentId={bookId}
            notes={documentNotes}
            addNote={addDocumentNote}
            addBookmark={addDocumentBookmark}
            editNote={editDocumentNote}
            deleteNote={deleteDocumentNote}
            currentPage={currentPage}
            onNavigateToPage={(page) => setTargetPage({ page: Number(page), t: Date.now() })}
            onNavigateToCitation={(note) => {
              const colorDef = activePalette.find(c => c.id === note.color);
              if (note.quote) {
                setPendingHighlight({ text: note.quote, color: colorDef?.hex || '#fbbf24' });
              }
              if (item?.type !== 'epub' && note.pageReference) {
                setTargetPage({ page: Number(note.pageReference), t: Date.now() });
              }
            }}
            onRecolorCitation={(note) => {
              if (!note.quote) return;
              const colorDef = activePalette.find(c => c.id === note.color);
              // Re-pinta en sitio (sin scroll): limpia el resaltado anterior y
              // aplica el nuevo color sobre la frase actualmente visible.
              clearPersistentHighlights();
              highlightCurrentPhrase(note.quote, colorDef?.hex || '#fbbf24', true);
            }}
        />
     </div>
  );

  const readerPaneStyle: React.CSSProperties = showNotes
      ? {
          [isPortrait ? 'height' : 'width']: `${splitRatio}%`,
          [isPortrait ? 'width' : 'height']: '100%'
        }
      : { width: '100%', height: '100%' };

  // El panel de notas SIEMPRE conserva su porción del split, también al escribir.
  // (Antes, al enfocar el textarea en móvil, pasaba a `position: fixed` a pantalla
  // completa y tapaba el documento; ahora se mantiene dentro de su contenedor y
  // el campo de texto queda sobre el teclado de forma natural.)
  const notesPaneStyle: React.CSSProperties = showNotes
      ? {
          [isPortrait ? 'height' : 'width']: `${100 - splitRatio}%`,
          [isPortrait ? 'width' : 'height']: '100%'
        }
      : { display: 'none' };

  // Autoguardado de la posición de lectura al cambiar de página.
  // Se guarda SIEMPRE que cambie la página (no solo cuando cambia el % redondeado):
  // en libros largos dos páginas seguidas pueden dar el mismo porcentaje y, si solo
  // se comparara el progreso, el marcador no se guardaría y al reabrir se perdería
  // la página. Comparamos también bookmarkPage para evitar escrituras redundantes.
  useEffect(() => {
    if (!item || !totalPages) return;
    const pageNum = Number(currentPage);
    if (!Number.isFinite(pageNum) || pageNum < 1) return;
    const calculatedProgress = Math.min(100, Math.max(0, Math.round((pageNum / totalPages) * 100)));
    const pageChanged = String(item.bookmarkPage ?? '') !== String(currentPage);
    if (calculatedProgress !== item.progress || pageChanged) {
      updateItem(item.id, { progress: calculatedProgress, bookmarkPage: currentPage });
    }
  }, [currentPage, totalPages, item, updateItem]);

  return (
    <div
      className={cn("flex flex-col bg-[var(--bg-app)] overflow-hidden relative", isFullscreen ? "fixed inset-0 z-[100] bg-black" : "")}
      style={{ filter: `brightness(${brightness}%)`, height: '100dvh' }}
    >
      
      {/* Header */}
      {/* Libro solo físico: no hay texto que tape el header, así que se
          mantiene siempre visible (no depende del auto-ocultado táctil que
          usa el lector digital en pantalla completa). */}
      {(isPhysicalOnly || !isFullscreen || showControls) && (
        <header className="bg-white border-b border-slate-200 px-2 sm:px-4 h-14 flex flex-row items-center justify-between shrink-0 shadow-sm z-30 gap-2 w-full animate-in slide-in-from-top-4">
            <div className="flex items-center gap-2 sm:gap-4 shrink-0">
            <button
                onClick={() => {
                  fullscreenIntentRef.current = false;
                  const doc: any = document;
                  if (doc.fullscreenElement || doc.webkitFullscreenElement) {
                    const exit = doc.exitFullscreen || doc.webkitExitFullscreen || doc.msExitFullscreen;
                    if (exit) Promise.resolve(exit.call(doc)).catch(() => {});
                  }
                  if (isFullscreen) setIsFullscreen(false);
                  else onClose();
                }}
                className="flex items-center text-slate-500 hover:text-[var(--primary)] transition-colors shrink-0 bg-slate-100/50 hover:bg-slate-100 p-2 rounded-lg"
                title="Volver"
            >
                <ChevronLeft className="w-5 h-5" />
            </button>
            <div className="h-6 w-px bg-slate-200 mx-1 shrink-0 hidden sm:block" />
            <div className="flex-1 min-w-0 flex items-center pr-2 hidden md:flex">
                <h2 className="text-sm sm:text-base font-bold text-slate-800 tracking-tight leading-tight truncate">
                {item.title}
                </h2>
            </div>
            {/* Selector de versión PDF/EPUB cuando el libro tiene ambos formatos */}
            {availableFormats.filter(f => f === 'pdf' || f === 'epub' || f === 'txt').length > 1 && (
              <div className="flex bg-slate-100 p-0.5 rounded-lg shrink-0 gap-0.5 items-center">
                {availableFormats.filter(f => f === 'pdf' || f === 'epub' || f === 'txt').map(f => (
                  <button
                    key={f}
                    onClick={() => setActiveFormat(f)}
                    className={cn(
                      "px-2 py-1 rounded-md text-[10px] font-bold uppercase transition-all",
                      activeType === f ? "bg-white text-[var(--primary)] shadow-sm" : "text-slate-500 hover:text-slate-700"
                    )}
                    title={`Ver versión ${f.toUpperCase()}`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            )}
            </div>

            <div className="flex items-center justify-end gap-2 flex-1 min-w-0">
             <div className="flex items-center justify-end gap-2 overflow-x-auto no-scrollbar shrink">
                 <div className="flex bg-slate-100 p-1 rounded-lg shrink-0 gap-1 items-center">
                     <button 
                         onClick={() => setActiveTab('reader')}
                         className={cn("p-1.5 sm:p-2 rounded-md transition-all", activeTab === 'reader' ? "bg-white text-[var(--primary)] shadow-sm scale-105" : "text-slate-500 hover:text-slate-700 hover:bg-slate-200/50")}
                         title="Lectura"
                     >
                         <BookOpen className="w-4 h-4 sm:w-5 sm:h-5" />
                     </button>
                     <button
                         onClick={() => {
                             const opening = activeTab !== 'citations';
                             setActiveTab(opening ? 'citations' : 'reader');
                             if (opening) setShowNotes(false);
                         }}
                         className={cn("p-1.5 sm:p-2 rounded-md transition-all", activeTab === 'citations' ? "bg-white text-[var(--primary)] shadow-sm scale-105" : "text-slate-500 hover:text-slate-700 hover:bg-slate-200/50")}
                         title="Administrar citas"
                     >
                         <ClipboardList className="w-4 h-4 sm:w-5 sm:h-5" />
                     </button>
                     <button
                         onClick={() => setActiveTab(activeTab === 'edit' ? 'reader' : 'edit')}
                         className={cn("p-1.5 sm:p-2 rounded-md transition-all", activeTab === 'edit' ? "bg-white text-[var(--primary)] shadow-sm scale-105" : "text-slate-500 hover:text-slate-700 hover:bg-slate-200/50")}
                         title="Información y Metadatos"
                     >
                         <Info className="w-4 h-4 sm:w-5 sm:h-5" />
                     </button>
                     <button
                         onClick={() => setActiveTab(activeTab === 'resources' ? 'reader' : 'resources')}
                         className={cn("p-1.5 sm:p-2 rounded-md transition-all", activeTab === 'resources' ? "bg-white text-[var(--primary)] shadow-sm scale-105" : "text-slate-500 hover:text-slate-700 hover:bg-slate-200/50")}
                         title="Recursos (videos, audios, textos, imágenes)"
                     >
                         <FolderOpen className="w-4 h-4 sm:w-5 sm:h-5" />
                     </button>
                     {item.type === 'pdf' && item.source?.startsWith('/api/files/') && itemCategoryName.toLowerCase() === 'estudio' && (
                       <button
                         onClick={() => setActiveTab(activeTab === 'auditor' ? 'reader' : 'auditor')}
                         className={cn("p-1.5 sm:p-2 rounded-md transition-all", activeTab === 'auditor' ? "bg-white text-[var(--primary)] shadow-sm scale-105" : "text-slate-500 hover:text-slate-700 hover:bg-slate-200/50")}
                         title="Auditoría Científica"
                       >
                         <FlaskConical className="w-4 h-4 sm:w-5 sm:h-5" />
                       </button>
                     )}
                 </div>
             </div>
 
             {/* Fixed right tools */}
             {activeTab === 'reader' && (
               isPhysicalOnly ? (
                 // Libro solo físico: mismo motor que el digital, solo se
                 // desactiva lo que no aplica sin texto digital (TTS, brillo
                 // y Marcadores, ya que sin archivo no hay páginas reales que
                 // marcar). Pantalla completa y Notas se mantienen.
                 <div className="flex items-center gap-1 sm:gap-2 shrink-0">
                  <button
                      onClick={toggleFullscreen}
                      className={cn("p-2 rounded-lg flex items-center justify-center transition-colors shadow-sm border shrink-0", isFullscreen ? "bg-[var(--primary)] text-white border-[var(--primary)]" : "bg-white text-slate-600 hover:text-[var(--primary)] border-slate-200 hover:border-[var(--secondary)]")}
                      title="Pantalla Completa"
                  >
                      {isFullscreen ? <Minimize className="w-4 h-4 sm:w-5 sm:h-5" /> : <Maximize className="w-4 h-4 sm:w-5 sm:h-5" />}
                  </button>
                   <button
                       onClick={() => setShowNotes(!showNotes)}
                       className={cn("p-2 rounded-lg flex items-center justify-center transition-colors shadow-sm border shrink-0", showNotes ? "bg-[var(--primary)] text-white border-[var(--primary)]" : "bg-white text-slate-600 hover:text-[var(--primary)] border-slate-200 hover:border-[var(--secondary)]")}
                       title="Apuntes y Notas"
                   >
                       <MessageSquareQuote className="w-4 h-4 sm:w-5 sm:h-5" />
                   </button>
                 </div>
               ) : (activeType === 'pdf' || activeType === 'epub' || activeType === 'txt') && (
                 <div className="flex items-center gap-1 sm:gap-2 shrink-0">
                  {/* Lector de Voz (TTS ElevenLabs) */}
                  <button 
                      onClick={() => setShowTtsWidget(!showTtsWidget)} 
                      className={cn("p-2 rounded-lg flex items-center justify-center transition-colors shadow-sm border shrink-0", showTtsWidget ? "bg-slate-100 text-[var(--primary)] border-slate-200" : "bg-white text-slate-600 hover:text-[var(--primary)] border-slate-200 hover:border-[var(--secondary)]")}
                      title="Lector de Voz (TTS)"
                  >
                      <Volume2 className="w-4 h-4 sm:w-5 sm:h-5" />
                  </button>
                  {/* Brightness */}
                  <div className="relative">
                     <button 
                         onClick={() => setShowBrightnessPopup(!showBrightnessPopup)} 
                         className={cn("p-2 rounded-lg flex items-center justify-center transition-colors shadow-sm border shrink-0", showBrightnessPopup ? "bg-slate-100 text-[var(--primary)] border-slate-200" : "bg-white text-slate-600 hover:text-[var(--primary)] border-slate-200 hover:border-[var(--secondary)]")}
                         title="Brillo"
                     >
                         <Sun className="w-4 h-4 sm:w-5 sm:h-5" />
                     </button>
                     {showBrightnessPopup && (
                         <div className="absolute top-full right-0 mt-2 bg-white rounded-xl shadow-xl border border-slate-200 p-3 z-50 flex items-center gap-3">
                             <Sun className="w-4 h-4 text-slate-400" />
                             <input 
                                type="range" 
                                min="20" max="100" 
                                value={brightness} 
                                onChange={(e) => setBrightness(Number(e.target.value))} 
                                className="w-24 sm:w-32 accent-[var(--primary)]" 
                             />
                         </div>
                     )}
                  </div>
                  
                  {/* Multi-bookmark: lista desplegable + modal de nombre. */}
                  <BookmarksMenu
                     documentId={bookId}
                     currentPage={currentPage}
                     isEpub={item?.type === 'epub'}
                     getEpubAnchor={getEpubBookmarkAnchor}
                     onNavigate={(page) => {
                       // EPUB: el "page" guardado es un CFI → navegar por CFI.
                       if (item?.type === 'epub' && typeof page === 'string' && page.startsWith('epubcfi(')) {
                         navigateEpubToCfi(page);
                       } else {
                         setTargetPage({ page: Number(page), t: Date.now() });
                       }
                     }}
                  />

                  <button
                      onClick={toggleFullscreen}
                      className={cn("p-2 rounded-lg flex items-center justify-center transition-colors shadow-sm border shrink-0", isFullscreen ? "bg-[var(--primary)] text-white border-[var(--primary)]" : "bg-white text-slate-600 hover:text-[var(--primary)] border-slate-200 hover:border-[var(--secondary)]")}
                      title="Pantalla Completa"
                  >
                      {isFullscreen ? <Minimize className="w-4 h-4 sm:w-5 sm:h-5" /> : <Maximize className="w-4 h-4 sm:w-5 sm:h-5" />}
                  </button>
                  <button 
                      onClick={() => setShowNotes(!showNotes)} 
                      className={cn("p-2 rounded-lg flex items-center justify-center transition-colors shadow-sm border shrink-0", showNotes ? "bg-[var(--primary)] text-white border-[var(--primary)]" : "bg-white text-slate-600 hover:text-[var(--primary)] border-slate-200 hover:border-[var(--secondary)]")}
                      title="Apuntes y Notas"
                  >
                      <MessageSquareQuote className="w-4 h-4 sm:w-5 sm:h-5" />
                  </button>
                 </div>
               )
             )}
            </div>
        </header>
      )}

      {/* Main Content Area */}
      <main 
         ref={containerRef}
         className={cn("flex-1 relative overflow-hidden flex", isPortrait ? "flex-col" : "flex-row", (isFullscreen && !showControls) ? "bg-[#e2e8f0]" : "bg-[#e2e8f0]")}
      >
         {selectionRect && selectedText && (
            <div
              className="fixed z-[1000] bg-slate-800 text-white rounded-lg shadow-2xl flex items-center overflow-hidden animate-in fade-in zoom-in-95 duration-100"
              style={{
                // Se posiciona DEBAJO de la selección: el menú nativo de Chrome
                // (Copiar/Compartir) aparece arriba, así no se tapan entre sí.
                top: Math.min(selectionRect.bottom + 12, window.innerHeight - 60),
                left: Math.max(10, Math.min(selectionRect.left + (selectionRect.width / 2) - 100, window.innerWidth - 210))
              }}
              onMouseDown={e => e.preventDefault()}
            >
               <div className="flex px-4 py-2.5 gap-3 items-center">
                  {activePalette.map((colorItem) => (
                     <button
                       key={colorItem.id}
                       onClick={() => {
                         // El EPUB es reflowable y no tiene número de página real
                         // (currentPage queda fijo en el bookmark inicial), así
                         // que omitimos la referencia de página para no guardar
                         // un dato incorrecto.
                         addCitation({ text: selectedText, color: colorItem.color, page: item?.type === 'epub' ? undefined : currentPage });
                         // Abrir el panel ya es solo una decisión de UX (feedback
                         // visual inmediato), no una condición para que la cita
                         // se guarde — addCitation() ya la persistió.
                         if (!showNotes) setShowNotes(true);
                         handleClearSelection();
                       }}
                       style={{ backgroundColor: colorItem.hex }}
                       className="w-5 h-5 rounded-full hover:scale-110 active:scale-95 transition-transform ring-2 ring-transparent hover:ring-white/50 cursor-pointer"
                       title={colorItem.name}
                     />
                  ))}
                  {/* Leer en voz alta el texto seleccionado — solo si el TTS no está activo */}
                  {(ttsStatus === 'idle' || ttsStatus === 'error') && (
                     <button
                       onClick={() => {
                         setSelectionRect(null);
                         setShowTtsWidget(true);
                         // handleTtsPlayPause captura el texto seleccionado de
                         // forma síncrona al inicio; lo limpiamos justo después
                         // para que el siguiente Play/Pause no quede anclado a
                         // la selección anterior.
                         handleTtsPlayPause();
                         setSelectedText('');
                       }}
                       className="w-7 h-7 flex items-center justify-center text-white hover:scale-110 active:scale-95 transition-transform border-l border-white/20 pl-3 ml-1 shrink-0"
                       title="Leer en voz alta"
                     >
                        <Volume2 className="w-5 h-5" />
                     </button>
                  )}
               </div>
            </div>
         )}

         {notesPosition === 'right' ? (
             <>
             <div style={readerPaneStyle} className="relative z-10 min-w-0 min-h-0">{renderReader()}</div>
             {showNotes && (
                 <>
                     <div 
                         onPointerDown={handleDividerPointerDown}
                         className={cn("z-20 hover:bg-[var(--primary)] transition-colors flex items-center justify-center shadow-lg active:bg-[var(--primary)] shrink-0 touch-none", isPortrait ? "h-6 w-full cursor-row-resize bg-slate-200" : "w-6 h-full cursor-col-resize bg-slate-200")}
                     >
                         <div className={cn("bg-slate-400 rounded-full", isPortrait ? "w-8 h-1" : "h-8 w-1")} />
                     </div>
                     <div style={notesPaneStyle} className="relative z-10 border-t md:border-t-0 md:border-l border-slate-200 shadow-2xl min-w-0 min-h-0">{renderNotes()}</div>
                 </>
             )}
             </>
         ) : (
             <>
             {showNotes && (
                 <>
                     <div style={notesPaneStyle} className="relative z-10 border-b md:border-b-0 md:border-r border-slate-200 shadow-2xl min-w-0 min-h-0">{renderNotes()}</div>
                     <div 
                         onPointerDown={handleDividerPointerDown}
                         className={cn("z-20 hover:bg-[var(--primary)] transition-colors flex items-center justify-center shadow-lg active:bg-[var(--primary)] shrink-0 touch-none", isPortrait ? "h-6 w-full cursor-row-resize bg-slate-200" : "w-6 h-full cursor-col-resize bg-slate-200")}
                     >
                         <div className={cn("bg-slate-400 rounded-full", isPortrait ? "w-8 h-1" : "h-8 w-1")} />
                     </div>
                 </>
             )}
             <div style={readerPaneStyle} className="relative z-10 min-w-0 min-h-0">{renderReader()}</div>
             </>
         )}

         {/* Info & Metadatos Overlay Panel. ÚNICO scroll: el del propio overlay.
             EditBookModal inline NO debe tener su propio overflow-y-auto. */}
         {activeTab === 'edit' && (
            <div className="absolute inset-0 z-40 bg-white/95 backdrop-blur-md animate-in fade-in slide-in-from-bottom-5 duration-300 overflow-y-auto shadow-2xl">
               <EditBookModal item={item} inline={true} onClose={() => setActiveTab('reader')} onSave={(id, updates) => { updateItem(id, updates); setActiveTab('reader'); }} />
            </div>
          )}

          {/* Auditoría Científica */}
          {activeTab === 'auditor' && (
            <div className="absolute inset-0 z-40 bg-white/95 backdrop-blur-md animate-in fade-in slide-in-from-bottom-5 duration-300 overflow-y-auto shadow-2xl">
              <AuditorPanel item={item} onClose={() => setActiveTab('reader')} />
            </div>
          )}

          {/* Recursos (videos, audios, textos, imágenes) */}
          {activeTab === 'resources' && (
            <div className="absolute inset-0 z-40 bg-white animate-in fade-in slide-in-from-bottom-5 duration-300 shadow-2xl">
              <ResourcesPanel bookId={item.id} />
            </div>
          )}

          {/* Citations Administration View */}
          {activeTab === 'citations' && (
             <CitationsManager
               documentId={item.id}
               notes={documentNotes}
               activePalette={activePalette}
               savePalette={savePalette}
               saveNotes={saveDocumentNotes}
               onClose={() => setActiveTab('reader')}
               onNavigateToPage={(page) => {
                 setTargetPage({ page: Number(page), t: Date.now() });
                 setActiveTab('reader');
               }}
               onNavigateToCitation={(note) => {
                 const colorDef = activePalette.find(c => c.id === note.color);
                 if (note.quote) {
                   setPendingHighlight({ text: note.quote, color: colorDef?.hex || '#fbbf24' });
                 }
                 if (item?.type !== 'epub' && note.pageReference) {
                   setTargetPage({ page: Number(note.pageReference), t: Date.now() });
                 }
                 setActiveTab('reader');
               }}
               currentPage={currentPage}
             />
          )}
      </main>

      {showFolderManager && (
         <FolderManagerModal 
           book={item} 
           onClose={() => setShowFolderManager(false)} 
         />
      )}
    </div>
  );
}
