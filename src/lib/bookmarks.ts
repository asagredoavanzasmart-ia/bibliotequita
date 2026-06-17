// =============================================================================
// bookmarks.ts — CRUD de marcadores por documento
// -----------------------------------------------------------------------------
// Cada documento mantiene su lista de marcadores en Supabase, vía
// /api/documents/:docId/notes — usando un docId sufijado ("<id>::bookmarks")
// para no chocar con las notas/citas del mismo documento (NotesPanel /
// CitationsManager), que reemplazan su propia lista completa con PUT.
//
// Es un mini-store ad-hoc (no context) porque los marcadores siempre se usan
// dentro de un ReaderView abierto, así que no vale la pena globalizarlos.
// Si más adelante quieres mostrarlos en el dashboard, sube la lectura al
// contexto y mantén estas funciones como helpers.
// =============================================================================

export interface Bookmark {
  id: string;
  // En PDF/TXT es el número de página. En EPUB es el CFI de epubjs (posición
  // exacta en el texto, p.ej. "epubcfi(/6/14!/4/2/16,/1:0,/1:117)"), con el que
  // la rendition puede volver a mostrar ese punto. No hay número de página.
  page: number | string;
  name: string;
  timestamp: number;
  // Solo EPUB: fragmento de texto de la posición anclada, usado como etiqueta
  // legible (la primera palabra/frase visible) ya que no hay número de página.
  label?: string;
}

const bookmarksDocId = (documentId: string) => `${documentId}::bookmarks`;

async function fetchBookmarks(documentId: string): Promise<Bookmark[]> {
  const res = await fetch(`/api/documents/${encodeURIComponent(bookmarksDocId(documentId))}/notes`, {
    credentials: 'include',
  });
  const d = await res.json();
  return Array.isArray(d.notes) ? d.notes : [];
}

async function persistBookmarks(documentId: string, list: Bookmark[]): Promise<void> {
  await fetch(`/api/documents/${encodeURIComponent(bookmarksDocId(documentId))}/notes`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notes: list }),
  });
}

export async function loadBookmarks(documentId: string): Promise<Bookmark[]> {
  if (!documentId) return [];
  try {
    return await fetchBookmarks(documentId);
  } catch {
    return [];
  }
}

// Nombre por defecto si el usuario no escribe nada en el modal.
export function defaultBookmarkName(page: number | string): string {
  return `Marcador Pág. ${page}`;
}

// Nombre por defecto para EPUB: usa el fragmento de texto anclado (recortado),
// ya que no existe número de página.
export function defaultBookmarkNameFromLabel(label?: string): string {
  const clean = (label || '').replace(/\s+/g, ' ').trim();
  if (!clean) return 'Marcador';
  return clean.length > 40 ? `${clean.slice(0, 40)}…` : clean;
}

export async function addBookmark(
  documentId: string,
  page: number | string,
  name?: string,
  label?: string,
): Promise<Bookmark[]> {
  const finalName = (name && name.trim())
    || (label ? defaultBookmarkNameFromLabel(label) : defaultBookmarkName(page));
  const list = await loadBookmarks(documentId);
  const next: Bookmark = {
    id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `bm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    page,
    name: finalName,
    timestamp: Date.now(),
    ...(label ? { label } : {}),
  };
  const updated = [...list, next];
  await persistBookmarks(documentId, updated);
  return updated;
}

export async function removeBookmark(documentId: string, bookmarkId: string): Promise<Bookmark[]> {
  const updated = (await loadBookmarks(documentId)).filter(b => b.id !== bookmarkId);
  await persistBookmarks(documentId, updated);
  return updated;
}

export async function renameBookmark(
  documentId: string,
  bookmarkId: string,
  name: string,
): Promise<Bookmark[]> {
  const updated = (await loadBookmarks(documentId)).map(b =>
    b.id === bookmarkId ? { ...b, name: name.trim() || b.name } : b,
  );
  await persistBookmarks(documentId, updated);
  return updated;
}

export async function clearBookmarks(documentId: string): Promise<void> {
  try {
    await persistBookmarks(documentId, []);
  } catch {}
}
