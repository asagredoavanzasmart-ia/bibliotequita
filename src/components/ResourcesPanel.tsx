// =============================================================================
// ResourcesPanel.tsx — Pestaña "Recursos" de un libro.
// -----------------------------------------------------------------------------
// Menú lateral por tipo (Videos, Audios, Textos, Imágenes). Permite subir,
// renombrar, borrar y reproducir/visualizar recursos. Los recursos de Texto
// abren el lector interno (PDF/EPUB/TXT) con su propio documentId para que el
// motor de citas funcione de forma separada al libro.
// =============================================================================

import { useState, useRef } from 'react';
import { Video, Music, FileText, Image as ImageIcon, UploadCloud, Trash2, Play, ChevronLeft, Loader2, BookOpen } from 'lucide-react';
import { cn } from '../lib/utils';
import { uploadFile } from '../lib/uploadFile';
import { useResources } from '../hooks/useResources';
import { ResourceItem, ResourceKind, ResourceType } from '../types';
import { PDFReader } from './PDFReader';
import { EPUBReader } from './EPUBReader';
import { TxtReader } from './TxtReader';

interface ResourcesPanelProps {
  bookId: string;
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

export function ResourcesPanel({ bookId }: ResourcesPanelProps) {
  const { resources, addResource, updateResource, deleteResource } = useResources(bookId);
  const [activeKind, setActiveKind] = useState<ResourceKind>('video');
  const [uploading, setUploading] = useState(false);
  const [openTextResource, setOpenTextResource] = useState<ResourceItem | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const current = resources.filter((r) => r.kind === activeKind);
  const activeMeta = KINDS.find((k) => k.id === activeKind)!;

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { url, mimeType } = await uploadFile(file);
      await addResource({
        kind: activeKind,
        title: file.name.replace(/\.[^.]+$/, ''),
        source: url,
        mimeType,
        ...(activeKind === 'text' ? { fileType: fileTypeFromName(file.name) } : {}),
      });
    } catch (err) {
      console.error('Error subiendo recurso:', err);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const startRename = (r: ResourceItem) => { setRenamingId(r.id); setRenameValue(r.title); };
  const commitRename = (r: ResourceItem) => {
    const t = renameValue.trim();
    if (t && t !== r.title) updateResource(r.id, { title: t });
    setRenamingId(null);
  };

  // --- Lector de un recurso de texto (citas separadas vía documentId con sufijo) ---
  if (openTextResource) {
    const docId = `${bookId}::res::${openTextResource.id}`;
    return (
      <div className="w-full h-full flex flex-col bg-[var(--bg-app)]">
        <div className="flex items-center gap-2 px-3 h-12 border-b border-slate-200 bg-white shrink-0">
          <button onClick={() => setOpenTextResource(null)} className="p-2 rounded-lg text-slate-500 hover:bg-slate-100" title="Volver a recursos">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="font-bold text-sm text-slate-800 truncate">{openTextResource.title}</span>
          <span className="text-[10px] uppercase font-bold text-[var(--primary)] bg-[var(--primary)]/10 px-1.5 py-0.5 rounded ml-auto shrink-0">{openTextResource.fileType}</span>
        </div>
        <div className="flex-1 overflow-hidden" data-resource-doc-id={docId}>
          {openTextResource.fileType === 'pdf' && <PDFReader url={openTextResource.source} />}
          {openTextResource.fileType === 'epub' && <EPUBReader url={openTextResource.source} />}
          {openTextResource.fileType === 'txt' && <TxtReader url={openTextResource.source} />}
        </div>
      </div>
    );
  }

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
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
            <activeMeta.Icon className="w-5 h-5 text-[var(--primary)]" /> {activeMeta.label}
          </h3>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold bg-[var(--primary)] text-white hover:bg-[var(--primary-hover)] disabled:opacity-60 transition-colors"
          >
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
            {uploading ? 'Subiendo…' : 'Subir'}
          </button>
          <input ref={fileInputRef} type="file" accept={activeMeta.accept} className="hidden" onChange={handleUpload} />
        </div>

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
                  <video controls className="w-full max-h-72 bg-black" src={r.source} />
                )}
                {r.kind === 'audio' && (
                  <div className="p-3">
                    <audio controls className="w-full" src={r.source} />
                  </div>
                )}
                {r.kind === 'image' && (
                  <a href={r.source} target="_blank" rel="noreferrer" className="block aspect-square bg-slate-100">
                    <img src={r.source} alt={r.title} className="w-full h-full object-cover" />
                  </a>
                )}
                {r.kind === 'text' && (
                  <button onClick={() => setOpenTextResource(r)} className="flex items-center gap-3 p-3 hover:bg-slate-50 transition-colors text-left">
                    <div className="w-10 h-10 rounded-lg bg-[var(--primary)]/10 flex items-center justify-center shrink-0">
                      <BookOpen className="w-5 h-5 text-[var(--primary)]" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-slate-800 truncate">{r.title}{r.isSummary && <span className="ml-2 text-[9px] uppercase font-bold text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded">Resumen</span>}</p>
                      <p className="text-[10px] uppercase text-slate-400 font-bold">{r.fileType} · abrir y citar</p>
                    </div>
                    <Play className="w-4 h-4 text-slate-400 shrink-0" />
                  </button>
                )}

                {/* Pie: título editable + borrar */}
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
                  <button onClick={() => { if (confirm('¿Eliminar este recurso?')) deleteResource(r.id); }} className="p-1 text-slate-400 hover:text-rose-500 shrink-0" title="Eliminar">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
