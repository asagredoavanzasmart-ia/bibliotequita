// =============================================================================
// offlineBooks.ts — Descarga de libros para el modo sin conexión
// -----------------------------------------------------------------------------
// Guarda los archivos del libro (PDF/EPUB/portada) en el caché 'offline-books'
// del Cache Storage: el MISMO caché que el Service Worker (ver vite.config.ts,
// runtimeCaching de /api/files/*) consulta con estrategia CacheFirst. Así,
// cuando el lector pide el archivo sin conexión, el SW lo sirve desde aquí —
// incluidas las peticiones parciales (Range) de pdf.js, que Workbox recorta
// de la respuesta completa cacheada (rangeRequests: true).
//
// Solo son descargables las URLs del servidor propio ('/api/files/...').
// blob:/idb:// ya viven en el dispositivo y las URLs externas no son nuestras.
// =============================================================================

const CACHE_NAME = 'offline-books';

export function offlineSupported(): boolean {
  return typeof window !== 'undefined' && 'caches' in window && 'serviceWorker' in navigator;
}

export function isDownloadableUrl(url: string | undefined | null): url is string {
  return !!url && url.startsWith('/api/files/');
}

// URLs de un libro que tiene sentido cachear (PDF + EPUB + portada del server).
export function bookOfflineUrls(book: {
  pdfSource?: string;
  epubSource?: string;
  source?: string;
  thumbnailUrl?: string;
}): string[] {
  const urls = new Set<string>();
  for (const u of [book.pdfSource, book.epubSource, book.source, book.thumbnailUrl]) {
    if (isDownloadableUrl(u)) urls.add(u);
  }
  return Array.from(urls);
}

// Descarga y cachea todas las URLs del libro, informando el progreso global
// (0-100, ponderado por bytes cuando el servidor manda Content-Length).
export async function downloadBookOffline(
  urls: string[],
  onProgress?: (percent: number) => void,
): Promise<void> {
  if (!offlineSupported()) throw new Error('Este navegador no soporta almacenamiento sin conexión.');
  if (urls.length === 0) throw new Error('Este libro no tiene archivos en el servidor para descargar.');

  const cache = await caches.open(CACHE_NAME);
  const perFile: number[] = urls.map(() => 0); // fracción 0-1 por archivo
  const report = () => {
    if (!onProgress) return;
    const total = perFile.reduce((a, b) => a + b, 0) / urls.length;
    onProgress(Math.round(total * 100));
  };

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const response = await fetch(url, {credentials: 'include'});
    if (!response.ok) throw new Error(`No se pudo descargar ${url} (HTTP ${response.status}).`);

    const contentLength = Number(response.headers.get('content-length')) || 0;
    let body: Blob;
    if (response.body && contentLength > 0) {
      // Leer el stream a mano para poder reportar progreso real.
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;
      for (;;) {
        const {done, value} = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        perFile[i] = Math.min(1, received / contentLength);
        report();
      }
      body = new Blob(chunks as BlobPart[], {type: response.headers.get('content-type') || 'application/octet-stream'});
    } else {
      body = await response.blob();
    }

    // Respuesta completa (200) con sus cabeceras: es lo que Workbox necesita
    // para poder servir luego tanto el archivo entero como rangos parciales.
    const headers = new Headers();
    response.headers.forEach((v, k) => headers.set(k, v));
    headers.set('content-length', String(body.size));
    await cache.put(url, new Response(body, {status: 200, headers}));
    perFile[i] = 1;
    report();
  }
}

export async function removeBookOffline(urls: string[]): Promise<void> {
  if (!offlineSupported()) return;
  const cache = await caches.open(CACHE_NAME);
  await Promise.all(urls.map((u) => cache.delete(u)));
}

// true si TODAS las URLs del libro están cacheadas (descarga completa).
export async function isBookOffline(urls: string[]): Promise<boolean> {
  if (!offlineSupported() || urls.length === 0) return false;
  const cache = await caches.open(CACHE_NAME);
  const matches = await Promise.all(urls.map((u) => cache.match(u)));
  return matches.every((m) => !!m);
}
