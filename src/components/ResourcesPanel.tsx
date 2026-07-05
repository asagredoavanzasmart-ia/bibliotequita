// =============================================================================
// ResourcesPanel.tsx — Pestaña "Recursos" de un libro.
// -----------------------------------------------------------------------------
// Menú lateral por tipo (Videos, Audios, Textos, Imágenes). Permite subir,
// renombrar, borrar y reproducir/visualizar recursos. Los recursos de Texto
// se abren en el LECTOR PRINCIPAL (vía onOpenTextResource → ReaderView), que
// aporta el mismo motor de citas y lector de voz (TTS) que el libro; sus
// notas/citas viven separadas bajo documentId `<bookId>::res::<id>`.
// =============================================================================

import { useState, useRef } from 'react';
import { Video, Music, FileText, Image as ImageIcon, UploadCloud, Trash2, Play, Loader2, BookOpen, Link as LinkIcon, MessageSquareQuote, X, Download, ExternalLink as ExternalLinkIcon } from 'lucide-react';
import { cn } from '../lib/utils';
import { uploadFile } from '../lib/uploadFile';
import { useResources } from '../hooks/useResources';
import { useWakeLock } from '../hooks/useWakeLock';
import { useDocumentNotes } from '../hooks/useDocumentNotes';
import { ResourceItem, ResourceKind, ResourceType } from '../types';
import { NotesPanel } from './NotesPanel';
import { pdfjs } from 'react-pdf';
import ePub from 'epubjs';

interface ResourcesPanelProps {
  bookId: string;
  // Abre un recurso de texto en el lector principal (con TTS y citas).
  onOpenTextResource: (resource: ResourceItem) => void;
}

const KINDS: { id: ResourceKind; label: string; Icon: any; accept: string }[] = [
  { id: 'video', label: 'Videos', Icon: Video, accept: 'video/*' },
  { id: 'audio', label: 'Audios', Icon: Music, accept: 'audio/*' },
  { id: 'text', label: 'Textos', Icon: FileText, accept: '.pdf,.epub,.txt' },
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
function getVideoEmbedUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtube.com')) {
      const id = u.searchParams.get('v');
      if (id) return `https://www.youtube.com/embed/${id}`;
      const shortMatch = u.pathname.match(/^\/(shorts|embed)\/([^/?]+)/);
      if (shortMatch) return `https://www.youtube.com/embed/${shortMatch[2]}`;
    }
    if (u.hostname.includes('youtu.be')) {
      const id = u.pathname.slice(1);
      if (id) return `https://www.youtube.com/embed/${id}`;
    }
    if (u.hostname.includes('vimeo.com')) {
      const id = u.pathname.split('/').filter(Boolean).pop();
      if (id) return `https://player.vimeo.com/video/${id}`;
    }
  } catch {
    return null;
  }
  return null;
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

// Cada recurso (video/audio/imagen/texto) tiene sus propias notas, separadas
// de las del libro, vía documentId con sufijo "::res::<id>". El hook se
// instancia aquí (solo cuando el panel de notas de ESE recurso está abierto)
// para que NotesPanel siga siendo un componente de presentación puro.
function ResourceNotesPanel({ documentId }: { documentId: string }) {
  const { notes, addNote, addBookmark, editNote, deleteNote } = useDocumentNotes(documentId);
  return (
    <NotesPanel
      documentId={documentId}
      notes={notes}
      addNote={addNote}
      addBookmark={addBookmark}
      editNote={editNote}
      deleteNote={deleteNote}
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

  // Nº de medios (video/audio) reproduciéndose ahora mismo. Mientras haya
  // alguno, mantenemos la pantalla encendida para que el móvil no se bloquee.
  const [playingMediaCount, setPlayingMediaCount] = useState(0);
  useWakeLock(playingMediaCount > 0);
  const onMediaPlay = () => setPlayingMediaCount(c => c + 1);
  const onMediaPause = () => setPlayingMediaCount(c => Math.max(0, c - 1));
  const fileInputRef = useRef<HTMLInputElement>(null);

  const current = resources.filter((r) => r.kind === activeKind);
  const activeMeta = KINDS.find((k) => k.id === activeKind)!;

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadProgress(0);
    setUploadError(null);
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
      await addResource({ kind: 'video', title: url, source: url });
      setLinkValue('');
      setShowLinkInput(false);
    } catch (err) {
      console.error('Error añadiendo enlace de video:', err);
    }
  };

  const startRename = (r: ResourceItem) => { setRenamingId(r.id); setRenameValue(r.title); };
  const commitRename = (r: ResourceItem) => {
    const t = renameValue.trim();
    if (t && t !== r.title) updateResource(r.id, { title: t });
    setRenamingId(null);
  };

  return (
    <div className="w-full h-full flex bg-[var(--bg-app)] overflow-hidden">
      {/* Menú lateral de categorías */}
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

      {/* Contenido de la categoría activa */}
      <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
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
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold bg-[var(--primary)] text-white hover:bg-[var(--primary-hover)] disabled:opacity-60 transition-colors"
            >
              {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
              {uploading ? 'Subiendo…' : 'Subir'}
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
          <div className="flex items-center gap-2 mb-4">
            <input
              autoFocus
              value={linkValue}
              onChange={(e) => setLinkValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddLink(); }}
              placeholder="Pega un enlace de YouTube, Vimeo o video directo (.mp4)…"
              className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
            />
            <button onClick={handleAddLink} disabled={!linkValue.trim()} className="px-3 py-2 rounded-lg text-xs font-bold bg-[var(--primary)] text-white disabled:opacity-50 transition-colors">
              Añadir
            </button>
          </div>
        )}

        {current.length === 0 ? (
          <div className="text-center text-sm text-slate-400 py-16 border-2 border-dashed border-slate-200 rounded-xl">
            No hay {activeMeta.label.toLowerCase()} todavía. Pulsa «Subir» para añadir.
          </div>
        ) : (
          <div className={cn('grid gap-3', activeKind === 'image' ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4' : 'grid-cols-1')}>
            {current.map((r) => (
              <div key={r.id} className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm flex flex-col">
                {/* Vista/reproductor embebido por tipo */}
                {r.kind === 'video' && (
                  getVideoEmbedUrl(r.source) ? (
                    <div className="relative">
                      <iframe
                        src={getVideoEmbedUrl(r.source)!}
                        className="w-full aspect-video bg-black"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                      />
                      {/* YouTube/Vimeo a veces rechazan el embed dentro del WebView de la
                          app (Error 153 y similares: restricción del proveedor, no un bug
                          de la app). Como el iframe no avisa de forma fiable cuando falla,
                          se ofrece siempre este botón que abre el video en el navegador o
                          la app de YouTube real del dispositivo, donde sí funciona. */}
                      <button
                        type="button"
                        onClick={() => window.open(r.source, '_blank', 'noopener,noreferrer')}
                        className="absolute bottom-2 right-2 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-black/70 text-white hover:bg-black/85 transition-colors backdrop-blur-sm"
                      >
                        <ExternalLinkIcon className="w-3.5 h-3.5" /> Abrir en YouTube/navegador
                      </button>
                    </div>
                  ) : (
                    <video controls className="w-full max-h-72 bg-black" src={r.source} onPlay={onMediaPlay} onPause={onMediaPause} onEnded={onMediaPause} />
                  )
                )}
                {r.kind === 'audio' && (
                  <div className="p-3">
                    <audio controls className="w-full" src={r.source} onPlay={onMediaPlay} onPause={onMediaPause} onEnded={onMediaPause} />
                  </div>
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
                      <p className="text-[10px] uppercase text-slate-400 font-bold">{r.fileType} · leer · citar · escuchar</p>
                    </div>
                    <Play className="w-4 h-4 text-slate-400 shrink-0" />
                  </button>
                )}

                {/* Pie: título editable + notas + borrar */}
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
                      {r.title}
                    </span>
                  )}
                  {/* Texto: botón Play que abre el lector principal (allí se
                      cita y se activa el lector de voz). El icono de notas/citas
                      solo tiene sentido para video/audio/imagen, que no pasan
                      por el lector. */}
                  {r.kind === 'text' ? (
                    <button
                      onClick={() => onOpenTextResource(r)}
                      className="p-1 shrink-0 text-slate-400 hover:text-[var(--primary)] transition-colors"
                      title="Abrir en el lector (leer y escuchar)"
                    >
                      <Play className="w-4 h-4" />
                    </button>
                  ) : (
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

                {/* Panel de notas del recurso (documentId propio, separado del libro) */}
                {notesResourceId === r.id && (
                  <div className="border-t border-slate-100 h-72 flex flex-col">
                    <div className="flex items-center justify-between px-3 py-1.5 bg-slate-50 border-b border-slate-100 shrink-0">
                      <span className="text-[10px] font-bold uppercase text-slate-500">Notas</span>
                      <button onClick={() => setNotesResourceId(null)} className="p-0.5 text-slate-400 hover:text-slate-700">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="flex-1 overflow-hidden">
                      <ResourceNotesPanel documentId={`${bookId}::res::${r.id}`} />
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
