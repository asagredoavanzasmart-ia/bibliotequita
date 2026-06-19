// =============================================================================
// types.ts — Modelos de datos centrales
// -----------------------------------------------------------------------------
// Todos los modelos de dominio se definen aquí. Si añades un campo nuevo a
// BookItem recuerda que se persiste en localStorage (clave 'library_items'),
// así que asegúrate de que sea opcional para no romper datos existentes.
// =============================================================================

// Configuración visual de las tarjetas en el grid (Settings → Tarjetas).
export interface CardSettings {
  showAuthor: boolean;
  showYear: boolean;
  showProgress: boolean;
  showType: boolean;
  showPhysicalStatus: boolean;
  showRating?: boolean;
  // Visibilidad de secciones de navegación del sidebar (por defecto visibles).
  navFavoritos?: boolean;
  navLeidos?: boolean;
  navPorLeer?: boolean;
  navDestacados?: boolean;
  navFisico?: boolean;
  navDigital?: boolean;
  // Orden de esas secciones en el sidebar (lista de ids); si falta alguna,
  // se añade al final con el orden por defecto.
  navOrder?: NavSectionId[];
}

export type NavSectionId = 'favoritos' | 'leidos' | 'porleer' | 'destacados' | 'fisico' | 'digital';

// Tipo de fuente del recurso: archivo PDF, libro EPUB o página web externa.
export type ResourceType = 'pdf' | 'epub' | 'txt' | 'externa';

// Tipo de recurso adicional adjunto a un libro (pestaña "Recursos").
export type ResourceKind = 'video' | 'audio' | 'text' | 'image';

// Recurso complementario de un libro: video, audio, texto o imagen.
// Los recursos de texto reutilizan el motor de lectura/citas; su identidad de
// notas/citas usa documentId = `<bookId>::res::<id>`.
export interface ResourceItem {
  id: string;
  bookId: string;
  kind: ResourceKind;
  title: string;
  source: string;            // URL /api/files/..., o blob:/data:/idb:// según patrón
  fileType?: ResourceType;   // para kind 'text': qué lector usar ('pdf'|'epub'|'txt')
  mimeType?: string;
  isSummary?: boolean;       // true si proviene de la herramienta de resumen IA
  thumbnailUrl?: string;     // portada extraída automáticamente (PDF/EPUB)
  timestamp: number;
  listIndex?: number;
}

export interface CategoryData {
  id: string;
  name: string;
  hidden?: boolean;   // Oculta de la barra lateral (no se borra). Categorías base.
}

// Sistema de etiquetas (TagData) eliminado durante el desarrollo.
// Si se reintroduce, hacerlo con identidad por id (no por nombre) para que
// renombrar una etiqueta no rompa el matching en BookItem.

export interface PurchaseLink {
  id: string;
  url: string;
  price?: string;
  storeName?: string;
}

// Entidad central. Cada item (libro / revista / artículo) es una BookItem.
// IMPORTANTE: `source` puede ser una URL pública, una URL blob: temporal
// (se pierde al recargar) o una URL idb:// que apunta a un blob persistido
// en IndexedDB (vía idb-keyval). Los lectores resuelven el esquema.
export interface BookItem {
  id: string;
  category: string;             // id de CategoryData (libros / revistas / articulos / ...)
  title: string;
  author?: string;
  year?: string;
  source: string;               // URL pública, blob:..., o idb://... (fuente legacy/principal)
  type: ResourceType;
  pdfSource?: string;           // PDF del libro (coexiste con epubSource)
  epubSource?: string;          // EPUB del libro (coexiste con pdfSource)
  thumbnailUrl?: string;        // Portada (URL, blob: o data: base64)
  timestamp: number;            // Fecha de creación (sirve para "Más recientes" y velocidad de lectura)
  folderIds: string[];          // Listas/playlists a las que pertenece
  stageIds: string[];           // Etapas históricas asignadas
  listIndex?: number;           // Posición manual para drag & drop
  read?: boolean;
  toBuy?: boolean;
  ownedPhysical?: boolean;
  ownedDigital?: boolean;
  pinned?: boolean;             // Aparece en la vista "Destacados" (chincheta)
  favorite?: boolean;           // Aparece en la vista "Favoritos" (estrella)
  toRead?: boolean;             // Aparece en la vista "Por Leer" (reloj de arena)
  subject?: string;
  publisher?: string;           // Editorial del material
  isbn?: string;                // ISBN
  progress?: number;            // 0-100
  rating?: number;              // 1-5 estrellas
  tags?: string[];              // Etiquetas del material
  bookmarkPage?: number | string; // Última página marcada → se reanuda lectura aquí
  purchaseLinks?: PurchaseLink[];
  deletedAt?: string;
}

export interface PlaylistData {
  id: string;
  name: string;
  color: string;
}

export interface StageData {
  id: string;
  name: string;
}
