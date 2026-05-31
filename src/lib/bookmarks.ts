// =============================================================================
// bookmarks.ts — CRUD de marcadores por documento
// -----------------------------------------------------------------------------
// Cada documento mantiene su lista de marcadores en:
//   localStorage[`bookmarks-${documentId}`]  →  Bookmark[]
//
// Es un mini-store ad-hoc (no context) porque los marcadores siempre se usan
// dentro de un ReaderView abierto, así que no vale la pena globalizarlos.
// Si más adelante quieres mostrarlos en el dashboard, sube la lectura al
// contexto y mantén estas funciones como helpers.
// =============================================================================

export interface Bookmark {
  id: string;
  page: number | string;
  name: string;
  timestamp: number;
}

const key = (documentId: string) => `bookmarks-${documentId}`;

export function loadBookmarks(documentId: string): Bookmark[] {
  if (!documentId) return [];
  try {
    const raw = localStorage.getItem(key(documentId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveBookmarks(documentId: string, list: Bookmark[]): void {
  if (!documentId) return;
  try {
    localStorage.setItem(key(documentId), JSON.stringify(list));
  } catch (err) {
    console.warn('No se pudieron guardar los marcadores:', err);
  }
}

// Nombre por defecto si el usuario no escribe nada en el modal.
export function defaultBookmarkName(page: number | string): string {
  return `Marcador Pág. ${page}`;
}

export function addBookmark(
  documentId: string,
  page: number | string,
  name?: string,
): Bookmark[] {
  const finalName = (name && name.trim()) || defaultBookmarkName(page);
  const list = loadBookmarks(documentId);
  const next: Bookmark = {
    id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `bm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    page,
    name: finalName,
    timestamp: Date.now(),
  };
  const updated = [...list, next];
  saveBookmarks(documentId, updated);
  return updated;
}

export function removeBookmark(documentId: string, bookmarkId: string): Bookmark[] {
  const updated = loadBookmarks(documentId).filter(b => b.id !== bookmarkId);
  saveBookmarks(documentId, updated);
  return updated;
}

export function renameBookmark(
  documentId: string,
  bookmarkId: string,
  name: string,
): Bookmark[] {
  const updated = loadBookmarks(documentId).map(b =>
    b.id === bookmarkId ? { ...b, name: name.trim() || b.name } : b,
  );
  saveBookmarks(documentId, updated);
  return updated;
}

export function clearBookmarks(documentId: string): void {
  try {
    localStorage.removeItem(key(documentId));
  } catch {}
}
