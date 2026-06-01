// =============================================================================
// uploadFile.ts — Helper único para subir archivos al backend
// -----------------------------------------------------------------------------
// Sustituye el viejo flujo `idb-keyval set('idb://...', file)`.
// Sube un archivo (PDF, EPUB, imagen) al endpoint /api/upload del servidor y
// devuelve la URL relativa pública que se puede guardar en BookItem.source
// o BookItem.thumbnailUrl.
//
// USO:
//   const url = await uploadFile(file);            // → "/api/files/<uuid>.pdf"
//   const url = await uploadFile(blob, 'cover.jpg'); // para Blobs sin nombre
//
// Si el upload falla por red, lanza un Error con mensaje legible para mostrar
// en un toast. El llamador decide qué hacer con el error.
// =============================================================================

export interface UploadResult {
  url: string;          // URL pública del archivo, p.ej. "/api/files/abc.pdf"
  name: string;         // nombre interno (uuid + extensión)
  originalName: string;
  size: number;
  mimeType: string;
}

export async function uploadFile(
  file: File | Blob,
  fallbackName = "upload.bin",
): Promise<UploadResult> {
  const form = new FormData();
  const name = (file instanceof File ? file.name : null) || fallbackName;
  form.append("file", file, name);

  const res = await fetch("/api/upload", { method: "POST", body: form });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Upload falló (${res.status}): ${detail || res.statusText}`);
  }
  return res.json();
}

// Token interno para DELETE — se obtiene del servidor al primer uso y se cachea.
let _deleteToken: string | null | undefined = undefined;
async function getDeleteToken(): Promise<string | null> {
  if (_deleteToken !== undefined) return _deleteToken;
  try {
    const res = await fetch("/api/config");
    if (!res.ok) { _deleteToken = null; return null; }
    const data = await res.json();
    _deleteToken = data.deleteToken ?? null;
  } catch {
    _deleteToken = null;
  }
  return _deleteToken;
}

// Borra un archivo del servidor a partir de su URL pública o de su nombre.
// Tolerante: nunca lanza, solo devuelve true/false.
export async function deleteUploadedFile(urlOrName: string): Promise<boolean> {
  if (!urlOrName) return false;
  // Solo intentamos borrar archivos servidos por nuestro propio backend.
  if (!urlOrName.startsWith("/api/files/")) return false;
  const name = urlOrName.replace(/^\/api\/files\//, "");
  try {
    const token = await getDeleteToken();
    const headers: Record<string, string> = {};
    if (token) headers["x-delete-token"] = token;
    const res = await fetch(`/api/files/${encodeURIComponent(name)}`, { method: "DELETE", headers });
    return res.ok;
  } catch {
    return false;
  }
}
