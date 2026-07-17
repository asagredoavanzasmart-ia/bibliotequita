// =============================================================================
// ResourcesPanel.tsx — Pestaña "Recursos" de un libro.
// -----------------------------------------------------------------------------
// Menú lateral por tipo (Videos, Audios, Textos, Imágenes), colapsable con la
// manija de la orilla. Permite subir, renombrar, borrar y reproducir recursos.
// Los recursos de Texto se abren en el LECTOR PRINCIPAL (onOpenTextResource →
// ReaderView); video/audio se reproducen aquí con controles propios
// (play/pausa y saltos de ±5s por tap / ±10s por doble tap) y cada recurso
// tiene modo PANTALLA COMPLETA (media + notas, sin menús).
//
// YouTube se controla vía postMessage con el protocolo de la IFrame Player
// API (enablejsapi=1): NO se carga el script externo iframe_api — el CSP del
// servidor solo permite script-src 'self', y además el protocolo de mensajes
// basta para play/pausa/seek/tiempo actual.
//
// Las notas de video/audio guardan la MARCA DE TIEMPO (segundos) del momento
// en que se crearon (via currentPage → pageReference) y al tocarlas el
// reproductor salta a ese segundo (onNavigateToPage → seekTo).
// =============================================================================

import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Video, Music, FileText, Image as ImageIcon, UploadCloud, Trash2, Play, Pause, Rewind, FastForward, Loader2, BookOpen, Link as LinkIcon, MessageSquareQuote, X, Download, Maximize2, Minimize2, ChevronLeft, ChevronRight, Volume1, Volume2, VolumeX, ClipboardPaste } from 'lucide-react';
import { cn } from '../lib/utils';
import { uploadFile, getMaxUploadMb } from '../lib/uploadFile';
import { useResources } from '../hooks/useResources';
import { useWakeLock } from '../hooks/useWakeLock';
import { useDocumentNotes } from '../hooks/useDocumentNotes';
import { ResourceItem, ResourceKind, ResourceType } from '../types';
import { NotesPanel } from './NotesPanel';
import { pdfjs } from 'react-pdf';
import ePub from 'epubjs';
import mammoth from 'mammoth';

interface ResourcesPanelProps {
  bookId: string;
  // Abre un recurso de texto en el lector principal (con TTS y citas).
  onOpenTextResource: (resource: ResourceItem) => void;
}

const KINDS: { id: ResourceKind; label: string; Icon: any; accept: string }[] = [
  { id: 'video', label: 'Videos', Icon: Video, accept: 'video/*' },
  { id: 'audio', label: 'Audios', Icon: Music, accept: 'audio/*' },
  { id: 'text', label: 'Textos', Icon: FileText, accept: '.pdf,.epub,.txt,.docx' },
  { id: 'image', label: 'Imágenes', Icon: ImageIcon, accept: 'image/*' },
];

function fileTypeFromName(name: string): ResourceType {
  const n = name.toLowerCase();
  if (n.endsWith('.pdf')) return 'pdf';
  if (n.endsWith('.epub')) return 'epub';
  return 'txt';
}

// Detecta YouTube/Vimeo en una URL de video y devuelve su URL de embed.
// Si no coincide con ninguno, se asume un archivo de video directo (.mp4 etc.)
// y se reproduce con <video> nativo.
//
// Parámetros del embed de YouTube (guía oficial de la IFrame API):
//  - playsinline=1: crítico en iOS/Safari — reproduce dentro del recuadro.
//  - rel=0: sugerencias solo del mismo canal.
//  - enablejsapi=1 + origin: habilita el puente postMessage con el que
//    nuestros controles mandan play/pausa/seek y reciben el tiempo actual.
function getVideoEmbedUrl(url: string): string | null {
  const origin = typeof window !== 'undefined' ? encodeURIComponent(window.location.origin) : '';
  // controls=0 + modestbranding + iv_load_policy=3 + disablekb: se ocultan
  // los controles nativos de YouTube, la marca, las anotaciones y el teclado.
  // La reproducción se maneja SOLO con nuestros controles (postMessage). fs=0
  // quita el botón de pantalla completa de YouTube (usamos el propio de la app).
  const ytEmbed = (id: string) => `https://www.youtube-nocookie.com/embed/${id}?playsinline=1&rel=0&enablejsapi=1&controls=0&modestbranding=1&iv_load_policy=3&disablekb=1&fs=0&origin=${origin}`;
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtube.com')) {
      const id = u.searchParams.get('v');
      if (id) return ytEmbed(id);
      const shortMatch = u.pathname.match(/^\/(shorts|embed)\/([^/?]+)/);
      if (shortMatch) return ytEmbed(shortMatch[2]);
    }
    if (u.hostname.includes('youtu.be')) {
      const id = u.pathname.slice(1);
      if (id) return ytEmbed(id);
    }
    if (u.hostname.includes('vimeo.com')) {
      const id = u.pathname.split('/').filter(Boolean).pop();
      if (id) return `https://player.vimeo.com/video/${id}?playsinline=1`;
    }
  } catch {
    return null;
  }
  return null;
}

const isYouTubeEmbed = (embedUrl: string | null) => !!embedUrl && embedUrl.includes('youtube');

// Miniatura para la galería de videos: YouTube expone una directo por ID
// (img.youtube.com, sin costo de decodificar el video). Vimeo y archivos
// directos (.mp4) no tienen una URL de miniatura pública sin llamar a su
// API o decodificar el archivo — esos casos se resuelven con un placeholder
// (icono) en vez de sumar una petición de red extra por cada tarjeta.
function getVideoThumbnailUrl(url: string): string | null {
  try {
    const u = new URL(url);
    let id: string | null = null;
    if (u.hostname.includes('youtube.com')) {
      id = u.searchParams.get('v');
      if (!id) {
        const m = u.pathname.match(/^\/(shorts|embed)\/([^/?]+)/);
        if (m) id = m[2];
      }
    } else if (u.hostname.includes('youtu.be')) {
      id = u.pathname.slice(1) || null;
    }
    return id ? `https://i.ytimg.com/vi/${id}/mqdefault.jpg` : null;
  } catch {
    return null;
  }
}

function formatTime(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}:${String(m % 60).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

// Extrae la portada de un PDF (primera página renderizada a canvas) o EPUB
// (book.coverUrl() de epubjs) y la sube al servidor. Best-effort: si falla,
// el recurso simplemente queda sin thumbnailUrl (no bloquea la subida).
async function extractCoverForResource(file: File, fileType: ResourceType): Promise<string | undefined> {
  try {
    if (fileType === 'pdf') {
      const buffer = await file.arrayBuffer();
      const pdf = await pdfjs.getDocument({ data: buffer }).promise;
      const page = await pdf.getPage(1);
      const viewport = page.getViewport({ scale: 1.0 });
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (!context) return undefined;
      canvas.height = viewport.height;
      canvas.width = viewport.width;
      await page.render({ canvasContext: context, viewport } as any).promise;
      const blob: Blob | null = await new Promise((res) => canvas.toBlob((b) => res(b), 'image/jpeg', 0.8));
      if (!blob) return undefined;
      const { url } = await uploadFile(blob, `cover-${Date.now()}.jpg`);
      return url;
    }
    if (fileType === 'epub') {
      const buffer = await file.arrayBuffer();
      const book = ePub(buffer);
      await book.ready;
      const coverBlobUrl = await book.coverUrl();
      if (!coverBlobUrl) return undefined;
      const coverBlob = await (await fetch(coverBlobUrl)).blob();
      const { url } = await uploadFile(coverBlob, `cover-${Date.now()}.jpg`);
      return url;
    }
  } catch (e) {
    console.warn('No se pudo extraer la portada del recurso:', e);
  }
  return undefined;
}

// API mínima que expone cada reproductor hacia el exterior (notas con marca
// de tiempo): leer el segundo actual y saltar a un segundo dado.
export interface MediaApi {
  getCurrentTime: () => number;
  seekTo: (seconds: number) => void;
}

// -----------------------------------------------------------------------------
// Controles de reproducción compartidos: [⏪] [play/pausa] [⏩] + tiempo.
// Un TAP en ⏪/⏩ salta 5s; DOBLE tap salta 10s (ventana de 260ms para
// distinguirlos, como pidió el usuario — mismo patrón que la app de YouTube).
// -----------------------------------------------------------------------------
function MediaControls({ playing, timeSec, durationSec, volume, onToggle, onSeekBy, onScrub, onVolume }: {
  playing: boolean;
  timeSec: number;
  durationSec: number;
  volume: number;
  onToggle: () => void;
  onSeekBy: (delta: number) => void;
  onScrub: (seconds: number) => void;
  onVolume: (v: number) => void;
}) {
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showVol, setShowVol] = useState(false);
  const handleSeekTap = (dir: 1 | -1) => {
    if (tapTimerRef.current) {
      // Segundo tap dentro de la ventana: es doble tap → 10s (se cancela el 5s pendiente).
      clearTimeout(tapTimerRef.current);
      tapTimerRef.current = null;
      onSeekBy(10 * dir);
    } else {
      tapTimerRef.current = setTimeout(() => {
        tapTimerRef.current = null;
        onSeekBy(5 * dir);
      }, 260);
    }
  };
  useEffect(() => () => { if (tapTimerRef.current) clearTimeout(tapTimerRef.current); }, []);

  const dur = durationSec > 0 ? durationSec : 0;
  const VolIcon = volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  return (
    <div className="flex flex-col gap-1.5 px-3 py-2 bg-slate-900/95 text-white">
      {/* Barra de tiempo movible: arrastrable, con el tiempo a cada lado. */}
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-mono tabular-nums text-white/80 min-w-[42px] text-right">{formatTime(timeSec)}</span>
        <input
          type="range"
          min={0}
          max={dur || 1}
          step={0.1}
          value={Math.min(timeSec, dur || 1)}
          disabled={dur === 0}
          onChange={(e) => onScrub(Number(e.target.value))}
          className="flex-1 h-1.5 accent-[var(--primary)] cursor-pointer disabled:opacity-40"
          title="Barra de tiempo"
        />
        <span className="text-[11px] font-mono tabular-nums text-white/50 min-w-[42px]">{dur > 0 ? formatTime(dur) : '--:--'}</span>
      </div>
      {/* Controles: retroceso, play/pausa, avance + volumen. */}
      <div className="flex items-center justify-center gap-2 relative">
        <button type="button" onClick={() => handleSeekTap(-1)} className="p-2 rounded-full hover:bg-white/15 active:scale-95 transition-all" title="Atrás: 1 tap = 5s · 2 taps = 10s">
          <Rewind className="w-5 h-5 fill-current" />
        </button>
        <button type="button" onClick={onToggle} className="p-2.5 rounded-full bg-white/15 hover:bg-white/25 active:scale-95 transition-all" title={playing ? 'Pausar' : 'Reproducir'}>
          {playing ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
        </button>
        <button type="button" onClick={() => handleSeekTap(1)} className="p-2 rounded-full hover:bg-white/15 active:scale-95 transition-all" title="Adelante: 1 tap = 5s · 2 taps = 10s">
          <FastForward className="w-5 h-5 fill-current" />
        </button>
        {/* Volumen: icono que despliega un deslizador (clic para silenciar). */}
        <div className="absolute right-0 flex items-center gap-1.5" onMouseEnter={() => setShowVol(true)} onMouseLeave={() => setShowVol(false)}>
          <button type="button" onClick={() => onVolume(volume === 0 ? 1 : 0)} className="p-2 rounded-full hover:bg-white/15 active:scale-95 transition-all" title="Volumen (clic para silenciar)">
            <VolIcon className="w-5 h-5" />
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            onChange={(e) => onVolume(Number(e.target.value))}
            className={cn('h-1.5 accent-[var(--primary)] cursor-pointer transition-all', showVol ? 'w-20 opacity-100' : 'w-0 opacity-0 sm:w-16 sm:opacity-100')}
            title="Volumen"
          />
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Reproductor unificado de video/audio con controles propios.
//  - YouTube: iframe + protocolo postMessage de la IFrame API (sin script
//    externo). El handshake {event:'listening'} suscribe a 'infoDelivery',
//    que trae currentTime y playerState continuamente.
//  - Archivo directo: <video>/<audio> nativos con refs.
// Publica su MediaApi en apiRef y el segundo actual (entero) en onTimeChange
// para que las notas guarden la marca de tiempo.
// -----------------------------------------------------------------------------
function MediaPlayer({ resource, kind, onPlayingChange, apiRef, onTimeChange, tall = false }: {
  resource: ResourceItem;
  kind: 'video' | 'audio';
  onPlayingChange: (playing: boolean) => void;
  apiRef?: React.MutableRefObject<MediaApi | null>;
  onTimeChange?: (seconds: number) => void;
  // true en pantalla completa: el video puede crecer más allá del aspect-video.
  tall?: boolean;
}) {
  const embedUrl = kind === 'video' ? getVideoEmbedUrl(resource.source) : null;
  const isYT = isYouTubeEmbed(embedUrl);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [timeSec, setTimeSec] = useState(0);
  const [durationSec, setDurationSec] = useState(0);
  const [volume, setVolumeState] = useState(1); // 0..1
  const timeRef = useRef(0);

  // Notificar reproducción (wake lock) solo en las TRANSICIONES reales.
  const prevPlayingRef = useRef(false);
  useEffect(() => {
    if (playing !== prevPlayingRef.current) {
      prevPlayingRef.current = playing;
      onPlayingChange(playing);
    }
  }, [playing, onPlayingChange]);
  // Al desmontar sonando, avisar la pausa para no dejar el wake lock tomado.
  useEffect(() => () => { if (prevPlayingRef.current) onPlayingChange(false); }, [onPlayingChange]);

  const setTimeThrottled = useCallback((t: number) => {
    timeRef.current = t;
    // Solo re-renderizar cuando cambia el segundo entero (infoDelivery llega
    // varias veces por segundo).
    setTimeSec(prev => (Math.floor(prev) === Math.floor(t) ? prev : Math.floor(t)));
    onTimeChange?.(Math.floor(t));
  }, [onTimeChange]);

  // --- Puente postMessage con el iframe de YouTube ---
  const ytPost = useCallback((func: string, args: unknown[] = []) => {
    iframeRef.current?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args }), '*');
  }, []);

  useEffect(() => {
    if (!isYT) return;
    const onMessage = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return;
      let data: any;
      try { data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch { return; }
      if (data?.event === 'infoDelivery' && data.info) {
        if (typeof data.info.currentTime === 'number') setTimeThrottled(data.info.currentTime);
        // playerState 1 = reproduciendo (tabla de estados de la IFrame API).
        if (typeof data.info.playerState === 'number') setPlaying(data.info.playerState === 1);
        // Duración y volumen para la barra de progreso y el control de volumen.
        if (typeof data.info.duration === 'number' && data.info.duration > 0) {
          setDurationSec(prev => (Math.abs(prev - data.info.duration) < 0.5 ? prev : data.info.duration));
        }
        if (typeof data.info.volume === 'number' && !data.info.muted) {
          setVolumeState(prev => (Math.abs(prev - data.info.volume / 100) < 0.02 ? prev : data.info.volume / 100));
        }
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [isYT, setTimeThrottled]);

  const ytHandshake = useCallback(() => {
    // Suscripción a los eventos del reproductor (infoDelivery). Se manda al
    // cargar el iframe; si el reproductor aún no está listo la ignora, así
    // que se repite una vez más a los 700ms por seguridad.
    const send = () => iframeRef.current?.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: resource.id, channel: 'widget' }), '*');
    send();
    setTimeout(send, 700);
  }, [resource.id]);

  // --- API pública (notas con marca de tiempo) ---
  const seekTo = useCallback((seconds: number) => {
    const t = Math.max(0, seconds);
    if (isYT) {
      ytPost('seekTo', [t, true]);
      ytPost('playVideo');
    } else if (mediaRef.current) {
      mediaRef.current.currentTime = t;
      mediaRef.current.play().catch(() => { /* autoplay bloqueado: queda posicionado */ });
    }
    setTimeThrottled(t);
  }, [isYT, ytPost, setTimeThrottled]);

  const toggle = useCallback(() => {
    if (isYT) {
      if (playing) ytPost('pauseVideo'); else ytPost('playVideo');
    } else if (mediaRef.current) {
      if (mediaRef.current.paused) mediaRef.current.play().catch(() => { /* bloqueado */ });
      else mediaRef.current.pause();
    }
  }, [isYT, playing, ytPost]);

  const seekBy = useCallback((delta: number) => {
    seekTo(timeRef.current + delta);
  }, [seekTo]);

  // Arrastre de la barra de progreso: reposiciona SIN forzar reproducción
  // (respeta si estaba en pausa).
  const scrubTo = useCallback((seconds: number) => {
    const t = Math.max(0, Math.min(durationSec || seconds, seconds));
    if (isYT) ytPost('seekTo', [t, true]);
    else if (mediaRef.current) mediaRef.current.currentTime = t;
    setTimeThrottled(t);
  }, [isYT, ytPost, setTimeThrottled, durationSec]);

  const setVolume = useCallback((v: number) => {
    const vol = Math.max(0, Math.min(1, v));
    if (isYT) { ytPost('unMute'); ytPost('setVolume', [Math.round(vol * 100)]); }
    else if (mediaRef.current) { mediaRef.current.muted = vol === 0; mediaRef.current.volume = vol; }
    setVolumeState(vol);
  }, [isYT, ytPost]);

  useEffect(() => {
    if (!apiRef) return;
    apiRef.current = { getCurrentTime: () => timeRef.current, seekTo };
    return () => { apiRef.current = null; };
  }, [apiRef, seekTo]);

  return (
    <div className="flex flex-col bg-black">
      {kind === 'video' ? (
        embedUrl ? (
          <iframe
            ref={iframeRef}
            src={embedUrl}
            onLoad={isYT ? ytHandshake : undefined}
            className={cn('w-full bg-black', tall ? 'flex-1 min-h-0 aspect-video max-h-[60dvh]' : 'aspect-video')}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            // YouTube exige un Referer con el origen para validar quién
            // incrusta; sin él responde "Video no disponible" (Error 153).
            referrerPolicy="strict-origin-when-cross-origin"
          />
        ) : (
          // Sin `controls` nativos: se usan SOLO nuestros controles (barra de
          // tiempo movible, volumen y saltos), igual que con YouTube.
          <video
            ref={(el) => { mediaRef.current = el; if (el) el.volume = volume; }}
            src={resource.source}
            className={cn('w-full bg-black', tall ? 'max-h-[60dvh]' : 'max-h-72')}
            playsInline
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
            onTimeUpdate={(e) => setTimeThrottled((e.target as HTMLVideoElement).currentTime)}
            onLoadedMetadata={(e) => setDurationSec((e.target as HTMLVideoElement).duration || 0)}
            onDurationChange={(e) => setDurationSec((e.target as HTMLVideoElement).duration || 0)}
            onVolumeChange={(e) => setVolumeState((e.target as HTMLVideoElement).volume)}
          />
        )
      ) : (
        <audio
          ref={(el) => { mediaRef.current = el; if (el) el.volume = volume; }}
          src={resource.source}
          className="w-full px-3 pt-3"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onTimeUpdate={(e) => setTimeThrottled((e.target as HTMLAudioElement).currentTime)}
          onLoadedMetadata={(e) => setDurationSec((e.target as HTMLAudioElement).duration || 0)}
          onDurationChange={(e) => setDurationSec((e.target as HTMLAudioElement).duration || 0)}
          onVolumeChange={(e) => setVolumeState((e.target as HTMLAudioElement).volume)}
        />
      )}
      {/* Controles propios: funcionan igual para YouTube (postMessage) y
          archivos directos (refs). Vimeo no habla el protocolo de YouTube ni
          expone refs, así que ahí no se muestran (el iframe trae los suyos). */}
      {(isYT || !embedUrl) && (
        <MediaControls
          playing={playing}
          timeSec={timeSec}
          durationSec={durationSec}
          volume={volume}
          onToggle={toggle}
          onSeekBy={seekBy}
          onScrub={scrubTo}
          onVolume={setVolume}
        />
      )}
    </div>
  );
}

// Cada recurso (video/audio/imagen/texto) tiene sus propias notas, separadas
// de las del libro, vía documentId con sufijo "::res::<id>". El hook se
// instancia aquí (solo cuando el panel de notas de ESE recurso está abierto)
// para que NotesPanel siga siendo un componente de presentación puro.
// currentPage = segundo actual del medio → las notas quedan con marca de
// tiempo; onNavigateToPage = seek → tocar la nota salta a ese momento.
function ResourceNotesPanel({ documentId, currentPage, onNavigateToPage, timeReferences }: {
  documentId: string;
  currentPage?: number | string;
  onNavigateToPage?: (page: number | string) => void;
  timeReferences?: boolean;
}) {
  const { notes, addNote, addBookmark, editNote, deleteNote } = useDocumentNotes(documentId);
  return (
    <NotesPanel
      documentId={documentId}
      notes={notes}
      addNote={addNote}
      addBookmark={addBookmark}
      editNote={editNote}
      deleteNote={deleteNote}
      currentPage={currentPage}
      onNavigateToPage={onNavigateToPage}
      timeReferences={timeReferences}
    />
  );
}

export function ResourcesPanel({ bookId, onOpenTextResource }: ResourcesPanelProps) {
  const { resources, addResource, updateResource, deleteResource } = useResources(bookId);
  const [activeKind, setActiveKind] = useState<ResourceKind>('video');
  const [uploading, setUploading] = useState(false);
  // Porcentaje real de subida (0-100). Los recursos multimedia pueden pesar
  // >10MB y tardar bastante; sin esto el usuario no tenía forma de saber si
  // seguía subiendo o se había quedado pegado.
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [notesResourceId, setNotesResourceId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkValue, setLinkValue] = useState('');
  const [linkName, setLinkName] = useState('');
  // Pegar texto ya copiado (en vez de subir un archivo): se guarda como un
  // recurso .txt más, mismo camino que cualquier otro texto.
  const [showPasteText, setShowPasteText] = useState(false);
  const [pasteTitle, setPasteTitle] = useState('');
  const [pasteContent, setPasteContent] = useState('');
  const [pastingText, setPastingText] = useState(false);
  // Menú lateral de tipos colapsable (manija con chevrón en la orilla).
  const [kindMenuOpen, setKindMenuOpen] = useState(true);
  // Pantalla completa del PANEL (mismo botón ⛶ que el resto de la app): el
  // panel entero se porta a un overlay sobre todo — desaparecen el menú
  // superior del lector y, colapsando la manija, también el lateral.
  const [panelFullscreen, setPanelFullscreen] = useState(false);

  // Nº de medios (video/audio) reproduciéndose ahora mismo. Mientras haya
  // alguno, mantenemos la pantalla encendida para que el móvil no se bloquee.
  const [playingMediaCount, setPlayingMediaCount] = useState(0);
  useWakeLock(playingMediaCount > 0);
  const handlePlayingChange = useCallback((playing: boolean) => {
    setPlayingMediaCount(c => Math.max(0, c + (playing ? 1 : -1)));
  }, []);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // API del reproductor activo + segundo actual, para las notas con marca de
  // tiempo. Hay un solo reproductor "con notas abiertas" a la vez (inline o
  // fullscreen), así que basta una referencia compartida.
  const mediaApiRef = useRef<MediaApi | null>(null);
  const [mediaTimeSec, setMediaTimeSec] = useState(0);

  // Videos: dos modos. GALERÍA (grid de miniaturas, reordenable arrastrando)
  // y REPRODUCCIÓN (clic en una miniatura → video + notas lado a lado, para
  // estudiar tomando apuntes mientras se mira). Al cambiar de pestaña de
  // tipo se sale de reproducción — evita quedar "atrapado" viendo un video
  // de otra categoría al volver a Videos.
  const [playingVideoId, setPlayingVideoId] = useState<string | null>(null);
  useEffect(() => { setPlayingVideoId(null); }, [activeKind]);
  const [draggedVideoIndex, setDraggedVideoIndex] = useState<number | null>(null);

  // Columnas video/notas SOLO en escritorio (pedido explícito): en móvil no
  // hay ancho de sobra para dos columnas, así que se apilan verticalmente
  // sin divisor arrastrable. `isDesktopSplit` refleja el viewport (no un
  // breakpoint CSS) porque el ancho de columna se aplica con estilo inline
  // en píxeles/porcentaje, no con clases.
  const [isDesktopSplit, setIsDesktopSplit] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 640);
  useEffect(() => {
    const onResize = () => setIsDesktopSplit(window.innerWidth >= 640);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Divisor arrastrable entre video y notas (solo escritorio): mismo
  // mecanismo de Pointer Events + setPointerCapture que el divisor
  // lector/notas de ReaderView (captura el puntero para que el arrastre no
  // se corte al pasar por encima del iframe/video).
  const [videoSplitRatio, setVideoSplitRatio] = useState(60); // % de ancho para el video
  const [isDraggingSplit, setIsDraggingSplit] = useState(false);
  const splitContainerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      if (!isDraggingSplit) return;
      const el = splitContainerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
      const p = (x / rect.width) * 100;
      setVideoSplitRatio(Math.min(80, Math.max(20, p))); // ninguna columna desaparece del todo
    };
    const onPointerUp = () => setIsDraggingSplit(false);
    if (isDraggingSplit) {
      document.addEventListener('pointermove', onPointerMove);
      document.addEventListener('pointerup', onPointerUp);
      document.addEventListener('pointercancel', onPointerUp);
      document.body.style.userSelect = 'none';
    } else {
      document.body.style.userSelect = '';
    }
    return () => {
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
      document.removeEventListener('pointercancel', onPointerUp);
      document.body.style.userSelect = '';
    };
  }, [isDraggingSplit]);
  const handleSplitPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* navegadores viejos */ }
    e.preventDefault();
    setIsDraggingSplit(true);
  }, []);

  // Orden manual persistido (listIndex, mismo campo que usa la biblioteca
  // principal para "Orden manual" en BookGrid). Se aplica a todos los tipos
  // por consistencia; por ahora solo Videos ofrece arrastrar para reordenar.
  const current = resources.filter((r) => r.kind === activeKind).sort((a, b) => (a.listIndex ?? 0) - (b.listIndex ?? 0));
  const activeMeta = KINDS.find((k) => k.id === activeKind)!;
  const playingResource = playingVideoId ? resources.find((r) => r.id === playingVideoId) ?? null : null;

  const handleVideoDragStart = (e: React.DragEvent, index: number) => {
    setDraggedVideoIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };
  const handleVideoDragOver = (e: React.DragEvent) => { e.preventDefault(); };
  const handleVideoDrop = (index: number) => {
    if (draggedVideoIndex === null || draggedVideoIndex === index) { setDraggedVideoIndex(null); return; }
    const items = [...current];
    const [moved] = items.splice(draggedVideoIndex, 1);
    items.splice(index, 0, moved);
    items.forEach((r, i) => { if ((r.listIndex ?? 0) !== i) updateResource(r.id, { listIndex: i }); });
    setDraggedVideoIndex(null);
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    let file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadProgress(0);
    setUploadError(null);

    // DOCX no tiene un lector propio en la app (a diferencia de PDF/EPUB/TXT):
    // se extrae el texto plano EN EL NAVEGADOR (mammoth, sin pasar por el
    // servidor) y se sube como .txt — mismo camino que cualquier otro recurso
    // de texto, sin agregar un lector nuevo para un formato más.
    if (activeKind === 'text' && file.name.toLowerCase().endsWith('.docx')) {
      try {
        const arrayBuffer = await file.arrayBuffer();
        const { value: text } = await mammoth.extractRawText({ arrayBuffer });
        if (!text.trim()) {
          setUploading(false);
          setUploadError('No se pudo extraer texto de este .docx (¿está vacío o son solo imágenes escaneadas?).');
          if (fileInputRef.current) fileInputRef.current.value = '';
          return;
        }
        file = new File([text], file.name.replace(/\.docx$/i, '.txt'), { type: 'text/plain' });
      } catch (err) {
        console.error('No se pudo convertir el .docx a texto:', err);
        setUploading(false);
        setUploadError('No se pudo leer este archivo .docx. Puede estar dañado o protegido con contraseña.');
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }
    }

    // Rechazar de inmediato archivos que superan el límite del servidor: sin
    // esto, el usuario esperaba minutos de subida para recibir un 413. La
    // DURACIÓN del audio/video no importa, solo el PESO: 1 hora de audio en
    // MP3/M4A son ~30-60 MB (entra de sobra); en WAV son ~600 MB (no entra).
    const maxMb = await getMaxUploadMb();
    const fileMb = file.size / (1024 * 1024);
    if (maxMb && fileMb > maxMb) {
      setUploading(false);
      setUploadError(
        `El archivo pesa ${Math.round(fileMb)} MB y el máximo es ${maxMb} MB. ` +
        (activeKind === 'audio'
          ? 'Convertilo a MP3 o M4A (1 hora ≈ 30-60 MB) y volvé a intentar.'
          : 'Probá con una versión más comprimida del archivo.'),
      );
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    try {
      const { url, mimeType } = await uploadFile(file, undefined, setUploadProgress);
      const fileType = activeKind === 'text' ? fileTypeFromName(file.name) : undefined;
      // Portada best-effort para PDF/EPUB (no bloquea la subida si falla).
      const thumbnailUrl = fileType === 'pdf' || fileType === 'epub'
        ? await extractCoverForResource(file, fileType)
        : undefined;
      await addResource({
        kind: activeKind,
        title: file.name.replace(/\.[^.]+$/, ''),
        source: url,
        mimeType,
        ...(fileType ? { fileType } : {}),
        ...(thumbnailUrl ? { thumbnailUrl } : {}),
      });
    } catch (err: any) {
      console.error('Error subiendo recurso:', err);
      setUploadError(err?.message || 'No se pudo subir el archivo. Verifica tu conexión e inténtalo de nuevo.');
    } finally {
      setUploading(false);
      setUploadProgress(0);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleAddLink = async () => {
    const url = linkValue.trim();
    if (!url) return;
    try {
      // El NOMBRE lo pone el usuario (pedido explícito). Si lo deja vacío, se
      // usa un título legible por defecto; la URL cruda nunca se muestra.
      let title = linkName.trim();
      if (!title) {
        title = 'Video';
        try { title = `Video de ${new URL(url).hostname.replace(/^www\./, '')}`; } catch { /* URL rara: título genérico */ }
      }
      await addResource({ kind: 'video', title, source: url });
      setLinkValue('');
      setLinkName('');
      setShowLinkInput(false);
    } catch (err) {
      console.error('Error añadiendo enlace de video:', err);
    }
  };

  // Texto ya copiado (de un PDF, una web, un mensaje) sin pasar por un
  // archivo: se sube como blob .txt y queda como cualquier otro recurso de
  // texto, con el mismo lector.
  const handleAddPastedText = async () => {
    const content = pasteContent.trim();
    if (!content) return;
    setPastingText(true);
    setUploadError(null);
    try {
      const title = pasteTitle.trim() || 'Texto pegado';
      const blob = new Blob([content], { type: 'text/plain' });
      const { url } = await uploadFile(blob, `${title}.txt`);
      await addResource({ kind: 'text', title, source: url, fileType: 'txt' });
      setPasteTitle('');
      setPasteContent('');
      setShowPasteText(false);
    } catch (err) {
      console.error('No se pudo guardar el texto pegado:', err);
      setUploadError('No se pudo guardar el texto. Verifica tu conexión e inténtalo de nuevo.');
    } finally {
      setPastingText(false);
    }
  };

  const startRename = (r: ResourceItem) => { setRenamingId(r.id); setRenameValue(r.title); };
  const commitRename = (r: ResourceItem) => {
    const t = renameValue.trim();
    if (t && t !== r.title) updateResource(r.id, { title: t });
    setRenamingId(null);
  };

  // En pantalla completa, el panel entero se porta a un overlay fijo sobre
  // toda la app (desaparece el menú superior del lector); vía portal para
  // escapar del stacking context del contenedor de pestañas.
  const panel = (
    <div className={cn('flex bg-[var(--bg-app)] overflow-hidden', panelFullscreen ? 'fixed inset-0 z-[9990]' : 'w-full h-full')}>
      {/* Menú lateral de categorías (colapsable) */}
      {kindMenuOpen && (
        <div className="w-16 sm:w-44 shrink-0 border-r border-slate-200 bg-white flex flex-col py-2">
          {KINDS.map(({ id, label, Icon }) => {
            const count = resources.filter((r) => r.kind === id).length;
            return (
              <button
                key={id}
                onClick={() => setActiveKind(id)}
                className={cn(
                  'flex items-center gap-3 px-3 sm:px-4 py-3 text-sm font-medium transition-colors border-l-2',
                  activeKind === id ? 'border-[var(--primary)] bg-[var(--primary)]/5 text-[var(--primary)]' : 'border-transparent text-slate-600 hover:bg-slate-50'
                )}
                title={label}
              >
                <Icon className="w-5 h-5 shrink-0" />
                <span className="hidden sm:inline truncate">{label}</span>
                {count > 0 && <span className="hidden sm:inline ml-auto text-[10px] font-bold bg-slate-200 text-slate-600 rounded-full px-1.5 py-0.5">{count}</span>}
              </button>
            );
          })}
        </div>
      )}

      {/* Manija para colapsar/expandir el menú de tipos: más área útil para
          el contenido en pantallas chicas. */}
      <button
        type="button"
        onClick={() => setKindMenuOpen(v => !v)}
        className="w-4 shrink-0 flex items-center justify-center bg-slate-100 hover:bg-slate-200 border-r border-slate-200 transition-colors"
        title={kindMenuOpen ? 'Ocultar menú de tipos' : 'Mostrar menú de tipos'}
      >
        {kindMenuOpen ? <ChevronLeft className="w-3.5 h-3.5 text-slate-500" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-500" />}
      </button>

      {/* Contenido de la categoría activa */}
      <div className={cn('flex-1', playingResource ? 'overflow-hidden flex flex-col' : 'overflow-y-auto p-4 custom-scrollbar')}>
        {activeKind === 'video' && playingResource ? (
          // ---------------------------------------------------------------
          // MODO REPRODUCCIÓN: video + notas para estudiar. En escritorio,
          // columnas lado a lado con divisor arrastrable; en móvil, apiladas
          // (sin divisor — no hay ancho de sobra para dos columnas).
          // ---------------------------------------------------------------
          <>
            <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-200 bg-white shrink-0">
              <button
                onClick={() => setPlayingVideoId(null)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold text-slate-600 hover:bg-slate-100 transition-colors shrink-0"
              >
                <ChevronLeft className="w-4 h-4" /> Galería
              </button>
              <span className="flex-1 min-w-0 truncate text-sm font-bold text-slate-800" title={playingResource.title}>
                {/^https?:\/\//i.test(playingResource.title) ? 'Video' : playingResource.title}
              </span>
              <button onClick={() => { if (confirm('¿Eliminar este video?')) { deleteResource(playingResource.id); setPlayingVideoId(null); } }} className="p-1.5 text-slate-400 hover:text-rose-500 shrink-0" title="Eliminar">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
            <div
              ref={splitContainerRef}
              className={cn('flex-1 min-h-0 overflow-hidden flex', isDesktopSplit ? 'flex-row' : 'flex-col')}
            >
              <div
                className={cn('flex flex-col shrink-0 bg-black', isDesktopSplit && 'min-h-0 h-full')}
                style={isDesktopSplit ? { width: `${videoSplitRatio}%` } : undefined}
              >
                <MediaPlayer
                  resource={playingResource}
                  kind="video"
                  onPlayingChange={handlePlayingChange}
                  apiRef={mediaApiRef}
                  onTimeChange={setMediaTimeSec}
                  tall
                />
              </div>
              {isDesktopSplit && (
                <div
                  onPointerDown={handleSplitPointerDown}
                  className="w-1.5 shrink-0 cursor-col-resize bg-slate-200 hover:bg-[var(--primary)] active:bg-[var(--primary)] transition-colors touch-none flex items-center justify-center"
                  title="Arrastrar para ajustar el ancho"
                >
                  <div className="w-0.5 h-8 rounded-full bg-white/60" />
                </div>
              )}
              <div className={cn('flex flex-col min-h-0', isDesktopSplit ? 'flex-1 h-full border-l border-slate-200' : 'flex-1 border-t border-slate-200')}>
                <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 border-b border-slate-100 shrink-0">
                  <MessageSquareQuote className="w-3.5 h-3.5 text-[var(--primary)]" />
                  <span className="text-[10px] font-bold uppercase text-slate-500">Notas</span>
                </div>
                <div className="flex-1 min-h-0 overflow-hidden">
                  <ResourceNotesPanel
                    documentId={`${bookId}::res::${playingResource.id}`}
                    currentPage={mediaTimeSec}
                    onNavigateToPage={(page) => mediaApiRef.current?.seekTo(Number(page) || 0)}
                    timeReferences
                  />
                </div>
              </div>
            </div>
          </>
        ) : (
        <>
        <div className="flex items-center justify-between mb-4 gap-2">
          <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
            <activeMeta.Icon className="w-5 h-5 text-[var(--primary)]" /> {activeMeta.label}
          </h3>
          <div className="flex items-center gap-2">
            {activeKind === 'video' && (
              <button
                onClick={() => setShowLinkInput((v) => !v)}
                className={cn('flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors', showLinkInput ? 'bg-[var(--primary)]/10 text-[var(--primary)] border-[var(--primary)]/30' : 'bg-white text-slate-600 border-slate-200 hover:border-[var(--primary)]/40')}
              >
                <LinkIcon className="w-4 h-4" /> Enlace
              </button>
            )}
            {activeKind === 'text' && (
              <button
                onClick={() => setShowPasteText((v) => !v)}
                className={cn('flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors', showPasteText ? 'bg-[var(--primary)]/10 text-[var(--primary)] border-[var(--primary)]/30' : 'bg-white text-slate-600 border-slate-200 hover:border-[var(--primary)]/40')}
              >
                <ClipboardPaste className="w-4 h-4" /> Pegar texto
              </button>
            )}
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold bg-[var(--primary)] text-white hover:bg-[var(--primary-hover)] disabled:opacity-60 transition-colors"
            >
              {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
              {uploading ? 'Subiendo…' : 'Subir'}
            </button>
            {/* Pantalla completa del panel (mismo botón ⛶ del resto de la app):
                oculta el menú superior del lector; el lateral se colapsa con
                su manija. */}
            <button
              onClick={() => setPanelFullscreen(v => !v)}
              className={cn('p-2 rounded-lg border transition-colors shrink-0', panelFullscreen ? 'bg-[var(--primary)] text-white border-[var(--primary)]' : 'bg-white text-slate-600 border-slate-200 hover:text-[var(--primary)] hover:border-[var(--primary)]/40')}
              title={panelFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
            >
              {panelFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
          </div>
          <input ref={fileInputRef} type="file" accept={activeMeta.accept} className="hidden" onChange={handleUpload} />
        </div>

        {/* Barra de progreso real de subida: los videos/audios pueden pesar
            >10MB y tardar — sin esto el usuario no sabía si seguía subiendo
            o se había quedado pegado. */}
        {uploading && (
          <div className="mb-4">
            <div className="flex items-center justify-between text-[11px] font-bold text-slate-500 mb-1">
              <span>Subiendo archivo…</span>
              <span>{uploadProgress}%</span>
            </div>
            <div className="w-full h-2 rounded-full bg-slate-200 overflow-hidden">
              <div
                className="h-full bg-[var(--primary)] rounded-full transition-all duration-200"
                style={{ width: `${Math.max(2, uploadProgress)}%` }}
              />
            </div>
          </div>
        )}

        {uploadError && (
          <div className="flex items-start justify-between gap-2 mb-4 px-3 py-2 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700">
            <span>{uploadError}</span>
            <button onClick={() => setUploadError(null)} className="shrink-0 text-rose-400 hover:text-rose-600">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {activeKind === 'video' && showLinkInput && (
          <div className="flex flex-col gap-2 mb-4">
            <input
              autoFocus
              value={linkValue}
              onChange={(e) => setLinkValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddLink(); }}
              placeholder="Pega un enlace de YouTube, Vimeo o video directo (.mp4)…"
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
            />
            <div className="flex items-center gap-2">
              <input
                value={linkName}
                onChange={(e) => setLinkName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAddLink(); }}
                placeholder="Nombre del video (cómo quieres que aparezca)…"
                className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
              />
              <button onClick={handleAddLink} disabled={!linkValue.trim()} className="px-3 py-2 rounded-lg text-xs font-bold bg-[var(--primary)] text-white disabled:opacity-50 transition-colors shrink-0">
                Añadir
              </button>
            </div>
          </div>
        )}

        {/* Pegar texto ya copiado (de un PDF, una web, un mensaje) en vez de
            subir un archivo: se guarda como un recurso .txt más. */}
        {activeKind === 'text' && showPasteText && (
          <div className="flex flex-col gap-2 mb-4">
            <input
              autoFocus
              value={pasteTitle}
              onChange={(e) => setPasteTitle(e.target.value)}
              placeholder="Título (cómo quieres que aparezca)…"
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
            />
            <textarea
              value={pasteContent}
              onChange={(e) => setPasteContent(e.target.value)}
              placeholder="Pega aquí el texto copiado…"
              rows={6}
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-[var(--primary)] resize-y"
            />
            <div className="flex justify-end">
              <button
                onClick={handleAddPastedText}
                disabled={!pasteContent.trim() || pastingText}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold bg-[var(--primary)] text-white disabled:opacity-50 transition-colors shrink-0"
              >
                {pastingText ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                {pastingText ? 'Guardando…' : 'Guardar texto'}
              </button>
            </div>
          </div>
        )}

        {activeKind === 'video' ? (
          // -----------------------------------------------------------------
          // GALERÍA de videos: grid de miniaturas, arrastrables para
          // reordenar (persistido en listIndex). Clic → modo reproducción.
          // -----------------------------------------------------------------
          current.length === 0 ? (
            <div className="text-center text-sm text-slate-400 py-16 border-2 border-dashed border-slate-200 rounded-xl">
              No hay videos todavía. Pulsa «Subir» o «Enlace» para añadir.
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {current.map((r, index) => {
                const thumb = getVideoThumbnailUrl(r.source);
                return (
                  <div
                    key={r.id}
                    draggable
                    onDragStart={(e) => handleVideoDragStart(e, index)}
                    onDragOver={handleVideoDragOver}
                    onDrop={() => handleVideoDrop(index)}
                    onDragEnd={() => setDraggedVideoIndex(null)}
                    onClick={() => setPlayingVideoId(r.id)}
                    className={cn(
                      'group relative bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm cursor-pointer hover:shadow-md hover:border-[var(--primary)]/40 transition-all',
                      draggedVideoIndex === index && 'opacity-40'
                    )}
                    title="Arrastrar para reordenar · clic para reproducir"
                  >
                    <div className="aspect-video bg-slate-800 relative flex items-center justify-center overflow-hidden">
                      {thumb ? (
                        <img src={thumb} alt={r.title} className="w-full h-full object-cover" loading="lazy" />
                      ) : (
                        <Video className="w-8 h-8 text-slate-500" />
                      )}
                      <div className="absolute inset-0 bg-black/10 group-hover:bg-black/25 transition-colors flex items-center justify-center">
                        <div className="w-9 h-9 rounded-full bg-white/90 flex items-center justify-center shadow group-hover:scale-110 transition-transform">
                          <Play className="w-4 h-4 text-slate-800 fill-current ml-0.5" />
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 px-2 py-1.5">
                      {renamingId === r.id ? (
                        <input
                          autoFocus
                          value={renameValue}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onBlur={() => commitRename(r)}
                          onKeyDown={(e) => { if (e.key === 'Enter') commitRename(r); if (e.key === 'Escape') setRenamingId(null); }}
                          className="flex-1 min-w-0 text-[11px] border border-slate-200 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
                        />
                      ) : (
                        <span
                          onClick={(e) => { e.stopPropagation(); startRename(r); }}
                          className="flex-1 min-w-0 text-[11px] text-slate-600 truncate cursor-text hover:text-slate-900"
                          title="Renombrar"
                        >
                          {/^https?:\/\//i.test(r.title) ? <span className="text-slate-400 italic">Video · toca para renombrar</span> : r.title}
                        </span>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); if (confirm('¿Eliminar este video?')) deleteResource(r.id); }}
                        className="p-1 text-slate-400 hover:text-rose-500 shrink-0"
                        title="Eliminar"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )
        ) : current.length === 0 ? (
          <div className="text-center text-sm text-slate-400 py-16 border-2 border-dashed border-slate-200 rounded-xl">
            No hay {activeMeta.label.toLowerCase()} todavía. Pulsa «Subir» para añadir.
          </div>
        ) : (
          <div className={cn('grid gap-3', activeKind === 'image' ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4' : 'grid-cols-1')}>
            {current.map((r) => (
              <div key={r.id} className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm flex flex-col">
                {/* Vista/reproductor embebido por tipo */}
                {(r.kind === 'video' || r.kind === 'audio') && (
                  <MediaPlayer
                    resource={r}
                    kind={r.kind}
                    onPlayingChange={handlePlayingChange}
                    apiRef={notesResourceId === r.id ? mediaApiRef : undefined}
                    onTimeChange={notesResourceId === r.id ? setMediaTimeSec : undefined}
                  />
                )}
                {r.kind === 'image' && (
                  <a href={r.source} target="_blank" rel="noreferrer" className="block aspect-square bg-slate-100">
                    <img src={r.source} alt={r.title} className="w-full h-full object-cover" />
                  </a>
                )}
                {r.kind === 'text' && (
                  <button onClick={() => onOpenTextResource(r)} className="flex items-center gap-3 p-3 hover:bg-slate-50 transition-colors text-left">
                    {r.thumbnailUrl ? (
                      <img src={r.thumbnailUrl} alt={r.title} className="w-10 h-14 rounded-md object-cover shrink-0 border border-slate-200" />
                    ) : (
                      <div className="w-10 h-10 rounded-lg bg-[var(--primary)]/10 flex items-center justify-center shrink-0">
                        <BookOpen className="w-5 h-5 text-[var(--primary)]" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-slate-800 truncate">{r.title}{r.isSummary && <span className="ml-2 text-[9px] uppercase font-bold text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded">Resumen</span>}</p>
                    </div>
                    <Play className="w-4 h-4 text-slate-400 shrink-0" />
                  </button>
                )}

                {/* Pie: título editable + pantalla completa + notas + borrar */}
                <div className="flex items-center gap-2 px-3 py-2 border-t border-slate-100">
                  {renamingId === r.id ? (
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={() => commitRename(r)}
                      onKeyDown={(e) => { if (e.key === 'Enter') commitRename(r); if (e.key === 'Escape') setRenamingId(null); }}
                      className="flex-1 min-w-0 text-xs border border-slate-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
                    />
                  ) : (
                    <span onClick={() => startRename(r)} className="flex-1 min-w-0 text-xs text-slate-600 truncate cursor-text hover:text-slate-900" title="Renombrar">
                      {/* Las URLs crudas como título no aportan nada: se
                          muestra un nombre genérico (tocar para renombrar). */}
                      {/^https?:\/\//i.test(r.title) ? <span className="text-slate-400 italic">Video · toca para renombrar</span> : r.title}
                    </span>
                  )}
                  {/* Texto: el único Play es el de la tarjeta (abre el lector
                      con el TTS listo); su pie queda solo con descargar y
                      eliminar. Video/audio/imagen conservan el botón de notas. */}
                  {r.kind !== 'text' && (
                    <button
                      onClick={() => setNotesResourceId(notesResourceId === r.id ? null : r.id)}
                      className={cn('p-1 shrink-0 transition-colors', notesResourceId === r.id ? 'text-[var(--primary)]' : 'text-slate-400 hover:text-[var(--primary)]')}
                      title="Notas de este recurso"
                    >
                      <MessageSquareQuote className="w-4 h-4" />
                    </button>
                  )}
                  {r.source.startsWith('/api/files/') && (
                    <a
                      href={r.source}
                      download={r.title}
                      target="_blank"
                      rel="noreferrer"
                      className="p-1 text-slate-400 hover:text-[var(--primary)] transition-colors shrink-0"
                      title="Descargar"
                    >
                      <Download className="w-4 h-4" />
                    </a>
                  )}
                  <button onClick={() => { if (confirm('¿Eliminar este recurso?')) deleteResource(r.id); }} className="p-1 text-slate-400 hover:text-rose-500 shrink-0" title="Eliminar">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                {/* Panel de notas del recurso (documentId propio, separado del
                    libro). Para video/audio, las notas guardan la marca de
                    tiempo actual y tocarlas salta a ese momento. */}
                {notesResourceId === r.id && (
                  <div className="border-t border-slate-100 h-72 flex flex-col">
                    <div className="flex items-center justify-between px-3 py-1.5 bg-slate-50 border-b border-slate-100 shrink-0">
                      <span className="text-[10px] font-bold uppercase text-slate-500">Notas</span>
                      <button onClick={() => setNotesResourceId(null)} className="p-0.5 text-slate-400 hover:text-slate-700">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="flex-1 overflow-hidden">
                      <ResourceNotesPanel
                        documentId={`${bookId}::res::${r.id}`}
                        currentPage={(r.kind === 'video' || r.kind === 'audio') ? mediaTimeSec : undefined}
                        onNavigateToPage={(r.kind === 'video' || r.kind === 'audio')
                          ? (page) => mediaApiRef.current?.seekTo(Number(page) || 0)
                          : undefined}
                        timeReferences={r.kind === 'video' || r.kind === 'audio'}
                      />
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        </>
        )}
      </div>

    </div>
  );

  return panelFullscreen ? createPortal(panel, document.body) : panel;
}
