// =============================================================================
// EpubHtmlReader.tsx — Motor de lectura EPUB v2, SIN IFRAMES.
// -----------------------------------------------------------------------------
// epub.js se usa ÚNICAMENTE como parser del ZIP/OPF (spine, navegación,
// archivo). Cada sección se extrae como HTML sanitizado y se inyecta en UN
// contenedor scrolleable del documento principal — el mismo patrón que
// TxtReader, que nunca ha dado problemas. Con esto, selección, resaltado,
// TTS y citas usan el MISMO pipeline del documento principal.
//
// Lecciones de ReadEra aplicadas (ver plan "Nuevo motor EPUB v2"):
//  - Puntero topológico estable {sección, offset de carácter} — nunca números
//    de página como referencia persistente.
//  - Scroll 100% nativo: PROHIBIDO registrar touchstart/move/end propios,
//    hacer preventDefault del scroll o paginar con columnas CSS/translateX.
//  - "Páginas" = cortes FIJOS por cantidad de palabras (propiedad del texto,
//    no del viewport): mismo total de páginas en cualquier dispositivo. En
//    vertical, cada corte parte el flujo con una banda gris con sombra
//    (aspecto de páginas separadas, como el visor de PDF). En horizontal,
//    columnas CSS + scroll-snap NATIVO (cero JS táctil).
//  - Render completo al abrir con overlay de carga: el texto SIEMPRE está
//    disponible (búsquedas, citas y TTS nunca fallan por contenido no
//    montado).
//  - Resaltados como <mark> EN el flujo: refluyen solos con zoom/fuente.
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
  highlightText(text: string, colorHex: string, persistent: boolean): boolean;
  clearHighlights(includePersistent: boolean): void;
  setFontScale(pct: number): void;       // se mapea al preset chica/grande más cercano
  pageBy(delta: number): void;           // salto a corte de página FIJO (por palabras)
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
  controlsVisible?: boolean;
  hideOwnBar?: boolean;
  mergedBarPortalTarget?: HTMLElement | null;
}

interface SectionData { html: string; text: string; href: string; words: number }

// Solo DOS tamaños de letra (pedido del usuario): chica y grande. La
// paginación NO depende del tamaño elegido ni de la pantalla: la página se
// define por una CANTIDAD FIJA DE PALABRAS (estándar editorial de libro
// impreso), así el libro tiene siempre el mismo número de páginas en
// cualquier dispositivo y con cualquiera de los dos tamaños. La página es
// una propiedad del TEXTO (topológica, lección ReadEra), no del viewport.
const FONT_PRESETS = [100, 140] as const; // [letra chica, letra grande]
const WORDS_PER_PAGE = 300;
const HL_CLASS = '__epub-hl__';
const GAP_CLASS = '__epub-gap__';   // banda gris entre "páginas" (modo vertical)
const H_COLUMN_GAP = 48;            // separación entre columnas-página (modo horizontal)

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
// (nodo, offset crudo) por carácter. Es la misma técnica del resaltado por
// carácter del PDF (buildPageLines), aplicada a HTML plano — la usan
// goToText, highlightText y goToAnchor para trabajar SIEMPRE sobre las
// mismas coordenadas.
// ---------------------------------------------------------------------------
interface CharMapEntry { node: Text; offset: number }

function buildSectionCharMap(sectionEl: HTMLElement): { text: string; map: CharMapEntry[] } {
  // Las etiquetas "pág. N" de las bandas de corte viven DENTRO de la sección
  // pero no son texto del libro: excluirlas mantiene el mapa idéntico a
  // sections[].text (si entraran, todas las búsquedas/anclas se correrían).
  const walker = document.createTreeWalker(sectionEl, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) =>
      n.parentElement?.closest(`.${GAP_CLASS}`) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  let text = '';
  const map: CharMapEntry[] = [];
  let prevSpace = true;
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
  { url, onReady, onRelocate, onContentTap, onParseError, controlsVisible = true, hideOwnBar = false, mergedBarPortalTarget = null },
  ref,
) {
  const [sections, setSections] = useState<SectionData[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  // 0 = letra chica, 1 = letra grande (persistido: misma preferencia en todos los libros).
  const [fontPreset, setFontPreset] = useState<0 | 1>(() => {
    try { return window.localStorage.getItem('epub-font-preset') === '1' ? 1 : 0; } catch { return 0; }
  });
  const [manuallyHidden, setManuallyHidden] = useState(false);
  const [page, setPage] = useState({ current: 1, total: 1 });
  // offsetTop (px, coords del scroller) de cada banda de corte (modo
  // vertical). Se re-MIDE tras cargar, cambiar letra o redimensionar — el
  // NÚMERO de páginas nunca cambia (es por palabras), solo la posición.
  const pageBoundaryTopsRef = useRef<number[]>([]);
  // Modo de lectura: 'v' scroll vertical con cortes tipo PDF; 'h' páginas
  // deslizables al costado (columnas CSS + scroll-snap, cero JS táctil).
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    try { return window.localStorage.getItem('epub-view-mode') === 'h' ? 'h' : 'v'; } catch { return 'v'; }
  });
  const viewModeRef = useRef<ViewMode>(viewMode);
  useEffect(() => { viewModeRef.current = viewMode; }, [viewMode]);
  const [scrollerW, setScrollerW] = useState(0);   // ancho útil del visor (px)
  const [hPages, setHPages] = useState(1);         // nº de columnas-página en modo horizontal
  const [toc, setToc] = useState<{ label: string; href: string; sub?: boolean }[]>([]);
  const [showToc, setShowToc] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const blobUrlsRef = useRef<string[]>([]);
  const spineHrefsRef = useRef<string[]>([]);
  const sectionsRef = useRef<SectionData[] | null>(null);
  useEffect(() => { sectionsRef.current = sections; }, [sections]);

  // ----- Carga y extracción (una vez por libro) -----------------------------
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setSections(null);
    setLoadError(false);

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
  const getSectionEl = (s: number): HTMLElement | null =>
    contentRef.current?.querySelector(`section[data-spine-idx="${s}"]`) as HTMLElement | null;

  const sectionIndexOfNode = (node: Node): number => {
    const sec = (node instanceof HTMLElement ? node : node.parentElement)?.closest('section[data-spine-idx]');
    return sec ? Number((sec as HTMLElement).dataset.spineIdx) : -1;
  };

  // Primer bloque visible dentro del viewport del contenedor. El chequeo es
  // en ambos ejes: en vertical todo bloque cruza horizontalmente (inocuo);
  // en horizontal (columnas) descarta los de columnas ya pasadas.
  const firstVisibleBlock = (): HTMLElement | null => {
    const scroller = scrollRef.current;
    const content = contentRef.current;
    if (!scroller || !content) return null;
    const sr = scroller.getBoundingClientRect();
    const blocks = content.querySelectorAll<HTMLElement>(`p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, td, section > div:not(.${GAP_CLASS})`);
    for (const el of Array.from(blocks)) {
      const r = el.getBoundingClientRect();
      if (r.height > 0 && r.bottom > sr.top + 1 && r.right > sr.left + 1 && (el.textContent || '').trim().length > 0) return el;
    }
    return null;
  };

  // ----- Contrato ------------------------------------------------------------
  const getVisibleText = useCallback((): string => {
    const scroller = scrollRef.current;
    const content = contentRef.current;
    if (!scroller || !content) return '';
    const rect = scroller.getBoundingClientRect();
    const parts: string[] = [];
    const blockSel = 'p, h1, h2, h3, h4, h5, h6, li, blockquote, pre';
    content.querySelectorAll<HTMLElement>('section[data-spine-idx]').forEach(sec => {
      const sr = sec.getBoundingClientRect();
      if (sr.bottom < rect.top || sr.top > rect.bottom || sr.right < rect.left || sr.left > rect.right) return;
      sec.querySelectorAll<HTMLElement>(blockSel).forEach(el => {
        // Si el elemento contiene otro bloque anidado (p. ej. <li><p>…</p></li>
        // o <blockquote><p>…</p></blockquote>, frecuente en EPUB exportados
        // desde Word/Calibre), su textContent ya incluye el del hijo: contar
        // ambos duplicaría el texto y el TTS leería la misma frase dos veces.
        // Solo cuenta el bloque más interno.
        if (el.querySelector(blockSel)) return;
        const r = el.getBoundingClientRect();
        // Intersección en AMBOS ejes: en modo horizontal (columnas) un bloque
        // de otra columna comparte franja vertical pero no horizontal.
        if (r.bottom > rect.top && r.top < rect.bottom && r.right > rect.left && r.left < rect.right && r.height > 0) {
          const t = normalize(el.textContent || '').trim();
          if (t) parts.push(t);
        }
      });
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
    const sectionEl = getSectionEl(s);
    if (!sectionEl) return null;
    // Offset (en caracteres normalizados) del inicio del bloque dentro de la
    // sección: primer carácter del mapa cuyo nodo cae DENTRO del bloque (no
    // se exige que sea literalmente el primer nodo de texto del bloque —
    // si ese nodo es whitespace puro "absorbido" por un espacio ya contado
    // en un hermano anterior, no aparece en el mapa y buscar coincidencia
    // exacta devolvía -1, saltando incorrectamente al inicio de la sección).
    const { map } = buildSectionCharMap(sectionEl);
    const idx = map.findIndex(e => block.contains(e.node));
    return { s, o: Math.max(0, idx) };
  }, []);

  const goToAnchor = useCallback((a: EpubAnchor, center = false): void => {
    const sectionEl = getSectionEl(a.s);
    if (!sectionEl) return;
    const { map } = buildSectionCharMap(sectionEl);
    const entry = map[Math.min(a.o, Math.max(0, map.length - 1))];
    if (!entry) { sectionEl.scrollIntoView({ block: 'start' }); return; }
    const range = document.createRange();
    try {
      range.setStart(entry.node, Math.min(entry.offset, entry.node.length));
      range.collapse(true);
      const span = document.createElement('span');
      range.insertNode(span);
      // block gobierna el modo vertical; inline el horizontal (columnas).
      span.scrollIntoView({ block: center ? 'center' : 'start', inline: center ? 'center' : 'start' });
      const parent = span.parentNode;
      parent?.removeChild(span);
      parent?.normalize();
    } catch {
      sectionEl.scrollIntoView({ block: 'start', inline: 'start' });
    }
  }, []);

  // Busca `text` en todo el libro: primero elige sección por texto plano
  // (barato), luego construye el charMap SOLO de esa sección.
  const findInBook = useCallback((text: string): { sectionEl: HTMLElement; map: CharMapEntry[]; from: number; len: number } | null => {
    const clean = normalize(text).trim().toLowerCase();
    if (clean.length < 3 || !sectionsRef.current) return null;
    for (let s = 0; s < sectionsRef.current.length; s++) {
      if (!sectionsRef.current[s].text.toLowerCase().includes(clean)) continue;
      const sectionEl = getSectionEl(s);
      if (!sectionEl) continue;
      const { text: secText, map } = buildSectionCharMap(sectionEl);
      const idx = secText.toLowerCase().indexOf(clean);
      if (idx >= 0) return { sectionEl, map, from: idx, len: clean.length };
    }
    return null;
  }, []);

  const goToText = useCallback((text: string, center = true): boolean => {
    const found = findInBook(text);
    if (!found) return false;
    const entry = found.map[found.from];
    try {
      const range = document.createRange();
      range.setStart(entry.node, Math.min(entry.offset, entry.node.length));
      range.collapse(true);
      const span = document.createElement('span');
      range.insertNode(span);
      span.scrollIntoView({ block: center ? 'center' : 'start', inline: center ? 'center' : 'start' });
      const parent = span.parentNode;
      parent?.removeChild(span);
      parent?.normalize();
      return true;
    } catch {
      found.sectionEl.scrollIntoView({ block: 'start', inline: 'start' });
      return true;
    }
  }, [findInBook]);

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

  const highlightText = useCallback((text: string, colorHex: string, persistent: boolean): boolean => {
    // El resaltado del TTS (no persistente) reemplaza al anterior.
    if (!persistent) clearHighlights(false);
    if (!text || normalize(text).trim().length < 3) return true; // limpiar era el objetivo
    const found = findInBook(text);
    if (!found) return false;
    const firstMark = wrapMarks(found.map, found.from, found.from + found.len, colorHex, persistent);
    if (firstMark) firstMark.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    return !!firstMark;
  }, [clearHighlights, findInBook]);

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
      const sectionEl = ms >= 0 ? getSectionEl(ms) : null;
      if (sectionEl) {
        const { map } = buildSectionCharMap(sectionEl);
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
  }, [getCurrentAnchor]);

  // ----- Paginación por PALABRAS FIJAS ---------------------------------------
  // El total de páginas depende SOLO del texto (ceil(palabras/300)). En modo
  // vertical, cada corte se materializa UNA vez partiendo el flujo en el
  // inicio exacto de la palabra k*300 e insertando una banda gris con sombra
  // (aspecto "páginas separadas" del visor PDF). Los splits son posiciones
  // de TEXTO: no se rehacen al cambiar letra/ancho — solo se re-MIDE dónde
  // quedaron las bandas.
  const totalPagesRef = useRef(1);

  // Página actual = 1 + nº de bandas por encima del punto de referencia
  // (un tercio superior del viewport: lo que el lector "está leyendo").
  const updateCurrentPage = useCallback(() => {
    const scroller = scrollRef.current;
    if (!scroller || viewModeRef.current === 'h') return;
    const refY = scroller.scrollTop + scroller.clientHeight * 0.35;
    const tops = pageBoundaryTopsRef.current;
    let lo = 0, hi = tops.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (tops[mid] <= refY) lo = mid + 1; else hi = mid; }
    const current = Math.min(totalPagesRef.current, lo + 1);
    setPage(prev => (prev.current === current && prev.total === totalPagesRef.current) ? prev : { current, total: totalPagesRef.current });
  }, []);

  // Re-mide la posición vertical de las bandas ya insertadas (tras reflow
  // por cambio de letra o de ancho). No toca el DOM.
  const measureGapTops = useCallback(() => {
    const scroller = scrollRef.current;
    const content = contentRef.current;
    if (!scroller || !content || viewModeRef.current === 'h') return;
    const scrollerTop = scroller.getBoundingClientRect().top;
    const tops: number[] = [];
    content.querySelectorAll<HTMLElement>(`.${GAP_CLASS}`).forEach(g => {
      tops.push(Math.max(0, g.getBoundingClientRect().top - scrollerTop + scroller.scrollTop));
    });
    pageBoundaryTopsRef.current = tops;
    updateCurrentPage();
  }, [updateCurrentPage]);

  // Inserta los cortes de página REALES (una sola vez por libro montado):
  // 1) recorre el DOM contando inicios de palabra (misma normalización que
  //    sections[].text); 2) en cada múltiplo de WORDS_PER_PAGE parte el
  //    bloque con Range.extractContents (clona los ancestros parciales,
  //    igual que hace un paginador real) e inserta la banda divisoria.
  const applyPageBreaks = useCallback(() => {
    const content = contentRef.current;
    const secs = sectionsRef.current;
    if (!content || !secs) return;
    if (content.querySelector(`.${GAP_CLASS}`)) { measureGapTops(); return; } // ya aplicado
    const totalWords = secs.reduce((a, s) => a + s.words, 0);
    totalPagesRef.current = Math.max(1, Math.ceil(totalWords / WORDS_PER_PAGE));
    // Publicar el total apenas se conoce (en horizontal updateCurrentPage no
    // corre y el contador quedaría en 1/1 hasta el primer scroll).
    setPage(prev => prev.total === totalPagesRef.current ? prev : { current: Math.min(prev.current, totalPagesRef.current), total: totalPagesRef.current });

    // Fase A: recolectar los puntos de corte {nodo, offset} sin mutar nada.
    const cuts: { node: Text; offset: number; page: number }[] = [];
    let wordsAcc = 0;
    let nextBoundary = WORDS_PER_PAGE;
    for (let s = 0; s < secs.length; s++) {
      const sectionEl = getSectionEl(s);
      if (!sectionEl) {
        wordsAcc += secs[s].words;
        while (wordsAcc >= nextBoundary) nextBoundary += WORDS_PER_PAGE;
        continue;
      }
      const walker = document.createTreeWalker(sectionEl, NodeFilter.SHOW_TEXT);
      let prevSpace = true;
      let tn: Text | null;
      while ((tn = walker.nextNode() as Text | null)) {
        const raw = tn.textContent || '';
        for (let i = 0; i < raw.length; i++) {
          const isSpace = /\s/.test(raw[i]);
          if (!isSpace && prevSpace) {
            if (wordsAcc === nextBoundary) {
              cuts.push({ node: tn, offset: i, page: cuts.length + 2 });
              nextBoundary += WORDS_PER_PAGE;
            }
            wordsAcc++;
          }
          prevSpace = isSpace;
        }
      }
    }

    // Fase B: aplicar de ATRÁS hacia adelante — partir un nodo no invalida
    // los cortes anteriores (que quedan en la mitad intacta).
    for (let k = cuts.length - 1; k >= 0; k--) {
      const { node, offset, page: pageNum } = cuts[k];
      const sectionEl = node.parentElement?.closest('section[data-spine-idx]');
      if (!sectionEl) continue;
      // Bloque de nivel superior (hijo directo de la sección) que contiene el corte.
      let topBlock: Node = node;
      while (topBlock.parentNode && topBlock.parentNode !== sectionEl) topBlock = topBlock.parentNode;

      const gap = document.createElement('div');
      gap.className = GAP_CLASS;
      gap.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span');
      label.textContent = `pág. ${pageNum}`;
      gap.appendChild(label);

      try {
        // ¿El corte cae justo al inicio del bloque? Entonces basta la banda
        // ANTES del bloque, sin partir nada.
        const pre = document.createRange();
        pre.setStart(topBlock, 0);
        pre.setEnd(node, offset);
        if (pre.toString().trim().length === 0) {
          sectionEl.insertBefore(gap, topBlock);
        } else {
          const r = document.createRange();
          r.setStart(node, offset);
          r.setEndAfter(topBlock);
          const frag = r.extractContents();
          // Mitades marcadas: en modo horizontal la banda se oculta y estas
          // clases pegan las dos mitades (sin margen de párrafo entre ellas).
          if (topBlock instanceof HTMLElement) topBlock.classList.add('__epub-head__');
          Array.from(frag.children).forEach(c => c.classList.add('__epub-cont__'));
          (topBlock as ChildNode).after(gap, frag);
        }
      } catch { /* estructura hostil (tabla rara, etc.): banda omitida; el conteo no cambia */ }
    }
    measureGapTops();
  }, [measureGapTops]);

  // Página (por palabras) en la que cae un ancla — para el contador en modo
  // horizontal, donde las bandas están ocultas y no hay tops que medir.
  const wordPageOfAnchor = useCallback((a: EpubAnchor): number => {
    const secs = sectionsRef.current;
    if (!secs) return 1;
    let words = 0;
    for (let i = 0; i < a.s && i < secs.length; i++) words += secs[i].words;
    const sec = secs[a.s];
    if (sec) words += countWords(sec.text.slice(0, a.o));
    return Math.max(1, Math.min(totalPagesRef.current, Math.floor(words / WORDS_PER_PAGE) + 1));
  }, []);

  const setFontScale = useCallback((pct: number): void => {
    const preset: 0 | 1 = pct >= 120 ? 1 : 0;
    try { window.localStorage.setItem('epub-font-preset', String(preset)); } catch { /* modo privado */ }
    // Re-anclar tras el reflow: capturar ANTES, aplicar, restaurar y re-medir
    // las bandas en los frames siguientes (los cortes NO se mueven de texto).
    const anchor = getCurrentAnchor();
    setFontPreset(preset);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (anchor) goToAnchor(anchor);
      measureGapTops();
    }));
  }, [getCurrentAnchor, goToAnchor, measureGapTops]);

  // Alternar vertical ⇄ horizontal conservando la posición de lectura.
  const toggleViewMode = useCallback(() => {
    const anchor = getCurrentAnchor();
    const next: ViewMode = viewModeRef.current === 'v' ? 'h' : 'v';
    try { window.localStorage.setItem('epub-view-mode', next); } catch { /* modo privado */ }
    setViewMode(next);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (anchor) goToAnchor(anchor);
      measureGapTops();
    }));
  }, [getCurrentAnchor, goToAnchor, measureGapTops]);

  // Avanza/retrocede una página. Vertical: salto al corte FIJO (por
  // palabras). Horizontal: una columna-página (el snap la deja alineada).
  const pageBy = useCallback((delta: number): void => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    if (viewModeRef.current === 'h') {
      scroller.scrollBy({ left: delta * scroller.clientWidth, behavior: 'auto' });
      return;
    }
    const tops = pageBoundaryTopsRef.current;
    const refY = scroller.scrollTop + scroller.clientHeight * 0.35;
    let lo = 0, hi = tops.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (tops[mid] <= refY) lo = mid + 1; else hi = mid; }
    const currentPageIdx = lo; // 0-based: página actual - 1
    const target = Math.max(0, Math.min(totalPagesRef.current - 1, currentPageIdx + delta));
    const top = target === 0 ? 0 : tops[target - 1] ?? 0;
    scroller.scrollTo({ top, behavior: 'auto' });
  }, []);

  // Avance de LECTURA continua (lo usa el TTS al agotar el texto visible).
  // Vertical: casi un viewport con leve solapamiento para no saltarse líneas.
  // Horizontal: exactamente una columna (las columnas no comparten texto).
  const scrollByViewport = useCallback((delta: number): void => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    if (viewModeRef.current === 'h') {
      scroller.scrollBy({ left: delta * scroller.clientWidth, behavior: 'auto' });
      return;
    }
    scroller.scrollBy({ top: delta * scroller.clientHeight * 0.92, behavior: 'auto' });
  }, []);

  useImperativeHandle(ref, (): EpubReaderHandle => ({
    getVisibleText,
    getFullText,
    getCurrentAnchor,
    goToAnchor,
    goToText,
    highlightText,
    clearHighlights,
    setFontScale,
    pageBy,
    scrollByViewport,
    getContinuationText,
  }), [getVisibleText, getFullText, getCurrentAnchor, goToAnchor, goToText, highlightText, clearHighlights, setFontScale, pageBy, scrollByViewport, getContinuationText]);

  // ----- Cortes iniciales + scroll → página actual + onRelocate --------------
  const relocateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Tras el primer render de las secciones (doble rAF: layout ya estable),
  // insertar los cortes de página por palabras una única vez.
  useEffect(() => {
    if (!sections) return;
    const raf1 = requestAnimationFrame(() => requestAnimationFrame(() => {
      applyPageBreaks();
      if (scrollRef.current) setScrollerW(scrollRef.current.clientWidth);
    }));
    return () => cancelAnimationFrame(raf1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sections]);

  // Nº de columnas-página en modo horizontal (tras cada reflow relevante).
  useEffect(() => {
    if (!sections || viewMode !== 'h') return;
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => {
      const sc = scrollRef.current;
      if (!sc) return;
      setHPages(Math.max(1, Math.round(sc.scrollWidth / Math.max(1, sc.clientWidth))));
    }));
    return () => cancelAnimationFrame(raf);
  }, [sections, viewMode, scrollerW, fontPreset]);

  // Al volver a vertical las bandas reaparecen: re-medirlas.
  useEffect(() => {
    if (!sections || viewMode !== 'v') return;
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => measureGapTops()));
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode]);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || !sections) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        updateCurrentPage(); // barato (binary search); en 'h' retorna solo
        if (relocateTimerRef.current) clearTimeout(relocateTimerRef.current);
        relocateTimerRef.current = setTimeout(() => {
          const a = getCurrentAnchor();
          // En horizontal la página sale del ancla (las bandas están ocultas);
          // en vertical, de la posición del scroll respecto a las bandas.
          const current = viewModeRef.current === 'h'
            ? (a ? wordPageOfAnchor(a) : 1)
            : pageFromScroll();
          setPage(prev => (prev.current === current && prev.total === totalPagesRef.current) ? prev : { current, total: totalPagesRef.current });
          onRelocate?.(a, { current, total: totalPagesRef.current });
        }, 500);
      });
    };
    const pageFromScroll = (): number => {
      const s = scrollRef.current;
      if (!s) return 1;
      const refY = s.scrollTop + s.clientHeight * 0.35;
      const tops = pageBoundaryTopsRef.current;
      let lo = 0, hi = tops.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (tops[mid] <= refY) lo = mid + 1; else hi = mid; }
      return Math.min(totalPagesRef.current, lo + 1);
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
  const pendingAnchorRef = useRef<EpubAnchor | null>(null);
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || !sections) return;
    // ResizeObserver SIEMPRE dispara un callback inicial al observar: hay que
    // ignorarlo. Si se procesara, capturaría el ancla "inicio del libro" y
    // 250ms después pisaría la restauración del marcador guardado.
    let initialFire = true;
    const observer = new ResizeObserver(() => {
      if (initialFire) { initialFire = false; return; }
      setScrollerW(scroller.clientWidth);
      // Ancla capturada ANTES del primer evento de la ráfaga.
      if (!pendingAnchorRef.current) pendingAnchorRef.current = getCurrentAnchor();
      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current);
      resizeTimerRef.current = setTimeout(() => {
        resizeTimerRef.current = null;
        const a = pendingAnchorRef.current;
        pendingAnchorRef.current = null;
        if (a) goToAnchor(a);
        // Las bandas cambian de posición vertical con el nuevo ancho (el
        // TOTAL de páginas no: es por palabras).
        measureGapTops();
      }, 250);
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
          const el = getSectionEl(s)?.querySelector(`[id="${CSS.escape(hash)}"]`);
          if (el) { el.scrollIntoView({ block: 'start', inline: 'start' }); return; }
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
  }, [goToAnchor, onContentTap]);

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
      <span className="text-xs font-mono font-semibold tabular-nums text-[var(--text-muted)] px-1 min-w-[78px] text-center shrink-0 inline-flex items-center justify-center" title="Página (fija por palabras: no cambia con letra ni pantalla)">
        {sections ? <>{page.current} / {page.total}</> : <Loader2 className="w-3.5 h-3.5 animate-spin" />}
      </span>
      <div className="w-px h-4 bg-[var(--border-card)] hidden sm:block" />
      {/* Alternar lectura vertical (scroll con cortes tipo PDF) ⇄ horizontal
          (páginas deslizables al costado con snap nativo). */}
      <button
        onClick={toggleViewMode}
        className="p-2 rounded-full text-[var(--text-muted)] hover:text-[var(--primary)] hover:bg-[var(--primary)]/10 transition-all"
        title={viewMode === 'v' ? 'Pasar a páginas deslizables (horizontal)' : 'Pasar a scroll vertical'}
      >
        {viewMode === 'v' ? <GalleryHorizontal className="w-5 h-5" /> : <GalleryVertical className="w-5 h-5" />}
      </button>
      <div className="w-px h-4 bg-[var(--border-card)] hidden sm:block" />
      {/* Solo DOS tamaños de letra: chica y grande. La cantidad de páginas
          no cambia con el tamaño (páginas por palabras fijas). */}
      <div className="flex items-center gap-0.5 bg-[var(--bg-app)]/60 rounded-lg p-0.5">
        <button
          onClick={() => setFontScale(FONT_PRESETS[0])}
          className={cn('px-2.5 py-1 rounded-md text-xs font-bold transition-colors', fontPreset === 0 ? 'bg-[var(--primary)] text-white' : 'text-[var(--text-muted)] hover:text-[var(--primary)]')}
          title="Letra chica"
        >
          A
        </button>
        <button
          onClick={() => setFontScale(FONT_PRESETS[1])}
          className={cn('px-2 py-0.5 rounded-md text-base font-bold transition-colors leading-none', fontPreset === 1 ? 'bg-[var(--primary)] text-white' : 'text-[var(--text-muted)] hover:text-[var(--primary)]')}
          title="Letra grande"
        >
          A
        </button>
      </div>
    </>
  );

  return (
    // Fondo gris tipo visor de PDF: las "páginas" blancas flotan sobre él.
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
              #epub-html-content { font-family: Georgia, 'Times New Roman', serif; color: var(--text-main); line-height: 1.75; }
              #epub-html-content p { margin: 0 0 0.9em 0; text-align: justify; }
              #epub-html-content h1, #epub-html-content h2, #epub-html-content h3,
              #epub-html-content h4, #epub-html-content h5, #epub-html-content h6 {
                font-weight: 700; line-height: 1.3; margin: 1.4em 0 0.6em 0; text-align: left; }
              #epub-html-content h1 { font-size: 1.6em; } #epub-html-content h2 { font-size: 1.35em; }
              #epub-html-content h3 { font-size: 1.15em; }
              #epub-html-content img { max-width: 100%; height: auto; display: block; margin: 1em auto; }
              #epub-html-content blockquote { border-left: 3px solid var(--border-card); padding-left: 1em; margin: 1em 0; color: var(--text-muted); font-style: italic; }
              #epub-html-content a[data-internal-href] { color: var(--primary); text-decoration: underline; cursor: pointer; }
              #epub-html-content table { max-width: 100%; overflow-x: auto; display: block; }
              #epub-html-content section[data-spine-idx] { min-height: 1px; }
              /* Vertical: la columna de texto ES la "página" blanca con sombra
                 sobre el fondo gris (aspecto del visor de PDF). */
              #epub-html-content.__epub-vmode { background: #fff; box-shadow: 0 1px 3px rgba(15,23,42,.18), 0 6px 18px rgba(15,23,42,.10); }
              /* Banda de corte entre páginas: interrumpe la columna blanca de
                 borde a borde (márgenes negativos = padding de la columna) con
                 el gris del fondo + sombras internas como filo de página. */
              .${GAP_CLASS} { height: 30px; background: #e2e8f0; position: relative;
                margin: 16px -1rem; pointer-events: none;
                box-shadow: inset 0 7px 7px -5px rgba(15,23,42,.25), inset 0 -7px 7px -5px rgba(15,23,42,.15); }
              @media (min-width: 640px) { .${GAP_CLASS} { margin-left: -2rem; margin-right: -2rem; } }
              .${GAP_CLASS} > span { position: absolute; right: 10px; top: 50%; transform: translateY(-50%);
                font-family: ui-monospace, monospace; font-size: 10px; color: #64748b; user-select: none; }
              /* Horizontal: sin bandas (la página es la columna) y las dos
                 mitades de un bloque partido se pegan sin margen de párrafo. */
              #epub-html-content.__epub-hmode .${GAP_CLASS} { display: none; }
              #epub-html-content.__epub-hmode .__epub-head__ { margin-bottom: 0; }
              #epub-html-content.__epub-hmode .__epub-cont__ { margin-top: 0; text-indent: 0; }
            `}</style>

            {/* Scroll 100% NATIVO en ambos modos. Sin listeners táctiles, sin
                transform: en horizontal el "pasar página" lo hace scroll-snap
                del navegador. touch-action: manipulation elimina el zoom por
                doble tap (el doble tap es nuestro gesto de controles). */}
            <div
              ref={scrollRef}
              className={cn(
                'flex-1 min-h-0 relative',
                viewMode === 'v' ? 'overflow-y-auto' : 'overflow-x-auto overflow-y-hidden snap-x snap-mandatory bg-white'
              )}
              style={{ touchAction: 'manipulation' }}
              onClick={handleContentClick}
            >
              {/* Guías de snap del modo horizontal: un punto invisible por
                  columna-página (las columnas CSS no son elementos y no pueden
                  llevar snap-align propio). */}
              {viewMode === 'h' && scrollerW > 0 && Array.from({ length: hPages }, (_, k) => (
                <div key={k} aria-hidden className="absolute top-0 w-px h-px snap-start" style={{ left: k * scrollerW }} />
              ))}
              <div
                id="epub-html-content"
                ref={contentRef}
                className={viewMode === 'v' ? 'max-w-3xl mx-auto px-4 sm:px-8 py-6 __epub-vmode' : '__epub-hmode'}
                style={viewMode === 'v'
                  ? { fontSize: `${FONT_PRESETS[fontPreset]}%` }
                  : {
                      fontSize: `${FONT_PRESETS[fontPreset]}%`,
                      height: '100%',
                      width: 'max-content',
                      columnWidth: `${Math.max(160, scrollerW - H_COLUMN_GAP)}px`,
                      columnGap: `${H_COLUMN_GAP}px`,
                      columnFill: 'auto',
                      padding: `20px ${H_COLUMN_GAP / 2}px`,
                    }}
              >
                {(sections || []).map((sec, i) => (
                  <section key={i} data-spine-idx={i} dangerouslySetInnerHTML={{ __html: sec.html }} />
                ))}
              </div>

              {!sections && (
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
