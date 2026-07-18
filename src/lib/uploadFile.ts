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

// `onProgress` (0-100) usa XMLHttpRequest en vez de fetch porque fetch no
// expone el progreso de SUBIDA (solo de descarga) en ningún navegador — es
// la única forma de mostrar una barra real para archivos grandes (videos,
// audios de varios MB) que pueden tardar bastante en subir.
export async function uploadFile(
  file: File | Blob,
  fallbackName = "upload.bin",
  onProgress?: (percent: number) => void,
): Promise<UploadResult> {
  const form = new FormData();
  const name = (file instanceof File ? file.name : null) || fallbackName;
  form.append("file", file, name);

  if (!onProgress) {
    const res = await fetch("/api/upload", { method: "POST", credentials: "include", body: form });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const msg = data.error || res.statusText;
      const err: any = new Error(msg);
      err.code = data.code ?? null;
      throw err;
    }
    return res.json();
  }

  return new Promise<UploadResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload");
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let data: any = {};
      try { data = JSON.parse(xhr.responseText || "{}"); } catch { /* respuesta no-JSON */ }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data);
      } else {
        const err: any = new Error(data.error || xhr.statusText || "Error al subir el archivo");
        err.code = data.code ?? null;
        reject(err);
      }
    };
    // onerror = la conexión se cortó sin respuesta HTTP: típico de subidas
    // largas por datos móviles o del corte del proxy del hosting (Railway
    // aborta requests de más de ~5 minutos). Distinto de un 413 (tamaño),
    // que sí llega como respuesta y cae en onload.
    xhr.onerror = () => reject(new Error(
      "La subida se cortó antes de terminar. Suele pasar con archivos grandes en conexiones lentas: probá con WiFi o con un archivo más liviano (MP3/M4A pesan mucho menos que WAV).",
    ));
    xhr.send(form);
  });
}

// Límites de subida del servidor (MB), cacheados tras la primera consulta.
// null = no se pudo consultar (no bloquear la subida por eso). Los .wav
// tienen tope propio, más alto, porque el servidor los comprime a MP3 al
// recibirlos.
let _uploadLimits: { maxUploadMb: number | null; maxWavUploadMb: number | null } | undefined = undefined;
async function getUploadLimits() {
  if (_uploadLimits !== undefined) return _uploadLimits;
  try {
    const res = await fetch("/api/config");
    const data = res.ok ? await res.json() : {};
    const num = (v: unknown) => (typeof v === "number" && v > 0 ? v : null);
    _uploadLimits = { maxUploadMb: num(data.maxUploadMb), maxWavUploadMb: num(data.maxWavUploadMb) };
  } catch {
    _uploadLimits = { maxUploadMb: null, maxWavUploadMb: null };
  }
  return _uploadLimits;
}
export async function getMaxUploadMb(): Promise<number | null> {
  return (await getUploadLimits()).maxUploadMb;
}
export async function getMaxWavUploadMb(): Promise<number | null> {
  const { maxUploadMb, maxWavUploadMb } = await getUploadLimits();
  // Servidor viejo sin el campo: cae al tope general, nunca a "sin límite".
  return maxWavUploadMb ?? maxUploadMb;
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
