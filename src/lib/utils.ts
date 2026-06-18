import type { CSSProperties } from "react";
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import type { BookItem, ResourceType, CardSettings, NavSectionId } from "../types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Resuelve las fuentes de lectura de un libro de forma retrocompatible.
// Prioriza los campos nuevos pdfSource/epubSource y, como fallback, mapea el
// par legacy source/type para que los libros existentes sigan funcionando.
export interface BookSources {
  pdf?: string;
  epub?: string;
  txt?: string;
  externa?: string;
}

export function getBookSources(item: Pick<BookItem, 'source' | 'type' | 'pdfSource' | 'epubSource'>): BookSources {
  const result: BookSources = {};
  if (item.pdfSource) result.pdf = item.pdfSource;
  if (item.epubSource) result.epub = item.epubSource;
  // Fallback legacy: usar source/type solo si el slot correspondiente está vacío.
  if (item.source && item.type) {
    const slot = item.type as ResourceType;
    if (slot === 'pdf' && !result.pdf) result.pdf = item.source;
    else if (slot === 'epub' && !result.epub) result.epub = item.source;
    else if (slot === 'txt' && !result.txt) result.txt = item.source;
    else if (slot === 'externa' && !result.externa) result.externa = item.source;
  }
  return result;
}

// Devuelve la fuente "principal" a abrir por defecto y su tipo, dada la
// preferencia del usuario (si elige una versión concreta) o el orden natural.
export function resolvePrimarySource(
  sources: BookSources,
  prefer?: ResourceType
): { source: string; type: ResourceType } | null {
  const order: ResourceType[] = prefer
    ? [prefer, 'pdf', 'epub', 'txt', 'externa']
    : ['pdf', 'epub', 'txt', 'externa'];
  for (const t of order) {
    const src = sources[t as keyof BookSources];
    if (src) return { source: src, type: t };
  }
  return null;
}

// Metadatos fijos de cada sección de navegación (id, etiqueta y flag de
// visibilidad en CardSettings). El orden por defecto es el histórico.
export const NAV_SECTIONS_META: { id: NavSectionId; label: string; settingKey: keyof CardSettings }[] = [
  { id: 'favoritos', label: 'Favoritos', settingKey: 'navFavoritos' },
  { id: 'leidos', label: 'Leídos', settingKey: 'navLeidos' },
  { id: 'porleer', label: 'Por Leer', settingKey: 'navPorLeer' },
  { id: 'destacados', label: 'Destacados', settingKey: 'navDestacados' },
  { id: 'fisico', label: 'Físico', settingKey: 'navFisico' },
  { id: 'digital', label: 'Digital', settingKey: 'navDigital' },
];

// Devuelve las secciones de navegación en el orden elegido por el usuario
// (cardSettings.navOrder), con las visibilidades aplicadas. Si navOrder no
// incluye alguna sección (dato antiguo), se añade al final en el orden por defecto.
export function getOrderedNavSections(cardSettings: CardSettings): { id: NavSectionId; label: string; show: boolean }[] {
  const order = cardSettings.navOrder?.length
    ? cardSettings.navOrder
    : NAV_SECTIONS_META.map(s => s.id);
  const byId = new Map(NAV_SECTIONS_META.map(s => [s.id, s]));
  const seen = new Set<NavSectionId>();
  const result: { id: NavSectionId; label: string; show: boolean }[] = [];
  for (const id of order) {
    const meta = byId.get(id);
    if (!meta || seen.has(id)) continue;
    seen.add(id);
    result.push({ id: meta.id, label: meta.label, show: cardSettings[meta.settingKey] !== false });
  }
  for (const meta of NAV_SECTIONS_META) {
    if (!seen.has(meta.id)) {
      result.push({ id: meta.id, label: meta.label, show: cardSettings[meta.settingKey] !== false });
    }
  }
  return result;
}

// Las listas/playlists guardan su color como clase Tailwind (ej. "bg-rose-500")
// o, si el usuario elige un color personalizado con el selector nativo, como
// hex (ej. "#a1b2c3"). Esta función separa ambos casos para que los círculos
// de color se rendericen igual sin importar el origen.
export function colorSwatchProps(color?: string): { className?: string; style?: CSSProperties } {
  if (color && color.startsWith('#')) {
    return { style: { backgroundColor: color } };
  }
  return { className: color || 'bg-slate-800' };
}
