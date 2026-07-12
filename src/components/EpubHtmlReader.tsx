// =============================================================================
// EpubHtmlReader.tsx — Motor de lectura EPUB v2, SIN IFRAMES.
// -----------------------------------------------------------------------------
// epub.js se usa ÚNICAMENTE como parser del ZIP/OPF (spine, navegación,
// archivo). Cada sección se extrae como HTML sanitizado y el contenido se
// construye IMPERATIVAMENTE (fuera de React) dentro de un contenedor del
// documento principal, agrupado en HOJAS REALES:
//
//  - VERTICAL: cada página de 300 palabras es una TARJETA blanca con sombra,
//    separada de la siguiente por el fondo gris — exactamente el aspecto del
//    visor de PDF de la app. Scroll vertical nativo.
//  - HORIZONTAL: cada hoja mide EXACTAMENTE el viewport (el corte se calcula
//    geométricamente por línea: el contenedor visual es el límite, nada se
//    desborda) y se desliza con scroll-snap nativo; position:sticky hace que
//    la hoja siguiente pase POR ENCIMA de la actual con sombra, como una
//    página de verdad. Cero JavaScript táctil.
//
// Lecciones de ReadEra aplicadas (ver plan "Nuevo motor EPUB v2"):
//  - Puntero topológico estable {sección, offset de carácter} — nunca números
//    de página como referencia persistente.
//  - Scroll 100% nativo: PROHIBIDO registrar touchstart/move/end propios,
//    hacer preventDefault del scroll o transformar el contenedor con JS.
//  - Render completo al abrir con overlay de carga: el texto SIEMPRE está
//    disponible (búsquedas, citas y TTS nunca fallan por contenido no
//    montado).
//  - Resaltados como <mark> EN el flujo: refluyen solos con el texto.
//  - UN solo tamaño de letra (pedido explícito del usuario) y páginas
//    verticales FIJAS por conteo de palabras: el total de páginas es una
//    propiedad del TEXTO, igual en cualquier dispositivo.
// =============================================================================

import { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import { createPortal } from 'react-dom';
import ePub from 'epubjs';
import { get } from 'idb-keyval';
import { List, ChevronDown, ChevronLeft, Loader2, GalleryHorizontal, GalleryVertical } from 'lucide-react';
import { cn } from '../lib/utils';

// ---------------------------------------------------------------------------
// Contrato de integración: ReaderView habla con el lector SOLO por aquí.
// ---------------------------------------------------------------------------
export interface EpubAnchor { s: number; o: number } // sección del spine + offset de carácter

export interface EpubReaderHandle {
  getVisibleText(): string;
  getFullText(): string;
  getCurrentAnchor(): EpubAnchor | null;
  goToAnchor(a: EpubAnchor, center?: boolean): void;
  goToText(text: string, center?: boolean): boolean;
  // scroll=true (por defecto) centra la vista en el resaltado (TTS / navegar
  // a cita). Para el REPINTADO masivo de citas al reconstruir el layout se
  // pasa false: pintar muchas no debe saltar el encuadre a la última.
  highlightText(text: string, colorHex: string, persistent: boolean, scroll?: boolean): boolean;
  clearHighlights(includePersistent: boolean): void;
  pageBy(delta: number): void;           // salto de página (hoja) anterior/siguiente
  scrollByViewport(delta: number): void; // salto manual de página del TTS
  // Texto que SIGUE al último resaltado TTS (dominio del texto, no píxeles):
  // el avance automático del audiolibro continúa exactamente donde quedó,
  // sin repetir ni saltarse nada aunque un párrafo ocupe varias pantallas.
  getContinuationText(maxWords: number): string;
}

export const serializeAnchor = (a: EpubAnchor): string => `s${a.s}:o${a.o}`;
export const parseAnchor = (v: unknown): EpubAnchor | null => {
  if (typeof v !== 'string') return null;
  const m = /^s(\d+):o(\d+)$/.exec(v);
  return m ? { s: Number(m[1]), o: Number(m[2]) } : null;
};

interface EpubHtmlReaderProps {
  url: string;
  onReady?: () => void;
  onRelocate?: (anchor: EpubAnchor | null, page: { current: number; total: number }) => void;
  onContentTap?: () => void;
  onParseError?: (err: unknown) => void;
  // Se dispara al FINAL de cada construcción del layout (apertura, cambio de
  // modo v↔h, resize horizontal). buildLayout() hace innerHTML='' y borra
  // los <mark>: ReaderView lo usa para repintar las citas guardadas.
  onLayoutReady?: () => void;
  controlsVisible?: boolean;
  hideOwnBar?: boolean;
  mergedBarPortalTarget?: HTMLElement | null;
}

interface SectionData { html: string; text: string; href: string; words: number }

// La página VERTICAL se define por una CANTIDAD FIJA DE PALABRAS (estándar
// editorial): el libro tiene siempre el mismo número de páginas en cualquier
// dispositivo. La hoja HORIZONTAL se corta por geometría (lo que cabe en la
// pantalla, línea a línea) y muestra como número la página-por-palabras a la
// que pertenece su primera palabra.
const WORDS_PER_PAGE = 300;
const HL_CLASS = '__epub-hl__';
const PAGE_CLASS = '__epub-page__';   // hoja vertical (tarjeta)
const SHEET_CLASS = '__esheet__';     // hoja horizontal (viewport exacto)
const PGSTART_CLASS = '__pgstart__';  // marcador temporal: bloque que inicia página
const CONT_CLASS = '__epub-cont__';   // mitad-continuación de un bloque partido
const SHEET_PAD_X = 22;               // padding horizontal de la hoja horizontal (px)
const SHEET_PAD_Y = 18;               // padding vertical de la hoja horizontal (px)
const SHEET_GAP = 10;                 // espacio gris entre hojas horizontales (px)
const SHEET_SAFETY = 4;               // margen de seguridad del corte geométrico (px)

type ViewMode = 'v' | 'h';

const countWords = (s: string): number => {
  const t = s.trim();
  return t ? t.split(/\s+/).length : 0;
};

// Normaliza texto igual en TODOS los caminos (extracción, búsqueda, mapa de
// caracteres): NFKC + colapso de espacios. Consistencia total = los matches
// nunca fallan por diferencias de espaciado.
const normalize = (s: string) => s.normalize('NFKC').replace(/\s+/g, ' ');

// ---------------------------------------------------------------------------
// Sanitización de una sección (seguridad + tipografía propia consistente).
// ---------------------------------------------------------------------------
function resolvePath(relative: string, baseHref: string): string {
  try {
    return decodeURIComponent(new URL(relative, 'http://epub.local/' + baseHref).pathname.replace(/^\//, ''));
  } catch {
    return relative;
  }
}

async function sanitizeSection(body: HTMLElement, sectionHref: string, book: any, blobUrls: string[]): Promise<string> {
  body.querySelectorAll('script, style, link, iframe, object, embed, form').forEach(n => n.remove());

  body.querySelectorAll('*').forEach(el => {
    // Copia de nombres primero: mutar attributes mientras se itera los salta.
    const names = Array.from(el.attributes).map(a => a.name);
    for (const name of names) {
      if (name.startsWith('on') || name === 'style') el.removeAttribute(name);
    }
  });

  // Imágenes: el src relativo del zip se convierte a blob URL vía el archivo
  // del propio epub.js. Si algo falla, la imagen se quita (mejor sin imagen
  // que un icono roto).
  const imgs = Array.from(body.querySelectorAll('img, image'));
  for (const img of imgs) {
    const raw = img.getAttribute('src') || img.getAttribute('xlink:href') || img.getAttribute('href') || '';
    if (!raw || raw.startsWith('data:') || raw.startsWith('http')) continue;
    const resolved = resolvePath(raw, sectionHref);
    let blobUrl: string | null = null;
    try {
      blobUrl = await book.archive?.createUrl?.(resolved, { base64: false });
    } catch { /* probar con slash inicial (epubjs a veces guarda rutas absolutas) */ }
    if (!blobUrl) {
      try { blobUrl = await book.archive?.createUrl?.('/' + resolved, { base64: false }); } catch { /* sin recurso */ }
    }
    if (blobUrl) {
      blobUrls.push(blobUrl);
      img.setAttribute('src', blobUrl);
      img.removeAttribute('xlink:href');
      img.removeAttribute('href');
    } else {
      img.remove();
    }
  }

  // Enlaces: internos → data-internal-href (el contenedor los intercepta);
  // externos → pestaña nueva.
  body.querySelectorAll('a[href]').forEach(a => {
    const href = a.getAttribute('href') || '';
    if (/^https?:\/\//i.test(href)) {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    } else {
      a.setAttribute('data-internal-href', resolvePath(href.split('#')[0], sectionHref));
      const hash = href.includes('#') ? href.split('#')[1] : '';
      if (hash) a.setAttribute('data-internal-hash', hash);
      a.removeAttribute('href');
    }
  });

  return body.innerHTML;
}

// ---------------------------------------------------------------------------
// Mapa de caracteres de una sección renderizada: texto normalizado + puntero
// (nodo, offset crudo) por carácter. Misma técnica del resaltado por carácter
// del PDF. La sección puede estar FRAGMENTADA en varias hojas (varios
// <section data-spine-idx="N">): se concatena en orden de documento, con lo
// que el texto resultante sigue siendo idéntico a sections[N].text.
// ---------------------------------------------------------------------------
interface CharMapEntry { node: Text; offset: number }

function buildCharMapFromEls(els: HTMLElement[]): { text: string; map: CharMapEntry[] } {
  let text = '';
  const map: CharMapEntry[] = [];
  let prevSpace = true;
  for (const el of els) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let tn: Text | null;
    while ((tn = walker.nextNode() as Text | null)) {
      const raw = tn.textContent || '';
      for (let i = 0; i < raw.length; i++) {
        const ch = raw[i].normalize('NFKC');
        if (/\s/.test(ch)) {
          if (!prevSpace) {
            text += ' ';
            map.push({ node: tn, offset: i });
            prevSpace = true;
          }
        } else {
          text += ch;
          map.push({ node: tn, offset: i });
          prevSpace = false;
        }
      }
    }
  }
  if (text.endsWith(' ')) { text = text.slice(0, -1); map.pop(); }
  return { text, map };
}

// Envuelve el rango [from, to) del charMap en <mark>s (uno por tramo contiguo
// dentro de un mismo nodo de texto — surroundContents no cruza elementos).
function wrapMarks(map: CharMapEntry[], from: number, to: number, colorHex: string, persistent: boolean): HTMLElement | null {
  const runs: { node: Text; a: number; b: number }[] = [];
  for (let k = from; k < to && k < map.length; k++) {
    const e = map[k];
    const last = runs[runs.length - 1];
    if (last && last.node === e.node && e.offset >= last.b) last.b = e.offset;
    else runs.push({ node: e.node, a: e.offset, b: e.offset });
  }
  let firstMark: HTMLElement | null = null;
  // De atrás hacia adelante: envolver un run parte el nodo de texto, lo que
  // invalidaría los offsets de los runs SIGUIENTES del mismo nodo si se
  // fuera hacia adelante.
  for (let i = runs.length - 1; i >= 0; i--) {
    const run = runs[i];
    try {
      const range = document.createRange();
      range.setStart(run.node, Math.min(run.a, run.node.length));
      range.setEnd(run.node, Math.min(run.b + 1, run.node.length));
      const mark = document.createElement('mark');
      mark.className = HL_CLASS;
      if (persistent) mark.dataset.persistent = 'true';
      mark.style.backgroundColor = colorHex + '66'; // ~40% alpha
      mark.style.borderRadius = '3px';
      mark.style.boxDecorationBreak = 'clone';
      (mark.style as any).webkitBoxDecorationBreak = 'clone';
      range.surroundContents(mark);
      firstMark = mark;
    } catch { /* nodo mutado entre cálculo y envoltura: tramo omitido */ }
  }
  return firstMark;
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------
export const EpubHtmlReader = forwardRef<EpubReaderHandle, EpubHtmlReaderProps>(function EpubHtmlReader(
  { url, onReady, onRelocate, onContentTap, onParseError, onLayoutReady, controlsVisible = true, hideOwnBar = false, mergedBarPortalTarget = null },
  ref,
) {
  const [sections, setSections] = useState<SectionData[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [layoutReady, setLayoutReady] = useState(false);
  const [manuallyHidden, setManuallyHidden] = useState(false);
  const [page, setPage] = useState({ current: 1, total: 1 });
  // Modo de lectura: 'v' hojas-tarjeta con scroll vertical (aspecto PDF);
  // 'h' hojas del tamaño del viewport deslizables al costado (snap nativo).
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    try { return window.localStorage.getItem('epub-view-mode') === 'h' ? 'h' : 'v'; } catch { return 'v'; }
  });
  const viewModeRef = useRef<ViewMode>(viewMode);
  useEffect(() => { viewModeRef.current = viewMode; }, [viewMode]);
  const [toc, setToc] = useState<{ label: string; href: string; sub?: boolean }[]>([]);
  const [showToc, setShowToc] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const blobUrlsRef = useRef<string[]>([]);
  const spineHrefsRef = useRef<string[]>([]);
  const sectionsRef = useRef<SectionData[] | null>(null);
  useEffect(() => { sectionsRef.current = sections; }, [sections]);

  const totalPagesRef = useRef(1);           // total de páginas POR PALABRAS
  const pageTopsRef = useRef<number[]>([]);  // offsetTop de cada hoja vertical
  const sheetsRef = useRef<HTMLElement[]>([]); // hojas horizontales en orden
  // Tamaño del scroller con el que se construyó el layout vigente + timestamp
  // del último scroll. Sirven para IGNORAR el jitter de altura del viewport
  // móvil (la barra de URL de Chrome se oculta/muestra al deslizar y cambia
  // el 100dvh): sin esto, cada deslizamiento disparaba un rebuild completo
  // en pleno gesto → congelamiento y hojas cortadas tras varias páginas.
  const lastBuiltSizeRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
  const lastScrollTsRef = useRef(0);
  // Ref al callback de layout listo (evita recrear buildLayout en cada render
  // por una prop-arrow inline del padre).
  const onLayoutReadyRef = useRef(onLayoutReady);
  useEffect(() => { onLayoutReadyRef.current = onLayoutReady; }, [onLayoutReady]);

  // ----- Carga y extracción (una vez por libro) -----------------------------
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setSections(null);
    setLoadError(false);
    setLayoutReady(false);

    (async () => {
      try {
        // Resolución de URL: mismo esquema que el lector legacy.
        let actualUrl = url;
        if (url.startsWith('idb://')) {
          const file = await get(url);
          if (!file) throw new Error('Archivo no encontrado en IndexedDB');
          objectUrl = URL.createObjectURL(file as Blob);
          actualUrl = objectUrl;
        }
        const book: any = ePub(actualUrl, { openAs: 'epub' } as any);
        await book.ready;

        const spineItems: any[] = book.spine?.spineItems || [];
        if (spineItems.length === 0) throw new Error('EPUB sin spine');
        const out: SectionData[] = [];
        const hrefs: string[] = [];
        for (const section of spineItems) {
          if (cancelled) return;
          try {
            await section.load(book.load.bind(book));
            const body: HTMLElement | null = section.document?.body ?? null;
            const html = body ? await sanitizeSection(body, section.href || '', book, blobUrlsRef.current) : '';
            const text = normalize(body?.textContent || '').trim();
            out.push({ html, text, href: section.href || '', words: countWords(text) });
            hrefs.push(resolvePath(section.href || '', ''));
            section.unload();
          } catch {
            // Sección corrupta: hueco vacío, el resto del libro sigue vivo.
            out.push({ html: '', text: '', href: section.href || '', words: 0 });
            hrefs.push(section.href || '');
          }
        }

        // TOC plano (2 niveles bastan para navegar).
        try {
          const nav = await book.loaded.navigation;
          const flat: { label: string; href: string; sub?: boolean }[] = [];
          (nav?.toc || []).forEach((item: any) => {
            flat.push({ label: (item.label || '').trim(), href: item.href || '' });
            (item.subitems || []).forEach((si: any) =>
              flat.push({ label: (si.label || '').trim(), href: si.href || '', sub: true }));
          });
          if (!cancelled) setToc(flat);
        } catch { /* libro sin navegación */ }

        if (!cancelled) {
          spineHrefsRef.current = hrefs;
          setSections(out);
          onReady?.();
        }
      } catch (err) {
        console.error('[EpubHtmlReader] Fallo al parsear:', err);
        if (!cancelled) {
          setLoadError(true);
          onParseError?.(err);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      blobUrlsRef.current.forEach(u => URL.revokeObjectURL(u));
      blobUrlsRef.current = [];
    };
    // onReady/onParseError via refs implícitos: url es la única identidad real del libro.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  // ----- Utilidades DOM ------------------------------------------------------
  // Una sección puede estar fragmentada en varias hojas: TODOS sus fragmentos.
  const getSectionEls = (s: number): HTMLElement[] =>
    Array.from(contentRef.current?.querySelectorAll<HTMLElement>(`section[data-spine-idx="${s}"]`) || []);

  const sectionCharMap = (s: number) => buildCharMapFromEls(getSectionEls(s));

  const sectionIndexOfNode = (node: Node): number => {
    const sec = (node instanceof HTMLElement ? node : node.parentElement)?.closest('section[data-spine-idx]');
    return sec ? Number((sec as HTMLElement).dataset.spineIdx) : -1;
  };

  // Hoja horizontal activa = la alineada con el scroll (snap). El paso de
  // snap es ancho de hoja + separación entre hojas.
  const sheetStep = (scroller: HTMLElement) => Math.max(1, scroller.clientWidth) + SHEET_GAP;
  const activeSheetIndex = (): number => {
    const scroller = scrollRef.current;
    if (!scroller || sheetsRef.current.length === 0) return 0;
    return Math.max(0, Math.min(sheetsRef.current.length - 1, Math.round(scroller.scrollLeft / sheetStep(scroller))));
  };

  const BLOCK_SEL = 'p, h1, h2, h3, h4, h5, h6, li, blockquote, pre';

  // Primer bloque visible. Vertical: por rects. Horizontal: primer bloque de
  // la hoja activa (con sticky las hojas anteriores quedan apiladas debajo,
  // los rects NO distinguen — el índice de hoja sí).
  const firstVisibleBlock = (): HTMLElement | null => {
    const scroller = scrollRef.current;
    const content = contentRef.current;
    if (!scroller || !content) return null;
    if (viewModeRef.current === 'h') {
      const sheet = sheetsRef.current[activeSheetIndex()];
      if (!sheet) return null;
      const blocks = sheet.querySelectorAll<HTMLElement>(BLOCK_SEL);
      for (const el of Array.from(blocks)) {
        if ((el.textContent || '').trim().length > 0) return el;
      }
      return null;
    }
    const sr = scroller.getBoundingClientRect();
    const blocks = content.querySelectorAll<HTMLElement>(BLOCK_SEL);
    for (const el of Array.from(blocks)) {
      const r = el.getBoundingClientRect();
      if (r.height > 0 && r.bottom > sr.top + 1 && (el.textContent || '').trim().length > 0) return el;
    }
    return null;
  };

  // ----- Contrato: texto -----------------------------------------------------
  const getVisibleText = useCallback((): string => {
    const scroller = scrollRef.current;
    const content = contentRef.current;
    if (!scroller || !content) return '';
    const parts: string[] = [];
    const pushBlock = (el: HTMLElement) => {
      // Bloques anidados (li>p, blockquote>p): contar solo el más interno
      // para que el TTS no lea el mismo texto dos veces.
      if (el.querySelector(BLOCK_SEL)) return;
      const t = normalize(el.textContent || '').trim();
      if (t) parts.push(t);
    };
    if (viewModeRef.current === 'h') {
      // La hoja activa ES la página visible (exacta: el corte es geométrico).
      const sheet = sheetsRef.current[activeSheetIndex()];
      sheet?.querySelectorAll<HTMLElement>(BLOCK_SEL).forEach(pushBlock);
      return parts.join('\n');
    }
    const rect = scroller.getBoundingClientRect();
    content.querySelectorAll<HTMLElement>(BLOCK_SEL).forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.bottom > rect.top && r.top < rect.bottom && r.height > 0) pushBlock(el);
    });
    return parts.join('\n');
  }, []);

  const getFullText = useCallback((): string =>
    (sectionsRef.current || []).map(s => s.text).join('\n'), []);

  const getCurrentAnchor = useCallback((): EpubAnchor | null => {
    const block = firstVisibleBlock();
    if (!block) return null;
    const s = sectionIndexOfNode(block);
    if (s < 0) return null;
    // Primer carácter del mapa cuyo nodo cae DENTRO del bloque (no se exige
    // que sea su primer nodo de texto: si ese nodo es whitespace "absorbido"
    // no aparece en el mapa y la coincidencia exacta fallaría).
    const { map } = sectionCharMap(s);
    const idx = map.findIndex(e => block.contains(e.node));
    return { s, o: Math.max(0, idx) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Navega hasta un nodo destino según el modo: en horizontal, a la hoja que
  // lo contiene (scroll determinístico, compatible con sticky+snap); en
  // vertical, scrollIntoView estándar.
  const revealNode = useCallback((node: Node, center: boolean) => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const el = node instanceof HTMLElement ? node : node.parentElement;
    if (!el) return;
    if (viewModeRef.current === 'h') {
      const sheet = el.closest(`.${SHEET_CLASS}`) as HTMLElement | null;
      if (!sheet) return;
      const idx = sheetsRef.current.indexOf(sheet);
      if (idx >= 0) scroller.scrollTo({ left: idx * sheetStep(scroller), behavior: 'auto' });
      return;
    }
    el.scrollIntoView({ block: center ? 'center' : 'start' });
  }, []);

  const goToAnchor = useCallback((a: EpubAnchor, center = false): void => {
    const els = getSectionEls(a.s);
    if (els.length === 0) return;
    const { map } = buildCharMapFromEls(els);
    const entry = map[Math.min(a.o, Math.max(0, map.length - 1))];
    if (!entry) { revealNode(els[0], false); return; }
    if (viewModeRef.current === 'h') { revealNode(entry.node, center); return; }
    try {
      const range = document.createRange();
      range.setStart(entry.node, Math.min(entry.offset, entry.node.length));
      range.collapse(true);
      const span = document.createElement('span');
      range.insertNode(span);
      span.scrollIntoView({ block: center ? 'center' : 'start' });
      const parent = span.parentNode;
      parent?.removeChild(span);
      parent?.normalize();
    } catch {
      revealNode(entry.node, center);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealNode]);

  // Busca `text` en todo el libro: primero elige sección por texto plano
  // (barato), luego construye el charMap SOLO de esa sección.
  const findInBook = useCallback((text: string): { map: CharMapEntry[]; from: number; len: number } | null => {
    const clean = normalize(text).trim().toLowerCase();
    if (clean.length < 3 || !sectionsRef.current) return null;
    for (let s = 0; s < sectionsRef.current.length; s++) {
      if (!sectionsRef.current[s].text.toLowerCase().includes(clean)) continue;
      const els = getSectionEls(s);
      if (els.length === 0) continue;
      const { text: secText, map } = buildCharMapFromEls(els);
      const idx = secText.toLowerCase().indexOf(clean);
      if (idx >= 0) return { map, from: idx, len: clean.length };
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const goToText = useCallback((text: string, center = true): boolean => {
    const found = findInBook(text);
    if (!found) return false;
    const entry = found.map[found.from];
    if (viewModeRef.current === 'h') { revealNode(entry.node, center); return true; }
    try {
      const range = document.createRange();
      range.setStart(entry.node, Math.min(entry.offset, entry.node.length));
      range.collapse(true);
      const span = document.createElement('span');
      range.insertNode(span);
      span.scrollIntoView({ block: center ? 'center' : 'start' });
      const parent = span.parentNode;
      parent?.removeChild(span);
      parent?.normalize();
      return true;
    } catch {
      revealNode(entry.node, center);
      return true;
    }
  }, [findInBook, revealNode]);

  const clearHighlights = useCallback((includePersistent: boolean): void => {
    const content = contentRef.current;
    if (!content) return;
    const selector = includePersistent ? `mark.${HL_CLASS}` : `mark.${HL_CLASS}:not([data-persistent])`;
    content.querySelectorAll(selector).forEach(mark => {
      const parent = mark.parentNode;
      if (!parent) return;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      parent.removeChild(mark);
      parent.normalize();
    });
  }, []);

  const highlightText = useCallback((text: string, colorHex: string, persistent: boolean, scroll = true): boolean => {
    // El resaltado del TTS (no persistente) reemplaza al anterior.
    if (!persistent) clearHighlights(false);
    if (!text || normalize(text).trim().length < 3) return true; // limpiar era el objetivo
    const found = findInBook(text);
    if (!found) return false;
    const firstMark = wrapMarks(found.map, found.from, found.from + found.len, colorHex, persistent);
    if (firstMark && scroll) {
      if (viewModeRef.current === 'h') revealNode(firstMark, true);
      else firstMark.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    return !!firstMark;
  }, [clearHighlights, findInBook, revealNode]);

  // Texto que sigue al último resaltado TTS (o, si no hay, al ancla visible).
  // Trabaja SOLO sobre sections[].text (strings puros): el punto de partida
  // es el fin del último <mark> no persistente — la última frase que el
  // audiolibro realmente leyó — así el avance automático nunca repite ni se
  // salta texto, aunque un párrafo ocupe varias pantallas.
  const getContinuationText = useCallback((maxWords: number): string => {
    const secs = sectionsRef.current;
    if (!secs || secs.length === 0) return '';
    let s = -1, o = -1;
    const marks = contentRef.current?.querySelectorAll<HTMLElement>(`mark.${HL_CLASS}:not([data-persistent])`);
    const lastMark = marks && marks.length > 0 ? marks[marks.length - 1] : null;
    if (lastMark) {
      const ms = sectionIndexOfNode(lastMark);
      if (ms >= 0) {
        const { map } = sectionCharMap(ms);
        for (let k = map.length - 1; k >= 0; k--) {
          if (lastMark.contains(map[k].node)) { s = ms; o = k + 1; break; }
        }
      }
    }
    if (s < 0 || o < 0) {
      const a = getCurrentAnchor();
      if (!a) return '';
      s = a.s; o = a.o;
    }
    // Juntar texto desde (s, o) hacia adelante hasta cubrir maxWords…
    let raw = secs[s] ? secs[s].text.slice(o) : '';
    for (let si = s + 1; si < secs.length && countWords(raw) < maxWords + 80; si++) {
      raw += (raw ? ' ' : '') + secs[si].text;
    }
    const words = raw.trim() ? raw.trim().split(/\s+/) : [];
    if (words.length <= maxWords) return words.join(' ');
    // …y extender hasta cerrar la oración en curso (tope +80 palabras) para
    // no cortar una frase a la mitad entre lote y lote.
    let end = maxWords;
    const limit = Math.min(words.length, maxWords + 80);
    const endsSentence = (w: string) => /[.!?…]["»”')\]]*$/.test(w);
    while (end < limit && !endsSentence(words[end - 1])) end++;
    return words.slice(0, end).join(' ');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getCurrentAnchor]);

  // ----- Construcción del layout (imperativa, fuera de React) ----------------
  // React solo posee el contenedor #epub-html-content; el interior lo
  // construimos nosotros — así cada página puede ser una CAJA real aunque
  // cruce límites de capítulo (una hoja puede contener el final de una
  // sección y el principio de la siguiente, como un libro de verdad).

  interface CutPoint { node?: Text; offset?: number; beforeBlock?: Element }

  // Cortes por PALABRAS (modo vertical): posición de la palabra k*300.
  const collectWordCuts = (flatSections: HTMLElement[]): CutPoint[] => {
    const cuts: CutPoint[] = [];
    let wordsAcc = 0;
    let nextBoundary = WORDS_PER_PAGE;
    for (const sectionEl of flatSections) {
      const walker = document.createTreeWalker(sectionEl, NodeFilter.SHOW_TEXT);
      let prevSpace = true;
      let tn: Text | null;
      while ((tn = walker.nextNode() as Text | null)) {
        const raw = tn.textContent || '';
        for (let i = 0; i < raw.length; i++) {
          const isSpace = /\s/.test(raw[i]);
          if (!isSpace && prevSpace) {
            if (wordsAcc === nextBoundary) {
              cuts.push({ node: tn, offset: i });
              nextBoundary += WORDS_PER_PAGE;
            }
            wordsAcc++;
          }
          prevSpace = isSpace;
        }
      }
      prevSpace = true;
    }
    return cuts;
  };

  // Cortes GEOMÉTRICOS (modo horizontal): línea a línea, la hoja es el
  // límite — nada puede desbordar. Requiere que flatSections estén en el
  // flujo con el ancho de texto FINAL de la hoja (se mide sin mutar nada).
  const collectGeometricCuts = (flatSections: HTMLElement[], usableH: number): CutPoint[] => {
    const content = contentRef.current!;
    const cTop = content.getBoundingClientRect().top;
    const cuts: CutPoint[] = [];
    let pageStart = 0;
    // El rect de un carácter mide la caja del glifo, que puede ser MENOR que
    // la caja de línea (line-height 1.7): usar solo rect.bottom subestimaba
    // el fondo real de la línea y la última línea quedaba cortada en algunas
    // hojas. El fondo real de una línea = su top + line-height computado.
    const lineHeightOf = (block: Element): number => {
      const lh = parseFloat(window.getComputedStyle(block).lineHeight);
      return Number.isFinite(lh) && lh > 0 ? lh : 28;
    };

    // Inicios de palabra de un bloque: [{node, offset}] en orden.
    const wordStarts = (block: Element): { node: Text; offset: number }[] => {
      const outArr: { node: Text; offset: number }[] = [];
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      let prevSpace = true;
      let tn: Text | null;
      while ((tn = walker.nextNode() as Text | null)) {
        const raw = tn.textContent || '';
        for (let i = 0; i < raw.length; i++) {
          const isSpace = /\s/.test(raw[i]);
          if (!isSpace && prevSpace) outArr.push({ node: tn, offset: i });
          prevSpace = isSpace;
        }
      }
      return outArr;
    };
    // Rect del primer carácter de una palabra (rango de 1 char: fiable).
    const wordRect = (w: { node: Text; offset: number }): DOMRect | null => {
      try {
        const r = document.createRange();
        r.setStart(w.node, Math.min(w.offset, w.node.length));
        r.setEnd(w.node, Math.min(w.offset + 1, w.node.length));
        const rect = r.getBoundingClientRect();
        return rect.height > 0 ? rect : null;
      } catch { return null; }
    };

    for (const sectionEl of flatSections) {
      for (const block of Array.from(sectionEl.children)) {
        const br = block.getBoundingClientRect();
        if (br.height <= 0) continue;
        let bTop = br.top - cTop;
        const bBottom = br.bottom - cTop;
        if (bBottom - pageStart <= usableH) continue; // el bloque cabe entero

        // El bloque excede la hoja actual: puede necesitar varios cortes.
        const lh = lineHeightOf(block);
        // Fondo real de la línea de una palabra (glifo O caja de línea, el
        // que sea mayor), relativo al flujo.
        const lineBottom = (r: DOMRect) => Math.max(r.bottom, r.top + lh) - cTop;
        let guard = 0;
        let done = false;
        while (!done && guard++ < 400) {
          const target = pageStart + usableH - SHEET_SAFETY;
          if (bBottom <= target) break; // el resto ya cabe
          const ws = wordStarts(block);
          if (ws.length === 0) {
            // Monolítico (imagen/figura): hoja nueva para él; si aun así no
            // cabe, el CSS (max-height + overflow hidden) lo contiene.
            if (bTop > pageStart + 1) { cuts.push({ beforeBlock: block }); pageStart = bTop; }
            break;
          }
          // ¿Cabe al menos la primera palabra en la hoja actual?
          const firstR = wordRect(ws[0]);
          if (firstR && lineBottom(firstR) > target) {
            // Ni la primera línea entra: hoja nueva desde el bloque.
            if (bTop > pageStart + 1) { cuts.push({ beforeBlock: block }); pageStart = bTop; continue; }
            break; // hoja ya vacía y no cabe: se recorta por CSS (caso extremo)
          }
          // Binaria: primera palabra cuya línea NO cabe en la hoja actual.
          let lo = 0, hi = ws.length - 1, firstOut = -1;
          while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            const r = wordRect(ws[mid]);
            if (!r) { lo = mid + 1; continue; }
            if (lineBottom(r) > target) { firstOut = mid; hi = mid - 1; }
            else lo = mid + 1;
          }
          if (firstOut <= 0) break; // todo cabe (o caso degenerado)
          const cutWord = ws[firstOut];
          cuts.push({ node: cutWord.node, offset: cutWord.offset });
          const r = wordRect(cutWord);
          pageStart = r ? r.top - cTop : target;
          bTop = pageStart;
          done = bBottom - pageStart <= usableH - SHEET_SAFETY;
        }
      }
    }
    return cuts;
  };

  // Aplica los cortes: marca con PGSTART_CLASS el bloque que INICIA cada
  // página, partiendo bloques con Range.extractContents cuando el corte cae
  // a mitad (clona los ancestros parciales, como un paginador real). De
  // ATRÁS hacia adelante: partir un nodo no invalida los cortes anteriores.
  const applyCuts = (cuts: CutPoint[]) => {
    for (let k = cuts.length - 1; k >= 0; k--) {
      const cut = cuts[k];
      if (cut.beforeBlock) {
        cut.beforeBlock.classList.add(PGSTART_CLASS);
        continue;
      }
      const node = cut.node!;
      const offset = cut.offset!;
      const sectionEl = node.parentElement?.closest('section[data-spine-idx]');
      if (!sectionEl) continue;
      let topBlock: Node = node;
      while (topBlock.parentNode && topBlock.parentNode !== sectionEl) topBlock = topBlock.parentNode;
      try {
        const pre = document.createRange();
        pre.setStart(topBlock, 0);
        pre.setEnd(node, offset);
        if (pre.toString().trim().length === 0) {
          // Corte justo al inicio del bloque: no hay nada que partir.
          if (topBlock instanceof Element) topBlock.classList.add(PGSTART_CLASS);
          continue;
        }
        const r = document.createRange();
        r.setStart(node, offset);
        r.setEndAfter(topBlock);
        const frag = r.extractContents();
        const first = frag.firstElementChild;
        if (first) { first.classList.add(PGSTART_CLASS, CONT_CLASS); }
        (topBlock as ChildNode).after(frag);
      } catch { /* estructura hostil: corte omitido (la hoja sale más larga, nada se pierde) */ }
    }
  };

  // Reparte el contenido (ya cortado) en hojas reales. Cada hoja recibe
  // FRAGMENTOS de sección (<section data-spine-idx>) para que las anclas
  // {s,o} sigan funcionando: el charmap concatena los fragmentos en orden.
  const distributePages = (flatSections: HTMLElement[], mode: ViewMode, sheetW: number, sheetH: number) => {
    const content = contentRef.current!;
    const pages: HTMLElement[] = [];
    let curPage: HTMLElement | null = null;
    let curFrag: HTMLElement | null = null;
    let pageHasContent = false;
    let wordsAcc = 0;

    const openPage = () => {
      const div = document.createElement('div');
      if (mode === 'v') {
        div.className = PAGE_CLASS;
        div.dataset.page = String(pages.length + 1);
      } else {
        div.className = SHEET_CLASS;
        div.style.width = `${sheetW}px`;
        // Alto = 100% del scroller (NO un valor fijo en px): así el jitter de
        // altura del viewport móvil (barra de URL) NO recorta la hoja ni exige
        // reconstruir. El corte geométrico se calculó para sheetH; si el
        // viewport queda más BAJO que en la construcción, a lo sumo la última
        // línea se recorta por overflow (cosmético, se auto-corrige); si queda
        // más alto, sobra un pequeño margen gris abajo.
        div.style.height = '100%';
        div.style.padding = `${SHEET_PAD_Y}px ${SHEET_PAD_X}px`;
        // Nº de página POR PALABRAS a la que pertenece la primera palabra.
        div.dataset.page = String(Math.min(totalPagesRef.current, Math.floor(wordsAcc / WORDS_PER_PAGE) + 1));
      }
      content.appendChild(div);
      pages.push(div);
      curPage = div;
      curFrag = null;
      pageHasContent = false;
    };

    for (const flatSec of flatSections) {
      const sIdx = flatSec.dataset.spineIdx || '0';
      if (!curPage) openPage();
      const openFrag = () => {
        curFrag = document.createElement('section');
        curFrag.dataset.spineIdx = sIdx;
        curPage!.appendChild(curFrag);
      };
      openFrag();
      const nodes = Array.from(flatSec.childNodes);
      for (const node of nodes) {
        if (node instanceof Element && node.classList.contains(PGSTART_CLASS)) {
          node.classList.remove(PGSTART_CLASS);
          if (pageHasContent) { openPage(); openFrag(); }
        }
        curFrag!.appendChild(node);
        if (node.textContent && node.textContent.trim()) {
          pageHasContent = true;
          wordsAcc += countWords(node.textContent);
        }
      }
      flatSec.remove();
    }
    if (pages.length === 0) openPage();
    return pages;
  };

  // Mide el offsetTop de cada hoja vertical (para el contador y pageBy).
  const measurePageTops = useCallback(() => {
    const scroller = scrollRef.current;
    const content = contentRef.current;
    if (!scroller || !content || viewModeRef.current !== 'v') return;
    const st = scroller.getBoundingClientRect().top;
    const tops: number[] = [];
    content.querySelectorAll<HTMLElement>(`.${PAGE_CLASS}`).forEach(p => {
      tops.push(Math.max(0, p.getBoundingClientRect().top - st + scroller.scrollTop));
    });
    pageTopsRef.current = tops;
  }, []);

  // Página actual según el modo (barata: se llama en cada frame de scroll).
  const updateCurrentPage = useCallback(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    let current = 1;
    if (viewModeRef.current === 'h') {
      const sheet = sheetsRef.current[activeSheetIndex()];
      current = sheet ? Number(sheet.dataset.page) || 1 : 1;
    } else {
      const refY = scroller.scrollTop + scroller.clientHeight * 0.35;
      const tops = pageTopsRef.current;
      let lo = 0, hi = tops.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (tops[mid] <= refY) lo = mid + 1; else hi = mid; }
      current = Math.max(1, Math.min(totalPagesRef.current, lo));
    }
    setPage(prev => (prev.current === current && prev.total === totalPagesRef.current) ? prev : { current, total: totalPagesRef.current });
  }, []);

  // Construye TODO el layout del modo actual. Se llama al cargar, al cambiar
  // de modo y (solo horizontal) al cambiar el tamaño del contenedor.
  const buildLayout = useCallback(() => {
    const scroller = scrollRef.current;
    const content = contentRef.current;
    const secs = sectionsRef.current;
    if (!scroller || !content || !secs) return;
    const mode = viewModeRef.current;

    totalPagesRef.current = Math.max(1, Math.ceil(secs.reduce((a, s) => a + s.words, 0) / WORDS_PER_PAGE));

    // 1) Contenido plano: una <section> por ítem del spine, en el flujo.
    content.innerHTML = '';
    content.className = mode === 'v' ? '__vmode' : '__hmode-measure';
    content.style.cssText = '';
    const flat: HTMLElement[] = [];
    const sheetW = Math.max(160, scroller.clientWidth);
    const sheetH = Math.max(160, scroller.clientHeight);
    if (mode === 'h') {
      // Para medir los cortes geométricos, el texto debe fluir con el ancho
      // EXACTO que tendrá dentro de la hoja.
      content.style.width = `${sheetW - 2 * SHEET_PAD_X}px`;
    }
    for (let s = 0; s < secs.length; s++) {
      const el = document.createElement('section');
      el.dataset.spineIdx = String(s);
      el.innerHTML = secs[s].html;
      content.appendChild(el);
      flat.push(el);
    }
    // Colisiones con clases del libro (improbable pero barato de prevenir).
    content.querySelectorAll(`.${PGSTART_CLASS}`).forEach(e => e.classList.remove(PGSTART_CLASS));

    // 2) Cortes → 3) splits → 4) reparto en hojas.
    const usableH = sheetH - 2 * SHEET_PAD_Y;
    const cuts = mode === 'v' ? collectWordCuts(flat) : collectGeometricCuts(flat, usableH);
    applyCuts(cuts);
    const pages = distributePages(flat, mode, sheetW, sheetH);
    content.className = mode === 'v' ? '__vmode' : '__hmode';
    if (mode === 'h') content.style.width = '';

    if (mode === 'h') {
      sheetsRef.current = pages;
    } else {
      sheetsRef.current = [];
      measurePageTops();
    }
    setPage(prev => (prev.total === totalPagesRef.current ? prev : { current: Math.min(prev.current, totalPagesRef.current), total: totalPagesRef.current }));
    updateCurrentPage();
    // Tamaño con el que quedó construido: referencia para descartar los
    // resizes espurios de la barra de URL móvil (ver ResizeObserver).
    lastBuiltSizeRef.current = { w: scroller.clientWidth, h: scroller.clientHeight };
    // Layout reconstruido (innerHTML nuevo, marks borrados): avisar al padre
    // para que repinte las citas guardadas. Tras un frame, con el DOM ya
    // pintado, para que los rects del modo horizontal sean válidos.
    requestAnimationFrame(() => onLayoutReadyRef.current?.());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measurePageTops, updateCurrentPage]);

  // Construir al cargar el libro y al cambiar de modo (doble rAF: layout
  // estable antes de medir). Restaura el ancla pendiente del cambio de modo.
  const pendingModeAnchorRef = useRef<EpubAnchor | null>(null);
  useEffect(() => {
    if (!sections) return;
    setLayoutReady(false);
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => {
      buildLayout();
      setLayoutReady(true);
      const a = pendingModeAnchorRef.current;
      pendingModeAnchorRef.current = null;
      if (a) goToAnchor(a);
    }));
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sections, viewMode]);

  // ----- Contrato: navegación de páginas --------------------------------------
  const pageBy = useCallback((delta: number): void => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    if (viewModeRef.current === 'h') {
      const target = Math.max(0, Math.min(sheetsRef.current.length - 1, activeSheetIndex() + delta));
      scroller.scrollTo({ left: target * sheetStep(scroller), behavior: 'auto' });
      return;
    }
    const tops = pageTopsRef.current;
    const refY = scroller.scrollTop + scroller.clientHeight * 0.35;
    let lo = 0, hi = tops.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (tops[mid] <= refY) lo = mid + 1; else hi = mid; }
    const currentIdx = Math.max(0, lo - 1);
    const target = Math.max(0, Math.min(tops.length - 1, currentIdx + delta));
    scroller.scrollTo({ top: tops[target] ?? 0, behavior: 'auto' });
  }, []);

  // Avance de LECTURA manual del TTS. Vertical: casi un viewport con leve
  // solapamiento. Horizontal: una hoja exacta (las hojas no comparten texto).
  const scrollByViewport = useCallback((delta: number): void => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    if (viewModeRef.current === 'h') { pageBy(delta); return; }
    scroller.scrollBy({ top: delta * scroller.clientHeight * 0.92, behavior: 'auto' });
  }, [pageBy]);

  // Alternar vertical ⇄ horizontal conservando la posición de lectura.
  const toggleViewMode = useCallback(() => {
    const anchor = getCurrentAnchor();
    const next: ViewMode = viewModeRef.current === 'v' ? 'h' : 'v';
    try { window.localStorage.setItem('epub-view-mode', next); } catch { /* modo privado */ }
    pendingModeAnchorRef.current = anchor;
    setViewMode(next); // el efecto [viewMode] reconstruye y restaura el ancla
  }, [getCurrentAnchor]);

  useImperativeHandle(ref, (): EpubReaderHandle => ({
    getVisibleText,
    getFullText,
    getCurrentAnchor,
    goToAnchor,
    goToText,
    highlightText,
    clearHighlights,
    pageBy,
    scrollByViewport,
    getContinuationText,
  }), [getVisibleText, getFullText, getCurrentAnchor, goToAnchor, goToText, highlightText, clearHighlights, pageBy, scrollByViewport, getContinuationText]);

  // ----- Scroll → página actual + onRelocate ---------------------------------
  const relocateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || !sections) return;
    let raf = 0;
    const onScroll = () => {
      lastScrollTsRef.current = Date.now();
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        updateCurrentPage();
        if (relocateTimerRef.current) clearTimeout(relocateTimerRef.current);
        relocateTimerRef.current = setTimeout(() => {
          onRelocate?.(getCurrentAnchor(), { current: pageNow(), total: totalPagesRef.current });
        }, 500);
      });
    };
    const pageNow = (): number => {
      if (viewModeRef.current === 'h') {
        const sheet = sheetsRef.current[activeSheetIndex()];
        return sheet ? Number(sheet.dataset.page) || 1 : 1;
      }
      const s = scrollRef.current;
      if (!s) return 1;
      const refY = s.scrollTop + s.clientHeight * 0.35;
      const tops = pageTopsRef.current;
      let lo = 0, hi = tops.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (tops[mid] <= refY) lo = mid + 1; else hi = mid; }
      return Math.max(1, Math.min(totalPagesRef.current, lo));
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      scroller.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
      if (relocateTimerRef.current) clearTimeout(relocateTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sections, updateCurrentPage]);

  // ----- Re-anclaje al redimensionar (abrir TTS/notas, rotación) -------------
  // Blindado contra el jitter del viewport móvil: en Android Chrome, la barra
  // de URL se oculta/muestra al deslizar y cambia el 100dvh del contenedor,
  // disparando este observer decenas de veces por sesión de scroll. Sin
  // filtro, cada disparo hacía un buildLayout() COMPLETO (re-medición
  // geométrica de todo el libro) en pleno gesto → congelamiento, frames rotos
  // y hojas cortadas tras varias páginas. Reglas: (1) ignorar cambios <2px;
  // (2) nunca reconstruir con el dedo en movimiento; (3) si el tamaño volvió
  // al de construcción (la barra reapareció), cero trabajo.
  const pendingAnchorRef = useRef<EpubAnchor | null>(null);
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || !sections) return;
    let initialFire = true;

    const attemptReflow = () => {
      const sc = scrollRef.current;
      if (!sc) return;
      // Gesto en curso: re-esperar (nunca reconstruir con el dedo moviéndose).
      if (Date.now() - lastScrollTsRef.current < 300) {
        resizeTimerRef.current = setTimeout(attemptReflow, 200);
        return;
      }
      resizeTimerRef.current = null;
      const built = lastBuiltSizeRef.current;
      // Solo el ANCHO obliga a rehacer geometría (rotación, o panel de notas
      // que angosta el lector). El alto ya lo absorbe la hoja height:100% +
      // overflow, así que el jitter de la barra de URL móvil NO llega aquí a
      // reconstruir nada. Si el ancho volvió a su valor, no hay trabajo.
      if (Math.abs(sc.clientWidth - built.w) < 2) {
        pendingAnchorRef.current = null;
        return;
      }
      const a = pendingAnchorRef.current;
      pendingAnchorRef.current = null;
      if (viewModeRef.current === 'h') buildLayout();
      else measurePageTops();
      if (a) goToAnchor(a);
      updateCurrentPage();
    };

    const observer = new ResizeObserver(() => {
      // El primer callback (al empezar a observar) es espurio: ignorarlo para
      // no pisar la restauración del marcador guardado.
      if (initialFire) { initialFire = false; return; }
      const sc = scrollRef.current;
      if (!sc) return;
      const built = lastBuiltSizeRef.current;
      // Solo reaccionar a cambios de ANCHO. El alto (barra de URL, controles
      // fullscreen) se ignora por completo: la hoja height:100% se adapta sola
      // sin reconstruir. Esto elimina el rebuild-en-pleno-gesto que congelaba.
      if (Math.abs(sc.clientWidth - built.w) < 2) {
        if (resizeTimerRef.current) { clearTimeout(resizeTimerRef.current); resizeTimerRef.current = null; }
        pendingAnchorRef.current = null;
        return;
      }
      // Ancla capturada ANTES de tocar el layout (una vez por ráfaga).
      if (!pendingAnchorRef.current) pendingAnchorRef.current = getCurrentAnchor();
      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current);
      resizeTimerRef.current = setTimeout(attemptReflow, 350);
    });
    observer.observe(scroller);
    return () => {
      observer.disconnect();
      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sections]);

  // ----- Clicks: enlaces internos + DOBLE tap para controles -----------------
  const lastTapRef = useRef(0);
  const handleContentClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const link = target.closest('a[data-internal-href]') as HTMLElement | null;
    if (link) {
      e.preventDefault();
      const dest = link.getAttribute('data-internal-href') || '';
      const hash = link.getAttribute('data-internal-hash') || '';
      const s = spineHrefsRef.current.findIndex(h => h === dest || h.endsWith('/' + dest) || dest.endsWith('/' + h));
      if (s >= 0) {
        if (hash) {
          for (const secEl of getSectionEls(s)) {
            const el = secEl.querySelector(`[id="${CSS.escape(hash)}"]`);
            if (el) { revealNode(el, false); if (viewModeRef.current === 'v') el.scrollIntoView({ block: 'start' }); return; }
          }
        }
        goToAnchor({ s, o: 0 });
      }
      return;
    }
    // DOBLE tap (sin selección activa) → alternar controles en fullscreen.
    // Un tap simple no hace nada: leyendo se toca la pantalla sin querer, y
    // además ReaderView ya no alterna por nosotros (ver handleScreenClick).
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) { lastTapRef.current = 0; return; }
    const now = Date.now();
    if (now - lastTapRef.current < 350) {
      lastTapRef.current = 0;
      onContentTap?.();
    } else {
      lastTapRef.current = now;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goToAnchor, onContentTap, revealNode]);

  // ----- Barra propia --------------------------------------------------------
  const barTouchStartYRef = useRef<number | null>(null);

  const renderBarControls = () => (
    <>
      <button
        onClick={() => setShowToc(v => !v)}
        className={cn('p-2 rounded-full text-[var(--text-muted)] hover:text-[var(--primary)] hover:bg-[var(--primary)]/10 transition-all', showToc && 'text-[var(--primary)] bg-[var(--primary)]/10')}
        title="Índice"
      >
        <List className="w-5 h-5" />
      </button>
      <div className="w-px h-4 bg-[var(--border-card)] hidden sm:block" />
      <span className="text-xs font-mono font-semibold tabular-nums text-[var(--text-muted)] px-1 min-w-[78px] text-center shrink-0 inline-flex items-center justify-center" title="Página (fija por palabras: no cambia con la pantalla)">
        {sections && layoutReady ? <>{page.current} / {page.total}</> : <Loader2 className="w-3.5 h-3.5 animate-spin" />}
      </span>
      <div className="w-px h-4 bg-[var(--border-card)] hidden sm:block" />
      {/* Alternar lectura vertical (hojas apiladas, aspecto PDF) ⇄ horizontal
          (hojas del tamaño de la pantalla deslizables al costado). */}
      <button
        onClick={toggleViewMode}
        className="p-2 rounded-full text-[var(--text-muted)] hover:text-[var(--primary)] hover:bg-[var(--primary)]/10 transition-all"
        title={viewMode === 'v' ? 'Pasar a páginas deslizables (horizontal)' : 'Pasar a scroll vertical'}
      >
        {viewMode === 'v' ? <GalleryHorizontal className="w-5 h-5" /> : <GalleryVertical className="w-5 h-5" />}
      </button>
    </>
  );

  return (
    // Fondo gris tipo visor de PDF: las hojas blancas flotan sobre él.
    <div className="h-full relative bg-[#e2e8f0] flex justify-center">
      <div className="w-full h-full max-w-5xl relative flex flex-col">
        {loadError ? (
          <div className="w-full max-w-[600px] h-[400px] mx-auto mt-20 bg-slate-50 border-2 border-dashed border-slate-300 rounded-lg flex flex-col items-center justify-center p-8 text-center text-slate-500 shadow-sm">
            <div className="w-16 h-16 mb-4 text-slate-300"><List className="w-full h-full" /></div>
            <p className="font-bold text-slate-700 mb-2">No se pudo procesar el documento EPUB</p>
            <p className="text-sm">Se intentará abrir con el lector clásico.</p>
          </div>
        ) : (
          <>
            {/* Estilos de lectura propios (los del libro se descartan al
                sanitizar): tipografía consistente en todos los libros. */}
            <style>{`
              #epub-html-content { font-family: Georgia, 'Times New Roman', serif; color: var(--text-main); line-height: 1.7;
                /* URLs y palabras kilométricas (notas al pie con enlaces) se
                   quiebran en vez de desbordar la hoja: sin esto, el scroller
                   vertical se volvía desplazable de costado y quedaba un
                   espacio gris gigante junto al texto. */
                overflow-wrap: anywhere; word-break: break-word; }
              #epub-html-content p { margin: 0 0 0.85em 0; text-align: justify; }
              #epub-html-content h1, #epub-html-content h2, #epub-html-content h3,
              #epub-html-content h4, #epub-html-content h5, #epub-html-content h6 {
                font-weight: 700; line-height: 1.3; margin: 1.3em 0 0.6em 0; text-align: left; }
              #epub-html-content h1 { font-size: 1.5em; } #epub-html-content h2 { font-size: 1.3em; }
              #epub-html-content h3 { font-size: 1.12em; }
              #epub-html-content img { max-width: 100%; height: auto; display: block; margin: 0.8em auto; }
              #epub-html-content blockquote { border-left: 3px solid var(--border-card); padding-left: 1em; margin: 1em 0; color: var(--text-muted); font-style: italic; }
              #epub-html-content a[data-internal-href] { color: var(--primary); text-decoration: underline; cursor: pointer; }
              #epub-html-content table { max-width: 100%; overflow-x: auto; display: block; }
              /* Mitad-continuación de un bloque partido por un corte de hoja:
                 arranca la hoja sin margen ni sangría (sigue la misma frase). */
              #epub-html-content .${CONT_CLASS} { margin-top: 0 !important; text-indent: 0 !important; }

              /* ---- VERTICAL: hojas-tarjeta sobre fondo gris (aspecto PDF) ---- */
              #epub-html-content.__vmode { display: block; padding: 14px 8px 26px; }
              .${PAGE_CLASS} { position: relative; background: #fff; max-width: 48rem;
                margin: 0 auto 16px; padding: 24px 1.15rem 32px; border-radius: 3px;
                overflow: hidden; /* nada del libro puede sobresalir de la hoja */
                box-shadow: 0 1px 2px rgba(15,23,42,.22), 0 5px 16px rgba(15,23,42,.13); }
              @media (min-width: 640px) { .${PAGE_CLASS} { padding: 30px 2.2rem 36px; } }
              .${PAGE_CLASS}::after { content: "pág. " attr(data-page); position: absolute;
                bottom: 8px; right: 12px; font-family: ui-monospace, monospace;
                font-size: 10px; color: #94a3b8; user-select: none; }

              /* ---- HORIZONTAL: hojas del tamaño del viewport, lado a lado ----
                 Cada hoja ES el snap target (elemento real de ancho completo:
                 el snap siempre asienta alineado) y snap-stop always fuerza
                 UNA hoja por gesto aunque el deslizamiento sea rápido.
                 overflow hidden = el contenedor visual es el límite. */
              #epub-html-content.__hmode { display: flex; height: 100%; width: max-content; gap: ${SHEET_GAP}px; }
              #epub-html-content.__hmode-measure { display: block; }
              .${SHEET_CLASS} { position: relative; flex: 0 0 auto; background: #fff;
                overflow: hidden; box-sizing: border-box;
                scroll-snap-align: start; scroll-snap-stop: always;
                box-shadow: 0 0 4px rgba(15,23,42,.25), 0 4px 14px rgba(15,23,42,.18); }
              .${SHEET_CLASS} section:first-child > :first-child { margin-top: 0 !important; }
              .${SHEET_CLASS}::after { content: "pág. " attr(data-page); position: absolute;
                bottom: 5px; right: 12px; font-family: ui-monospace, monospace;
                font-size: 10px; color: #cbd5e1; user-select: none; }
              .${SHEET_CLASS} img { max-height: 100%; object-fit: contain; }
            `}</style>

            {/* Scroll 100% NATIVO en ambos modos. Sin listeners táctiles.
                touch-action: manipulation elimina el zoom por doble tap (el
                doble tap es nuestro gesto de controles). */}
            <div
              ref={scrollRef}
              className={cn(
                'flex-1 min-h-0 relative',
                viewMode === 'v'
                  ? 'overflow-y-auto overflow-x-hidden'
                  : 'overflow-x-auto overflow-y-hidden snap-x snap-mandatory overscroll-x-contain bg-[#b6c2d2]'
              )}
              style={{ touchAction: 'manipulation' }}
              onClick={handleContentClick}
            >
              <div id="epub-html-content" ref={contentRef} />

              {(!sections || !layoutReady) && (
                <div className="absolute inset-0 z-20 bg-white/90 flex flex-col items-center justify-center gap-3">
                  <Loader2 className="w-9 h-9 animate-spin text-[var(--primary)]" />
                  <p className="text-sm font-medium text-[var(--text-muted)]">Preparando el libro…</p>
                </div>
              )}

              {/* Índice propio (z alto: por encima de la capa fullscreen z-100
                  del lector — lección del selector de voz enterrado). */}
              {showToc && (
                <div className="fixed inset-0 z-[10000] flex">
                  <div className="absolute inset-0 bg-black/30" onClick={() => setShowToc(false)} />
                  <div className="relative z-10 w-full max-w-xs h-full bg-white dark:bg-slate-900 border-r border-[var(--border-card)] shadow-2xl flex flex-col">
                    <div className="p-4 border-b border-[var(--border-card)] bg-slate-50 flex items-center justify-between shrink-0">
                      <h3 className="font-bold text-sm flex items-center gap-2 text-[var(--text-main)]"><List className="w-4 h-4" /> Índice</h3>
                      <button onClick={() => setShowToc(false)} className="p-2 text-[var(--text-muted)] hover:text-[var(--primary)]">
                        <ChevronLeft className="w-5 h-5" />
                      </button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-3 custom-scrollbar">
                      {toc.length === 0 && <p className="text-sm text-slate-400 text-center mt-4">Este libro no tiene índice.</p>}
                      {toc.map((item, i) => (
                        <button
                          key={i}
                          onClick={() => {
                            const dest = resolvePath((item.href || '').split('#')[0], '');
                            const s = spineHrefsRef.current.findIndex(h => h === dest || h.endsWith('/' + dest) || dest.endsWith('/' + h));
                            if (s >= 0) goToAnchor({ s, o: 0 });
                            setShowToc(false);
                          }}
                          className={cn('block w-full text-left text-sm text-slate-700 hover:text-[var(--primary)] py-2 px-1 rounded hover:bg-[var(--primary)]/5 transition-colors truncate', item.sub && 'pl-5 text-[13px]')}
                          title={item.label}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Franja inferior propia / portal fusionado con el widget TTS */}
            {!hideOwnBar && (
              <div className={cn(
                'shrink-0 w-full flex flex-col items-center bg-[var(--bg-card)] border-t border-[var(--border-card)] transition-all duration-300 overflow-hidden',
                (controlsVisible && !manuallyHidden) ? 'max-h-16' : 'max-h-[14px]'
              )}>
                <div
                  className="w-full flex justify-center py-1.5 cursor-grab touch-none shrink-0"
                  onTouchStart={(e) => { barTouchStartYRef.current = e.touches[0].clientY; }}
                  onTouchEnd={(e) => {
                    if (barTouchStartYRef.current === null) return;
                    const delta = e.changedTouches[0].clientY - barTouchStartYRef.current;
                    barTouchStartYRef.current = null;
                    if (delta > 60) setManuallyHidden(true);
                    else if (delta < -60) setManuallyHidden(false);
                  }}
                  onClick={() => manuallyHidden && setManuallyHidden(false)}
                >
                  <div className="w-10 h-1 rounded-full bg-[var(--text-muted)]/40" />
                </div>
                <div className="flex items-center justify-center flex-nowrap gap-1.5 sm:gap-2 px-2 sm:px-4 pb-1.5 w-full text-[var(--text-main)] whitespace-nowrap overflow-x-auto no-scrollbar">
                  {renderBarControls()}
                  <div className="w-px h-4 bg-[var(--border-card)] hidden sm:block" />
                  <button
                    onClick={() => setManuallyHidden(true)}
                    className="p-2 rounded-full text-[var(--text-muted)] hover:text-[var(--primary)] hover:bg-[var(--primary)]/10 transition-all"
                    title="Ocultar controles"
                  >
                    <ChevronDown className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
            {hideOwnBar && mergedBarPortalTarget && createPortal(renderBarControls(), mergedBarPortalTarget)}
          </>
        )}
      </div>
    </div>
  );
});
