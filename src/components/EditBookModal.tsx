import React, { useState, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { BookItem, PlaylistData, StageData } from '../types';
import { X, Image as ImageIcon, Book, Link as LinkIcon, UploadCloud, CheckCircle2, BookmarkCheck, Library, Bookmark, Save, Plus, Trash2, ChevronRight, Layers, Pencil, ShoppingBag, Tag, Download } from 'lucide-react';
import { cn, colorSwatchProps } from '../lib/utils';
import { useLibrary } from '../hooks/useLibrary';
import { StarRating } from './StarRating';
import { DraggableProgress } from './BookGrid';
import { pdfjs } from 'react-pdf';
// Migrado de idb-keyval a almacenamiento real en el servidor (ver src/lib/uploadFile.ts).
import { uploadFile, deleteUploadedFile } from '../lib/uploadFile';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

interface EditBookModalProps {
  item: BookItem;
  onClose: () => void;
  onSave: (id: string, updates: Partial<BookItem>) => void;
  inline?: boolean;
}

export function EditBookModal({ item, onClose, onSave, inline = false }: EditBookModalProps) {
  const { playlists, categories, stages, addCategory, addPlaylist, deleteItem, items } = useLibrary();

  
  const [title, setTitle] = useState(item.title || '');
  const [author, setAuthor] = useState(item.author || '');
  const [year, setYear] = useState(item.year || '');
  const [subject, setSubject] = useState(item.subject || '');
  const [isbn, setIsbn] = useState(item.isbn || '');
  const [publisher, setPublisher] = useState(item.publisher || '');
  const [category, setCategory] = useState(item.category);
  const [progress, setProgress] = useState(item.progress || 0);
  const [read, setRead] = useState(item.read || false);

  // Estado/etapa de lectura por tramos, idéntico a la biblioteca principal
  // (ver progState en BookGrid): 0–25 Consultado · 26–50 En proceso ·
  // 51–99 Revisado · 100 / leído → Leído. Mismo color por tramo.
  const progState = useMemo(() => {
    if (read) return { text: 'Leído', color: 'bg-emerald-500' };
    const p = progress || 0;
    if (p <= 25) return { text: 'Consultado', color: 'bg-slate-500' };
    if (p <= 50) return { text: 'En proceso', color: 'bg-amber-500' };
    if (p < 100) return { text: 'Revisado', color: 'bg-blue-500' };
    return { text: 'Leído', color: 'bg-emerald-500' };
  }, [progress, read]);
  const pValue = read ? 100 : Math.min(100, Math.max(0, progress || 0));
  const [ownedPhysical, setOwnedPhysical] = useState(item.ownedPhysical || false);
  const [ownedDigital, setOwnedDigital] = useState(item.ownedDigital || false);
  const [toBuy, setToBuy] = useState(item.toBuy || false);
  const [folderIds, setFolderIds] = useState<string[]>(item.folderIds || []);
  const [stageIds, setStageIds] = useState<string[]>(item.stageIds || []);
  const [coverUrl, setCoverUrl] = useState(item.thumbnailUrl || '');
  const [type, setType] = useState(item.type || 'externa');
  const [rating, setRating] = useState(item.rating || 0);
  const [tags, setTags] = useState<string[]>(item.tags || []);
  const [tagInput, setTagInput] = useState('');
  const allExistingTags = Array.from(
    new Set(items.flatMap((i) => i.tags || []))
  ).filter((tag) => !tags.includes(tag));

  const addTag = (tagName: string) => {
    const trimmed = tagName.trim();
    if (trimmed && !tags.includes(trimmed)) {
      setTags(prev => [...prev, trimmed]);
    }
    setTagInput('');
  };

  const removeTag = (tagName: string) => {
    setTags(prev => prev.filter(t => t !== tagName));
  };
  
  const [digitalSource, setDigitalSource] = useState(item.source || '');
  // Slots independientes PDF/EPUB (retrocompatibles con source/type legacy).
  const [pdfSource, setPdfSource] = useState(
    item.pdfSource || (item.type === 'pdf' ? item.source : '') || ''
  );
  const [epubSource, setEpubSource] = useState(
    item.epubSource || (item.type === 'epub' ? item.source : '') || ''
  );
  const coverInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const epubInputRef = useRef<HTMLInputElement>(null);
  
  const [newCategoryName, setNewCategoryName] = useState('');
  const [showNewCategory, setShowNewCategory] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [showNewPlaylist, setShowNewPlaylist] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleSave = () => {
    // La fuente "principal" (source/type) se deriva para retrocompatibilidad:
    // si es externa se respeta el enlace; si no, se prioriza PDF y luego EPUB.
    let primarySource = item.source;
    let primaryType = type;
    if (type === 'externa') {
      primarySource = digitalSource;
      primaryType = 'externa';
    } else if (pdfSource) {
      primarySource = pdfSource;
      primaryType = 'pdf';
    } else if (epubSource) {
      primarySource = epubSource;
      primaryType = 'epub';
    } else if (digitalSource) {
      primarySource = digitalSource;
    }

    onSave(item.id, {
      title,
      author,
      year,
      subject,
      publisher,
      isbn,
      category,
      progress,
      read,
      ownedPhysical,
      ownedDigital,
      toBuy,
      folderIds,
      stageIds,
      source: primarySource,
      pdfSource: pdfSource || undefined,
      epubSource: epubSource || undefined,
      thumbnailUrl: coverUrl,
      type: primaryType,
      rating,
      tags,
    });
    onClose();
  };

  // Sube un archivo a un slot específico (PDF o EPUB), reemplazando el anterior.
  const handleSlotUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
    slot: 'pdf' | 'epub'
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const previous = slot === 'pdf' ? pdfSource : epubSource;
    const setSlot = slot === 'pdf' ? setPdfSource : setEpubSource;
    try {
      const { url } = await uploadFile(file);
      setSlot(url);
      if (previous?.startsWith('/api/files/')) deleteUploadedFile(previous);
    } catch (err) {
      console.error('Error subiendo archivo al servidor:', err);
      setSlot(URL.createObjectURL(file));
    }
    setOwnedDigital(true);
    if (slot === 'pdf') {
      const buffer = await file.arrayBuffer();
      await analyzePdfContent(buffer);
    }
    e.target.value = '';
  };

  const handleSlotRemove = (slot: 'pdf' | 'epub') => {
    const previous = slot === 'pdf' ? pdfSource : epubSource;
    if (previous?.startsWith('/api/files/')) deleteUploadedFile(previous);
    (slot === 'pdf' ? setPdfSource : setEpubSource)('');
  };

  const analyzeImageContent = async (base64Str: string) => {
      setIsAnalyzing(true);
      try {
        const response = await fetch('/api/analyze-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageBase64: base64Str })
        });
        if (response.ok) {
           const extracted = await response.json();
           if (extracted.title && !title) setTitle(extracted.title);
           if (extracted.author && !author) setAuthor(extracted.author);
        }
      } catch (error) {
         console.error("Error analyzing image:", error);
      } finally {
         setIsAnalyzing(false);
      }
  };

  const handleCoverUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Si había una portada previa subida a nuestro servidor, la limpiamos.
    const previousUrl = coverUrl;
    const previewUrl = URL.createObjectURL(file);
    setCoverUrl(previewUrl);
    try {
      const { url } = await uploadFile(file, `cover-${Date.now()}.jpg`);
      setCoverUrl(url);
      URL.revokeObjectURL(previewUrl);
      // Borrado oportunista de la portada anterior si estaba en el servidor.
      if (previousUrl?.startsWith('/api/files/')) {
        deleteUploadedFile(previousUrl);
      }
    } catch (err) {
      console.error('Error subiendo portada al servidor:', err);
    }
    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64Data = event.target?.result as string;
      if (base64Data) await analyzeImageContent(base64Data);
    };
    reader.readAsDataURL(file);
  };

  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const applyExtractedData = (extracted: any) => {
    if (extracted.title) setTitle(extracted.title);
    if (extracted.author) setAuthor(extracted.author);
    if (extracted.year) setYear(extracted.year);
    if (extracted.publisher) setPublisher(extracted.publisher);
    if (extracted.isbn) setIsbn(extracted.isbn);
    if (extracted.subject) setSubject(extracted.subject);
  };

  const analyzePdfContent = async (source: string | ArrayBuffer) => {
     setIsAnalyzing(true);
     let base64Cover: string | null = null;
     try {
       const loadingTask = typeof source === 'string' ? pdfjs.getDocument(source) : pdfjs.getDocument({ data: source });
       const pdf = await loadingTask.promise;
       
       if (!coverUrl) {
         try {
            const page = await pdf.getPage(1);
            const viewport = page.getViewport({ scale: 1.0 });
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            if (context) {
              canvas.height = viewport.height;
              canvas.width = viewport.width;
              await page.render({ canvasContext: context, viewport } as any).promise;
              
              // Guardamos temporalmente el base64 de la portada por si es un PDF escaneado
              base64Cover = canvas.toDataURL('image/jpeg', 0.8);

              // Auto-portada → blob → upload al servidor (no base64 en localStorage).
              const blob: Blob | null = await new Promise(res => canvas.toBlob(b => res(b), 'image/jpeg', 0.8));
              if (blob) {
                try {
                  const { url } = await uploadFile(blob, `cover-${Date.now()}.jpg`);
                  setCoverUrl(url);
                } catch (err) {
                  console.warn('No se pudo subir la auto-portada, uso preview local:', err);
                  setCoverUrl(URL.createObjectURL(blob));
                }
              }
            }
         } catch (e) {
            console.error("Cover extraction failed", e);
         }
       }

       const numPages = Math.min(pdf.numPages, 7);
       let fullText: string[] = [];
       for (let i = 1; i <= numPages; i++) {
         const textPage = await pdf.getPage(i);
         const textContent = await textPage.getTextContent();
         const pageText = textContent.items.map((item: any) => item.str).join(' ');
         fullText.push(pageText);
       }
       const textString = fullText.join(' \n').trim();

       // Si es un PDF escaneado (sin texto) y tenemos portada, analizamos la portada
       if (textString.length < 50 && base64Cover) {
         await analyzeImageContent(base64Cover);
         return;
       }

       const response = await fetch('/api/analyze-pdf', {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({ text: textString })
       });

       if (response.ok) {
         applyExtractedData(await response.json());
       }
     } catch (error) {
       console.log("PDF analysis failed, trying as webpage...", error);
       try {
         const response = await fetch('/api/analyze-url', {
           method: 'POST',
           headers: { 'Content-Type': 'application/json' },
           body: JSON.stringify({ url: digitalSource })
         });
         
         if (response.ok) {
           applyExtractedData(await response.json());
         }
       } catch (e) {
         console.error("URL analysis failed:", e);
       }
     } finally {
       setIsAnalyzing(false);
     }
  };

  const handleDigitalUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const name = file.name.toLowerCase();
    const isPdf = file.type.includes('pdf') || name.endsWith('.pdf');
    const isTxt = file.type.includes('text/plain') || name.endsWith('.txt');

    // Si había un archivo digital anterior en el servidor, lo eliminamos.
    const previousSource = digitalSource;

    try {
      const { url } = await uploadFile(file);
      setDigitalSource(url);
      if (previousSource?.startsWith('/api/files/')) {
        deleteUploadedFile(previousSource);
      }
    } catch (err) {
      console.error('Error subiendo archivo al servidor:', err);
      setDigitalSource(URL.createObjectURL(file));
    }

    setType(isPdf ? 'pdf' : isTxt ? 'txt' : 'epub');
    setOwnedDigital(true);

    if (isPdf) {
      const buffer = await file.arrayBuffer();
      await analyzePdfContent(buffer);
    }
  };

  const handleAnalyzeLink = async () => {
     if (!digitalSource) return;
     const proxyUrl = `/api/proxy-resource?url=${encodeURIComponent(digitalSource)}`;
     await analyzePdfContent(proxyUrl);
  };

  const toggleFolder = (id: string) => {
    setFolderIds(prev => prev.includes(id) ? prev.filter(f => f !== id) : [...prev, id]);
  };

  const toggleStage = (id: string) => {
    setStageIds(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]);
  };

  const modalContent = inline ? (
    // =====================================================================
    // Vista "Info / Metadatos" embebida en el ReaderView (tab 'edit').
    // Estructura: SCROLL ÚNICO. Sin h-full anidados ni dobles overflow-y.
    // Layout en 3 columnas en desktop; apilado en móvil.
    // =====================================================================
    <div className="bg-[var(--bg-app)] w-full min-h-full flex flex-col">
      <div className="flex-1 px-4 sm:px-6 md:px-8 py-6">
         <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-12 [@media(max-height:500px)]:grid-cols-12 gap-6 [@media(max-height:500px)]:gap-4">

            {/* ---------- Col 1: Portada + archivo + posesión ---------- */}
            <div className="md:col-span-4 [@media(max-height:500px)]:col-span-4 flex flex-col gap-4">
               {/* Portada con overlay hover */}
               <div className="relative group aspect-[3/4] bg-[var(--bg-card)] rounded-2xl border-2 border-dashed border-slate-200 overflow-hidden shadow-sm transition-all hover:border-[var(--primary)]/50">
                  {coverUrl ? (
                     <img src={coverUrl} alt={title || 'Cover'} className="w-full h-full object-cover" />
                  ) : (
                     <div className="w-full h-full flex flex-col items-center justify-center text-slate-400">
                        <ImageIcon className="w-12 h-12 mb-2 opacity-50" />
                        <span className="text-xs font-medium">Sin portada</span>
                     </div>
                  )}
                  {/* Acción rápida: icono de lápiz visible al hover */}
                  <button
                     type="button"
                     onClick={() => coverInputRef.current?.click()}
                     className="absolute top-2 right-2 w-9 h-9 rounded-full bg-white/95 text-[var(--primary)] shadow-md flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:scale-110 active:scale-95"
                     title="Cambiar portada"
                  >
                     <Pencil className="w-4 h-4" />
                  </button>
                  {/* Overlay completo con acciones secundarias */}
                  <div className="absolute inset-0 bg-slate-900/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2 pointer-events-none">
                     <button
                        type="button"
                        onClick={() => coverInputRef.current?.click()}
                        className="pointer-events-auto bg-white text-[var(--primary)] px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 shadow"
                     >
                        <UploadCloud className="w-4 h-4" /> Cambiar portada
                     </button>
                     {coverUrl && (
                        <button
                           type="button"
                           onClick={() => setCoverUrl('')}
                           className="pointer-events-auto text-rose-200 hover:text-white hover:bg-rose-500/80 px-3 py-1 rounded-lg text-xs font-bold transition-colors"
                        >
                           Quitar portada
                        </button>
                     )}
                  </div>
                  <input type="file" ref={coverInputRef} accept="image/*" className="hidden" onChange={handleCoverUpload} />
               </div>

               {/* Posesión: físico / digital / wishlist */}
               <div className="grid grid-cols-3 gap-2">
                  <button
                     type="button"
                     onClick={() => setOwnedPhysical(!ownedPhysical)}
                     className={cn(
                        'flex flex-col items-center justify-center gap-1 px-2 py-2.5 rounded-xl border text-xs font-bold transition-all',
                        ownedPhysical
                           ? 'bg-[var(--primary)]/10 border-[var(--primary)]/40 text-[var(--primary)]'
                           : 'bg-[var(--bg-card)] border-slate-200 text-slate-500 hover:border-slate-300'
                     )}
                  >
                     <Book className="w-4 h-4" /> Físico
                  </button>
                  <button
                     type="button"
                     onClick={() => setOwnedDigital(!ownedDigital)}
                     className={cn(
                        'flex flex-col items-center justify-center gap-1 px-2 py-2.5 rounded-xl border text-xs font-bold transition-all',
                        ownedDigital
                           ? 'bg-[var(--primary)]/10 border-[var(--primary)]/40 text-[var(--primary)]'
                           : 'bg-[var(--bg-card)] border-slate-200 text-slate-500 hover:border-slate-300'
                     )}
                  >
                     <BookmarkCheck className="w-4 h-4" /> Digital
                  </button>
                  <button
                     type="button"
                     onClick={() => setToBuy(!toBuy)}
                     className={cn(
                        'flex flex-col items-center justify-center gap-1 px-2 py-2.5 rounded-xl border text-xs font-bold transition-all',
                        toBuy
                           ? 'bg-amber-100 border-amber-300 text-amber-700'
                           : 'bg-[var(--bg-card)] border-slate-200 text-slate-500 hover:border-slate-300'
                     )}
                  >
                     <ShoppingBag className="w-4 h-4" /> Wishlist
                  </button>
               </div>

               {/* Slots independientes: PDF y EPUB pueden coexistir en el mismo libro */}
               <div className="grid grid-cols-2 gap-2">
                  {/* Slot PDF */}
                  <div className="flex flex-col gap-1.5">
                     {pdfSource ? (
                        <div className="p-2.5 bg-[var(--bg-card)] rounded-xl border border-[var(--primary)]/30 flex items-center gap-2">
                           <span className="text-[var(--primary)] font-bold text-[10px] uppercase shrink-0">PDF</span>
                           <span className="text-[10px] text-[var(--text-muted)] font-mono truncate flex-1 min-w-0">{pdfSource.split('/').pop()}</span>
                           {pdfSource.startsWith('/api/files/') && (
                              <a href={pdfSource} download={`${title || 'libro'}.pdf`} target="_blank" rel="noreferrer" className="text-slate-400 hover:text-[var(--primary)] shrink-0" title="Descargar PDF">
                                 <Download className="w-3.5 h-3.5" />
                              </a>
                           )}
                           <button type="button" onClick={() => handleSlotRemove('pdf')} className="text-slate-400 hover:text-red-500 shrink-0" title="Quitar PDF">
                              <X className="w-3.5 h-3.5" />
                           </button>
                        </div>
                     ) : (
                        <button
                           disabled={isAnalyzing}
                           type="button"
                           onClick={() => pdfInputRef.current?.click()}
                           className={cn('px-3 py-2.5 flex items-center justify-center gap-1.5 rounded-xl text-xs font-bold border transition-colors',
                              isAnalyzing ? 'bg-slate-100 text-slate-400 border-slate-200 opacity-70' : 'bg-[var(--primary)]/10 text-[var(--primary)] border-[var(--primary)]/30 hover:bg-[var(--primary)]/20')}
                        >
                           <UploadCloud className={cn('w-4 h-4', isAnalyzing && 'animate-pulse')} /> PDF
                        </button>
                     )}
                     <input type="file" ref={pdfInputRef} onChange={(e) => handleSlotUpload(e, 'pdf')} accept=".pdf" className="hidden" />
                  </div>
                  {/* Slot EPUB */}
                  <div className="flex flex-col gap-1.5">
                     {epubSource ? (
                        <div className="p-2.5 bg-[var(--bg-card)] rounded-xl border border-[var(--primary)]/30 flex items-center gap-2">
                           <span className="text-[var(--primary)] font-bold text-[10px] uppercase shrink-0">EPUB</span>
                           <span className="text-[10px] text-[var(--text-muted)] font-mono truncate flex-1 min-w-0">{epubSource.split('/').pop()}</span>
                           {epubSource.startsWith('/api/files/') && (
                              <a href={epubSource} download={`${title || 'libro'}.epub`} target="_blank" rel="noreferrer" className="text-slate-400 hover:text-[var(--primary)] shrink-0" title="Descargar EPUB">
                                 <Download className="w-3.5 h-3.5" />
                              </a>
                           )}
                           <button type="button" onClick={() => handleSlotRemove('epub')} className="text-slate-400 hover:text-red-500 shrink-0" title="Quitar EPUB">
                              <X className="w-3.5 h-3.5" />
                           </button>
                        </div>
                     ) : (
                        <button
                           type="button"
                           onClick={() => epubInputRef.current?.click()}
                           className="px-3 py-2.5 flex items-center justify-center gap-1.5 rounded-xl text-xs font-bold border transition-colors bg-[var(--primary)]/10 text-[var(--primary)] border-[var(--primary)]/30 hover:bg-[var(--primary)]/20"
                        >
                           <UploadCloud className="w-4 h-4" /> EPUB
                        </button>
                     )}
                     <input type="file" ref={epubInputRef} onChange={(e) => handleSlotUpload(e, 'epub')} accept=".epub" className="hidden" />
                  </div>
               </div>

               {/* Enlace externo */}
               <div className="flex flex-col gap-2">
                  <input type="file" ref={fileInputRef} onChange={handleDigitalUpload} accept=".txt" className="hidden" />
                  <div className="relative">
                     {type === 'externa' ? (
                        <>
                           <input
                              type="text"
                              value={digitalSource}
                              onChange={e => {
                                 setDigitalSource(e.target.value);
                                 if (e.target.value) { setType('externa'); setOwnedDigital(true); }
                              }}
                              className="w-full text-xs pl-8 pr-20 py-2 bg-[var(--bg-card)] border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-[var(--primary)] text-[var(--text-main)] placeholder-slate-400"
                              placeholder="…o pegar enlace externo"
                           />
                           <LinkIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)]" />
                           {digitalSource && (
                              <button
                                 type="button"
                                 onClick={handleAnalyzeLink}
                                 disabled={isAnalyzing}
                                 className="absolute right-1 top-1 bottom-1 px-2 text-[10px] font-bold bg-[var(--primary)]/10 text-[var(--primary)] rounded hover:bg-[var(--primary)]/20"
                              >
                                 {isAnalyzing ? '…' : 'Analizar'}
                              </button>
                           )}
                        </>
                     ) : (
                        <div className="flex items-center justify-between p-2.5 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-xs text-emerald-600 font-medium shadow-sm transition-all animate-in fade-in">
                           <span className="flex items-center gap-1 truncate">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                              Archivo {type.toUpperCase()} cargado
                           </span>
                           <button 
                              type="button" 
                              onClick={() => {
                                 setDigitalSource('');
                                 setType('externa');
                                 setOwnedDigital(false);
                              }}
                              className="text-rose-500 hover:text-rose-700 font-bold ml-2 shrink-0 transition-colors"
                           >
                              Eliminar
                           </button>
                        </div>
                     )}
                  </div>
               </div>
            </div>

            {/* ---------- Col 2: Metadatos principales ---------- */}
            <div className="md:col-span-5 [@media(max-height:500px)]:col-span-5 flex flex-col gap-4">
               <div>
                  <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1 block">Título</label>
                  <input
                     type="text"
                     value={title}
                     onChange={e => setTitle(e.target.value)}
                     className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-base font-medium"
                  />
               </div>

               <div className="grid grid-cols-2 gap-3">
                  <div>
                     <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1 block">Autor</label>
                     <input
                        type="text"
                        value={author}
                        onChange={e => setAuthor(e.target.value)}
                        className="w-full px-4 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                     />
                  </div>
                  <div>
                     <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1 block">Año</label>
                     <input
                        type="text"
                        value={year}
                        onChange={e => setYear(e.target.value)}
                        className="w-full px-4 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                        placeholder="Ej. 1954"
                     />
                  </div>
               </div>

               <div>
                  <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1 block">Materia / Editorial</label>
                  <input
                     type="text"
                     value={subject}
                     onChange={e => setSubject(e.target.value)}
                     className="w-full px-4 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-[var(--text-main)]"
                     placeholder="Ej. Filosofía, Ed. Planeta"
                  />
               </div>

               <div className="grid grid-cols-2 gap-3">
                  <div>
                     <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1 block">Editorial</label>
                     <input
                        type="text"
                        value={publisher}
                        onChange={e => setPublisher(e.target.value)}
                        className="w-full px-4 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-[var(--text-main)]"
                        placeholder="Ej. Planeta"
                     />
                  </div>
                  <div>
                     <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1 block">ISBN</label>
                     <input
                        type="text"
                        value={isbn}
                        onChange={e => setIsbn(e.target.value)}
                        className="w-full px-4 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-[var(--text-main)]"
                        placeholder="Ej. 978-3-16-148410-0"
                     />
                  </div>
               </div>

               {/* Valoración por estrellas */}
               <div>
                  <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1.5 block">Valoración</label>
                  <div className="flex items-center gap-1 bg-[var(--bg-card)] border border-slate-200/50 px-3 py-2.5 rounded-2xl w-fit shadow-sm">
                     <StarRating value={rating} onChange={setRating} size="md" />
                  </div>
               </div>

               {/* Etiquetas (Tags) */}
               <div>
                  <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1.5 block">Etiquetas</label>
                  <div className="bg-[var(--bg-card)] border border-slate-200 rounded-2xl p-3 flex flex-col gap-2.5 shadow-sm">
                     <div className="flex gap-2">
                        <input
                           type="text"
                           value={tagInput}
                           onChange={(e) => setTagInput(e.target.value)}
                           onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                 e.preventDefault();
                                 addTag(tagInput);
                              }
                           }}
                           list="edit-tags-suggestions"
                           className="flex-1 text-xs px-3 py-2 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-[var(--primary)] text-[var(--text-main)] placeholder-slate-400"
                           placeholder="Nueva etiqueta y Enter..."
                        />
                        <datalist id="edit-tags-suggestions">
                           {allExistingTags.map((tag) => (
                              <option key={tag} value={tag} />
                           ))}
                        </datalist>
                        <button
                           type="button"
                           onClick={() => addTag(tagInput)}
                           className="bg-[var(--primary)] text-white px-3 py-2 rounded-xl text-xs font-bold hover:opacity-90 active:scale-95 transition-all"
                        >
                           +
                        </button>
                     </div>
                     <div className="flex flex-wrap gap-1.5 min-h-[1.5rem]">
                        {tags.map((tag) => (
                           <span
                              key={tag}
                              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100 border border-slate-200 text-[10px] font-bold text-slate-600 transition-all hover:bg-slate-200"
                           >
                              <Tag className="w-2.5 h-2.5 text-slate-400" />
                              {tag}
                              <button
                                 type="button"
                                 onClick={() => removeTag(tag)}
                                 className="text-slate-400 hover:text-rose-500 font-bold ml-0.5 text-xs focus:outline-none cursor-pointer"
                                 title="Quitar"
                              >
                                 ×
                              </button>
                           </span>
                        ))}
                        {tags.length === 0 && (
                           <span className="text-[10px] text-[var(--text-muted)] italic py-0.5">Sin etiquetas</span>
                        )}
                     </div>
                  </div>
               </div>

               {/* Categoría (chips visibles, no select) */}
               <div>
                  <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2 flex items-center justify-between">
                     <span>Categoría</span>
                     <button
                        type="button"
                        onClick={() => setShowNewCategory(!showNewCategory)}
                        className="p-0.5 hover:bg-slate-200 rounded text-slate-400 hover:text-[var(--primary)] transition-colors"
                        title="Nueva categoría"
                     >
                        <Plus className="w-3 h-3" />
                     </button>
                  </label>
                  {showNewCategory && (
                     <div className="flex gap-2 mb-2">
                        <input
                           autoFocus
                           value={newCategoryName}
                           onChange={e => setNewCategoryName(e.target.value)}
                           onKeyDown={e => {
                              if (e.key === 'Enter') {
                                 e.preventDefault();
                                 if (newCategoryName.trim()) {
                                    addCategory({ name: newCategoryName.trim() });
                                    setNewCategoryName('');
                                    setShowNewCategory(false);
                                 }
                              }
                           }}
                           className="flex-1 text-sm px-3 py-1.5 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
                           placeholder="Nombre…"
                        />
                        <button
                           type="button"
                           onClick={() => {
                              if (newCategoryName.trim()) {
                                 addCategory({ name: newCategoryName.trim() });
                                 setNewCategoryName('');
                                 setShowNewCategory(false);
                              }
                           }}
                           className="bg-[var(--primary)] text-white px-3 py-1.5 rounded-lg text-sm font-bold"
                        >
                           Añadir
                        </button>
                     </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                     {categories.map(c => (
                        <button
                           key={c.id}
                           type="button"
                           onClick={() => setCategory(c.id)}
                           className={cn(
                              'px-3 py-1.5 rounded-lg text-xs font-bold border transition-all',
                              category === c.id
                                 ? 'bg-[var(--primary)] text-white border-[var(--primary)] shadow-sm'
                                 : 'bg-[var(--bg-card)] text-[var(--text-muted)] border-slate-200 hover:border-[var(--primary)]/50'
                           )}
                        >
                           {c.name}
                        </button>
                     ))}
                  </div>
               </div>

               {/* Progreso de lectura — mismo estilo que la biblioteca (etapa + color por tramo) */}
               <div className="bg-[var(--bg-card)] border border-slate-200 rounded-2xl p-4">
                  <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-3 flex items-center justify-between">
                     <span>Progreso de lectura</span>
                     <span className="flex items-center gap-2">
                        <span className={cn('text-[10px] font-bold text-white px-2 py-0.5 rounded-md', progState.color)}>{progState.text}</span>
                        <span className="font-mono text-[var(--primary)] bg-[var(--primary)]/10 px-2 py-0.5 rounded-md text-xs">{pValue}%</span>
                     </span>
                  </label>
                  <div className="flex items-center gap-3">
                     <DraggableProgress
                        value={pValue}
                        color={progState.color}
                        onChange={(v) => { setProgress(v); if (read && v < 100) setRead(false); }}
                     />
                     <button
                        type="button"
                        onClick={() => { setRead(!read); if (!read) setProgress(100); }}
                        className={cn(
                           'p-2 rounded-xl transition-all shadow-sm shrink-0',
                           read
                              ? 'bg-emerald-500 text-white'
                              : 'bg-slate-100 text-slate-400 hover:bg-slate-200 hover:text-emerald-500'
                        )}
                        title={read ? 'Marcar como no leído' : 'Marcar como leído'}
                     >
                        <CheckCircle2 className="w-5 h-5" />
                     </button>
                  </div>
               </div>
            </div>

            {/* ---------- Col 3: Listas + Etapas ---------- */}
            <div className="md:col-span-3 [@media(max-height:500px)]:col-span-3 flex flex-col gap-4">
               {/* Listas / Playlists */}
               <div className="bg-[var(--bg-card)] border border-slate-200 rounded-2xl p-4">
                  <div className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-3 flex items-center justify-between">
                     <span className="flex items-center gap-1.5"><Library className="w-3.5 h-3.5" /> Mis listas</span>
                     <button
                        type="button"
                        onClick={() => setShowNewPlaylist(!showNewPlaylist)}
                        className="p-0.5 hover:bg-slate-200 rounded text-slate-400 hover:text-[var(--primary)]"
                        title="Nueva lista"
                     >
                        <Plus className="w-3 h-3" />
                     </button>
                  </div>
                  {showNewPlaylist && (
                     <div className="flex gap-2 mb-2">
                        <input
                           autoFocus
                           value={newPlaylistName}
                           onChange={e => setNewPlaylistName(e.target.value)}
                           onKeyDown={e => {
                              if (e.key === 'Enter') {
                                 e.preventDefault();
                                 if (newPlaylistName.trim()) {
                                    addPlaylist({ name: newPlaylistName.trim(), color: 'bg-slate-800' });
                                    setNewPlaylistName('');
                                    setShowNewPlaylist(false);
                                 }
                              }
                           }}
                           className="flex-1 text-xs px-2 py-1.5 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
                           placeholder="Nombre…"
                        />
                        <button
                           type="button"
                           onClick={() => {
                              if (newPlaylistName.trim()) {
                                 addPlaylist({ name: newPlaylistName.trim(), color: 'bg-slate-800' });
                                 setNewPlaylistName('');
                                 setShowNewPlaylist(false);
                              }
                           }}
                           className="bg-[var(--primary)] text-white px-2 py-1.5 rounded-lg text-xs font-bold"
                        >
                           +
                        </button>
                     </div>
                  )}
                  <div className="flex flex-col gap-1.5 max-h-44 overflow-y-auto pr-1">
                     {playlists.length === 0 && (
                        <div className="text-xs text-[var(--text-muted)] italic py-2">No tienes listas aún.</div>
                     )}
                     {playlists.map(pl => {
                        const checked = folderIds.includes(pl.id);
                        return (
                           <button
                              key={pl.id}
                              type="button"
                              onClick={() => toggleFolder(pl.id)}
                              className={cn(
                                 'flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors text-left',
                                 checked
                                    ? 'bg-[var(--primary)]/10 border-[var(--primary)]/40 text-[var(--text-main)]'
                                    : 'bg-transparent border-transparent text-[var(--text-muted)] hover:bg-slate-100'
                              )}
                           >
                              <span className={cn('w-2.5 h-2.5 rounded-full shrink-0', colorSwatchProps(pl.color).className)} style={colorSwatchProps(pl.color).style} />
                              <span className="flex-1 truncate">{pl.name}</span>
                              {checked && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />}
                           </button>
                        );
                     })}
                  </div>
               </div>

               {/* Etapas históricas */}
               <div className="bg-[var(--bg-card)] border border-slate-200 rounded-2xl p-4">
                  <div className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-3 flex items-center gap-1.5">
                     <Layers className="w-3.5 h-3.5" /> Etapas históricas
                  </div>
                  <div className="flex flex-col gap-1.5">
                     {stages.map(st => {
                        const checked = stageIds.includes(st.id);
                        return (
                           <button
                              key={st.id}
                              type="button"
                              onClick={() => toggleStage(st.id)}
                              className={cn(
                                 'flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors text-left',
                                 checked
                                    ? 'bg-[var(--primary)]/10 border-[var(--primary)]/40 text-[var(--text-main)]'
                                    : 'bg-transparent border-transparent text-[var(--text-muted)] hover:bg-slate-100'
                              )}
                           >
                              <span className="flex-1 truncate">{st.name}</span>
                              {checked && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />}
                           </button>
                        );
                     })}
                  </div>
               </div>
            </div>
         </div>
      </div>

      {/* Footer fijo: eliminar (izq), guardar (der) */}
      <div className="sticky bottom-0 z-10 p-4 bg-[var(--bg-card)]/95 backdrop-blur-md border-t border-slate-200 flex items-center justify-between gap-3">
         {showDeleteConfirm ? (
            <div className="flex items-center gap-2">
               <span className="text-xs font-bold text-rose-500">¿Eliminar definitivamente?</span>
               <button onClick={() => { deleteItem(item.id); onClose(); }} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-rose-500 text-white hover:bg-rose-600">Sí, eliminar</button>
               <button onClick={() => setShowDeleteConfirm(false)} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-200 text-slate-600 hover:bg-slate-300">Cancelar</button>
            </div>
         ) : (
            <button onClick={() => setShowDeleteConfirm(true)} className="px-3 py-1.5 rounded-xl text-sm font-bold text-rose-500 hover:bg-rose-5 flex items-center gap-2">
               <Trash2 className="w-4 h-4" /> Eliminar libro
            </button>
         )}
         <button onClick={handleSave} className="bg-[var(--primary)] text-white px-6 py-2.5 rounded-xl font-bold flex items-center gap-2 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all">
            <Save className="w-4 h-4" /> Guardar cambios
         </button>
      </div>
    </div>
  ) : (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-[var(--bg-app)] border border-[var(--border-card)] shadow-2xl rounded-2xl w-full max-w-5xl max-h-[90dvh] [@media(max-height:500px)]:max-h-[92dvh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-300">
        
        {/* Header */}
        <div className="flex items-center justify-between p-4 md:p-6 border-b border-slate-200/50 bg-[var(--bg-card)] shrink-0">
           <h2 className="text-lg md:text-xl font-bold text-[var(--text-main)] flex items-center gap-2 md:gap-3">

              <span className="bg-[var(--primary)] text-white p-1.5 md:p-2 rounded-xl shadow-md shrink-0">
                 <Book className="w-4 h-4 md:w-5 md:h-5" />
              </span>
              <span className="truncate">Clasificar Material</span>
           </h2>
           <div className="flex items-center gap-2 sm:gap-4 shrink-0">
             <button onClick={handleSave} className="px-3 md:px-4 py-1.5 md:py-2 bg-[var(--primary)] text-white text-xs md:text-sm font-bold rounded-lg hover:opacity-90 transition-all flex items-center justify-center shadow-md">
                Guardar
             </button>
             <button onClick={onClose} className="text-slate-400 hover:text-[var(--text-main)] transition-colors p-1.5 rounded-full hover:bg-[var(--primary)]/10">
               <X className="w-5 h-5 md:w-6 md:h-6" />
             </button>
           </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 md:px-6 pt-2 pb-6 scrollbar-thin">
           <div className="grid grid-cols-1 md:grid-cols-3 [@media(max-height:500px)]:grid-cols-3 gap-6 md:gap-8 [@media(max-height:500px)]:gap-4 mt-0">

              {/* Column 1: Cover & Digital File */}
              <div className="md:col-span-1 [@media(max-height:500px)]:col-span-1 flex flex-col gap-6">
                 <div className="flex flex-col gap-2">
                    <label className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider block">Portada</label>
                    <div className="aspect-[3/4] bg-[var(--bg-app)] rounded-2xl border-2 border-dashed border-slate-200/50 flex flex-col items-center justify-center cursor-pointer relative overflow-hidden group shadow-sm transition-all hover:border-[var(--primary)]/50" onClick={() => coverInputRef.current?.click()}>
                       {coverUrl ? (
                         <img src={coverUrl} alt="Cover layout" className="w-full h-full object-cover" />
                       ) : (
                         <div className="flex flex-col items-center justify-center text-slate-400">
                            <ImageIcon className="w-12 h-12 mb-3 opacity-50 group-hover:scale-110 transition-transform" />
                            <span className="text-sm font-medium">Subir Imagen</span>
                         </div>
                       )}
                       
                       <div className="absolute inset-0 bg-slate-900/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center flex-col gap-3">
                          <span className="text-white text-sm font-bold flex items-center gap-2"><UploadCloud className="w-5 h-5" /> Cambiar</span>
                          {coverUrl && (
                             <button type="button" onClick={(e) => { e.stopPropagation(); setCoverUrl(''); }} className="text-rose-400 hover:text-white hover:bg-rose-500 px-3 py-1.5 rounded text-xs font-bold transition-colors">
                                Eliminar
                             </button>
                          )}
                       </div>
                    </div>
                    <input type="file" ref={coverInputRef} accept="image/*" className="hidden" onChange={handleCoverUpload} />
                 </div>
                 
                 <div className="flex flex-col gap-2 relative mt-4">
                    <button disabled={isAnalyzing} type="button" onClick={() => fileInputRef.current?.click()} className={cn("px-4 py-2.5 flex items-center justify-center font-medium gap-2 text-[var(--primary)] rounded-lg transition-colors w-full border border-[var(--primary)]/30 text-xs", isAnalyzing ? "bg-slate-100 opacity-70" : "bg-[var(--primary)]/10 hover:bg-[var(--primary)]/20")}>
                       <UploadCloud className={cn("w-4 h-4", isAnalyzing && "animate-pulse")} /> {isAnalyzing ? "Analizando IA..." : "Importar de PDF o EPUB"}
                    </button>
                    <p className="text-[10px] text-[var(--text-muted)] text-center leading-tight">Extrae IA la portada y datos de las primeras 7 pág.</p>
                    <input type="file" ref={fileInputRef} onChange={handleDigitalUpload} accept=".pdf,.epub,.txt" className="hidden" />
                    
                    <div className="relative mt-2">
                        {type === 'externa' ? (
                           <>
                              <input 
                                type="text" 
                                value={digitalSource} 
                                onChange={e => {
                                   setDigitalSource(e.target.value);
                                   setType('externa');
                                   if (e.target.value) {
                                      setOwnedDigital(true);
                                   }
                                }} 
                                className="w-full text-xs pl-9 pr-24 py-2.5 bg-[var(--bg-card)] border border-[var(--primary)]/20 rounded-lg focus:outline-none focus:ring-1 focus:ring-[var(--primary)] text-[var(--text-main)] placeholder-slate-400 font-medium transition-all shadow-sm" 
                                placeholder="Pegar enlace externo..." 
                              />
                              <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--primary)]/50" />
                              {digitalSource && (
                                <button 
                                  type="button"
                                  onClick={handleAnalyzeLink}
                                  disabled={isAnalyzing}
                                  className="absolute right-1 top-1 bottom-1 px-3 text-[10px] font-bold bg-[var(--primary)]/10 text-[var(--primary)] rounded hover:bg-[var(--primary)]/20 transition-colors"
                                >
                                  {isAnalyzing ? "..." : "Analizar"}
                                </button>
                              )}
                           </>
                        ) : (
                           <div className="flex items-center justify-between p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-xs text-emerald-600 font-medium shadow-sm transition-all animate-in fade-in">
                              <span className="flex items-center gap-1.5 truncate">
                                <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                                Archivo {type.toUpperCase()} cargado con éxito
                              </span>
                              <button 
                                type="button" 
                                onClick={() => {
                                  setDigitalSource('');
                                  setType('externa');
                                  setOwnedDigital(false);
                                }}
                                className="text-rose-500 hover:text-rose-700 font-bold ml-2 shrink-0 transition-colors"
                              >
                                Eliminar
                              </button>
                           </div>
                        )}
                    </div>
                 </div>
              </div>

              {/* Column 2: Metadata & Options */}
              <div className="md:col-span-2 [@media(max-height:500px)]:col-span-2 grid grid-cols-1 md:grid-cols-2 [@media(max-height:500px)]:grid-cols-2 gap-8 [@media(max-height:500px)]:gap-4">
                  <div className="space-y-6">
                 <div>
                   <label className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1 block">Título</label>
                   <input value={title} onChange={e => setTitle(e.target.value)} className="w-full text-base font-medium px-4 py-3 bg-[var(--bg-card)] border border-slate-200/50 rounded-xl focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent transition-all shadow-sm text-[var(--text-main)]" placeholder="Ej. El Señor de los Anillos" />
                 </div>
                 
                 <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1 block">Autor</label>
                      <input value={author} onChange={e => setAuthor(e.target.value)} className="w-full text-sm px-4 py-2.5 bg-[var(--bg-card)] border border-slate-200/50 rounded-xl focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-[var(--text-main)] transition-all shadow-sm" placeholder="Ej. J.R.R. Tolkien" />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1 block">Año</label>
                      <input value={year} onChange={e => setYear(e.target.value)} className="w-full text-sm px-4 py-2.5 bg-[var(--bg-card)] border border-slate-200/50 rounded-xl focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-[var(--text-main)] transition-all shadow-sm" placeholder="Ej. 1954" />
                    </div>
                 </div>

                 <div>
                    <label className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1 block">Materia / Editorial</label>
                    <input value={subject} onChange={e => setSubject(e.target.value)} className="w-full text-sm px-4 py-2.5 bg-[var(--bg-card)] border border-slate-200/50 rounded-xl focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-[var(--text-main)] transition-all shadow-sm" placeholder="Ej. Filosofía, Ed. Planeta" />
                 </div>

                 <div className="grid grid-cols-2 gap-4">
                     <div>
                       <label className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1 block">Editorial</label>
                       <input value={publisher} onChange={e => setPublisher(e.target.value)} className="w-full text-sm px-4 py-2.5 bg-[var(--bg-card)] border border-slate-200/50 rounded-xl focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-[var(--text-main)] transition-all shadow-sm" placeholder="Ej. Planeta" />
                     </div>
                     <div>
                       <label className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1 block">ISBN</label>
                       <input value={isbn} onChange={e => setIsbn(e.target.value)} className="w-full text-sm px-4 py-2.5 bg-[var(--bg-card)] border border-slate-200/50 rounded-xl focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-[var(--text-main)] transition-all shadow-sm" placeholder="Ej. 978-3-16-148410-0" />
                     </div>
                  </div>

                  {/* Valoración por estrellas (Modal) */}
                  <div>
                     <label className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2 block">Valoración</label>
                     <div className="flex items-center gap-1 bg-[var(--bg-card)] border border-slate-200/50 px-4 py-3 rounded-2xl w-fit shadow-sm">
                        <StarRating value={rating} onChange={setRating} size="md" />
                     </div>
                  </div>

                  {/* Etiquetas - Tags (Modal) */}
                  <div>
                     <label className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2 block">Etiquetas</label>
                     <div className="bg-[var(--bg-card)] border border-slate-200/50 rounded-2xl p-4 flex flex-col gap-3 shadow-sm">
                        <div className="flex gap-2">
                           <input
                              type="text"
                              value={tagInput}
                              onChange={(e) => setTagInput(e.target.value)}
                              onKeyDown={(e) => {
                                 if (e.key === 'Enter') {
                                    e.preventDefault();
                                    addTag(tagInput);
                                 }
                              }}
                              list="edit-tags-suggestions"
                              className="flex-1 text-sm px-4 py-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-[var(--primary)] text-[var(--text-main)] placeholder-slate-400"
                              placeholder="Nueva etiqueta y Enter..."
                           />
                           <datalist id="edit-tags-suggestions">
                              {allExistingTags.map((tag) => (
                                 <option key={tag} value={tag} />
                              ))}
                           </datalist>
                           <button
                              type="button"
                              onClick={() => addTag(tagInput)}
                              className="bg-[var(--primary)] text-white px-4 py-2.5 rounded-xl text-sm font-bold hover:opacity-90 active:scale-95 transition-all"
                           >
                              +
                           </button>
                        </div>
                        <div className="flex flex-wrap gap-2 min-h-[1.5rem]">
                           {tags.map((tag) => (
                              <span
                                 key={tag}
                                 className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-100 border border-slate-200 text-xs font-bold text-slate-600 transition-all hover:bg-slate-200"
                              >
                                 <Tag className="w-3 h-3 text-slate-400" />
                                 {tag}
                                 <button
                                    type="button"
                                    onClick={() => removeTag(tag)}
                                    className="text-slate-400 hover:text-rose-500 font-bold ml-1 text-xs focus:outline-none cursor-pointer"
                                    title="Quitar"
                                 >
                                    ×
                                 </button>
                              </span>
                           ))}
                           {tags.length === 0 && (
                              <span className="text-xs text-[var(--text-muted)] italic py-1">Sin etiquetas</span>
                           )}
                        </div>
                     </div>
                  </div>

                 <div>
                    <label className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2 block flex justify-between items-center">
                       Categoría Principal
                       <button type="button" onClick={() => setShowNewCategory(!showNewCategory)} className="p-0.5 hover:bg-slate-200 rounded text-slate-400 hover:text-[var(--primary)] transition-colors">
                          <Plus className="w-3 h-3" />
                       </button>
                    </label>
                    {showNewCategory && (
                       <div className="flex gap-2 mb-3">
                          <input autoFocus value={newCategoryName} onChange={e => setNewCategoryName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (newCategoryName.trim()) { addCategory({ name: newCategoryName.trim() }); setCategory(categories[categories.length - 1]?.id || newCategoryName); setNewCategoryName(''); setShowNewCategory(false); } } }} className="flex-1 text-sm px-3 py-1.5 bg-[var(--bg-app)] border border-slate-200/50 rounded-lg focus:outline-none focus:ring-1 focus:ring-[var(--primary)] text-[var(--text-main)]" placeholder="Nombre..." />
                          <button type="button" onClick={() => { if (newCategoryName.trim()) { addCategory({ name: newCategoryName.trim() }); setNewCategoryName(''); setShowNewCategory(false); } }} className="bg-[var(--primary)] text-white px-3 py-1.5 rounded-lg text-sm font-bold">Añadir</button>
                       </div>
                    )}
                    <div className="flex flex-wrap gap-2">
                       {categories?.map(c => (
                          <button
                            key={c.id}
                            onClick={() => setCategory(c.id)}
                            className={cn("px-4 py-2 rounded-xl text-sm font-medium transition-all shadow-sm border", category === c.id ? "bg-[var(--primary)] text-white border-[var(--primary)]" : "bg-[var(--bg-card)] text-[var(--text-muted)] border-slate-200/50 hover:border-[var(--primary)]/50")}
                          >
                             {c.name}
                          </button>
                       ))}
                    </div>
                 </div>

                 <div className="bg-[var(--bg-card)] border border-slate-200/50 rounded-2xl p-5 shadow-sm relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
                       <CheckCircle2 className="w-24 h-24" />
                    </div>
                    <label className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-4 block relative z-10 flex justify-between items-center">
                       Progreso de Lectura
                       <span className="flex items-center gap-2">
                          <span className={cn('text-[10px] font-bold text-white px-2 py-0.5 rounded-md', progState.color)}>{progState.text}</span>
                          <span className="font-mono text-[var(--primary)] bg-[var(--primary)]/10 px-2 py-0.5 rounded-md text-sm">{pValue}%</span>
                       </span>
                    </label>

                    <div className="flex items-center gap-4 relative z-10">
                       <DraggableProgress
                         value={pValue}
                         color={progState.color}
                         onChange={(v) => { setProgress(v); if (read && v < 100) setRead(false); }}
                       />
                       <button
                         onClick={() => { setRead(!read); if (!read) setProgress(100); }}
                         className={cn("p-2 rounded-xl transition-all shadow-sm flex-shrink-0", read ? "bg-emerald-500 text-white" : "bg-slate-100 text-slate-400 hover:bg-slate-200 hover:text-emerald-500")}
                         title="Marcar como terminado"
                       >
                         <CheckCircle2 className="w-5 h-5" />
                       </button>
                    </div>
                 </div>
              </div>

              {/* Right Sub-Column: Collection & Files */}
              <div className="space-y-6">

                 <div className="grid grid-cols-1 gap-3">
                    <button
                      onClick={() => setOwnedPhysical(!ownedPhysical)}
                      className={cn("flex items-center justify-between p-4 rounded-xl border transition-all text-left", ownedPhysical ? "bg-[var(--primary)]/10 border-[var(--primary)]/30 text-[var(--primary)]" : "bg-[var(--bg-card)] border-slate-200/50 text-[var(--text-muted)] hover:border-[var(--primary)]/50")}
                    >
                       <div className="flex items-center gap-3">
                          <div className={cn("p-2 rounded-lg", ownedPhysical ? "bg-[var(--primary)] text-white shadow-md" : "bg-slate-100 text-slate-400")}>
                             <Book className="w-5 h-5" />
                          </div>
                          <div>
                             <div className="font-bold text-sm">Ejemplar Físico</div>
                             <div className="text-xs opacity-80 decoration-slate-400">Tener el libro formato físico en mi biblioteca</div>
                          </div>
                       </div>
                       <div className={cn("w-5 h-5 rounded-full border-2 flex items-center justify-center", ownedPhysical ? "border-[var(--primary)] bg-[var(--primary)]" : "border-slate-300")}>
                          {ownedPhysical && <CheckCircle2 className="w-3 h-3 text-white" />}
                       </div>
                    </button>
                    <button
                      onClick={() => setOwnedDigital(!ownedDigital)}
                      className={cn("flex items-center justify-between p-4 rounded-xl border transition-all text-left", ownedDigital ? "bg-[var(--primary)]/10 border-[var(--primary)]/30 text-[var(--primary)]" : "bg-[var(--bg-card)] border-slate-200/50 text-[var(--text-muted)] hover:border-[var(--primary)]/50")}
                    >
                       <div className="flex items-center gap-3">
                          <div className={cn("p-2 rounded-lg", ownedDigital ? "bg-[var(--primary)] text-white shadow-md" : "bg-slate-100 text-slate-400")}>
                             <Bookmark className="w-5 h-5" />
                          </div>
                          <div>
                             <div className="font-bold text-sm">Versión Digital</div>
                             <div className="text-xs opacity-80 decoration-slate-400">Tener archivo o link local</div>
                          </div>
                       </div>
                       <div className={cn("w-5 h-5 rounded-full border-2 flex items-center justify-center", ownedDigital ? "border-[var(--primary)] bg-[var(--primary)]" : "border-slate-300")}>
                          {ownedDigital && <CheckCircle2 className="w-3 h-3 text-white" />}
                       </div>
                    </button>
                    <div className="space-y-2">
                       <button
                         onClick={() => setToBuy(!toBuy)}
                         className={cn("flex items-center justify-between p-4 rounded-xl border transition-all text-left w-full", toBuy ? "bg-[var(--primary)]/10 border-[var(--primary)]/30 text-[var(--primary)]" : "bg-[var(--bg-card)] border-slate-200/50 text-[var(--text-muted)] hover:border-[var(--primary)]/50")}
                       >
                          <div className="flex items-center gap-3">
                             <div className={cn("p-2 rounded-lg", toBuy ? "bg-[var(--primary)] text-white shadow-md" : "bg-slate-100 text-slate-400")}>
                                <BookmarkCheck className="w-5 h-5" />
                             </div>
                             <div>
                                <div className="font-bold text-sm">Wishlist</div>
                                <div className="text-xs opacity-80 decoration-slate-400">Marcar este material para adquirirlo a futuro</div>
                             </div>
                          </div>
                          <div className={cn("w-5 h-5 rounded-full border-2 flex items-center justify-center", toBuy ? "border-[var(--primary)] bg-[var(--primary)]" : "border-slate-300")}>
                             {toBuy && <CheckCircle2 className="w-3 h-3 text-white" />}
                          </div>
                       </button>
                    </div>
                 </div>

                 <div>
                    <label className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2 flex justify-between items-center gap-2">
                       <span className="flex items-center gap-2"><Library className="w-4 h-4" /> Añadir a Listas</span>
                       <button type="button" onClick={() => setShowNewPlaylist(!showNewPlaylist)} className="p-0.5 hover:bg-slate-200 rounded text-slate-400 hover:text-[var(--primary)] transition-colors">
                          <Plus className="w-3 h-3" />
                       </button>
                    </label>
                    {showNewPlaylist && (
                       <div className="flex gap-2 mb-3">
                          <input autoFocus value={newPlaylistName} onChange={e => setNewPlaylistName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (newPlaylistName.trim()) { addPlaylist({ name: newPlaylistName.trim(), color: 'bg-slate-800' }); setNewPlaylistName(''); setShowNewPlaylist(false); } } }} className="flex-1 text-sm px-3 py-1.5 bg-[var(--bg-app)] border border-slate-200/50 rounded-lg focus:outline-none focus:ring-1 focus:ring-[var(--primary)] text-[var(--text-main)]" placeholder="Nombre..." />
                          <button type="button" onClick={() => { if (newPlaylistName.trim()) { addPlaylist({ name: newPlaylistName.trim(), color: 'bg-slate-800' }); setNewPlaylistName(''); setShowNewPlaylist(false); } }} className="bg-[var(--primary)] text-white px-3 py-1.5 rounded-lg text-sm font-bold">Añadir</button>
                       </div>
                    )}
                    <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto pr-2 scrollbar-thin">
                       {playlists.map(pl => (
                          <button
                             key={pl.id}
                             onClick={() => toggleFolder(pl.id)}
                             className={cn("flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-all border", folderIds.includes(pl.id) ? "bg-[var(--bg-card)] border-slate-300 shadow-sm text-[var(--text-main)] font-medium" : "bg-transparent border-transparent text-[var(--text-muted)] hover:bg-[var(--bg-card)]")}
                          >
                             <div className={cn("w-2 h-2 rounded-full", colorSwatchProps(pl.color).className)} style={colorSwatchProps(pl.color).style} />
                             {pl.name}
                             {folderIds.includes(pl.id) && <CheckCircle2 className="w-3 h-3 ml-1 text-emerald-500" />}
                          </button>
                       ))}
                       {playlists.length === 0 && <div className="text-xs text-[var(--text-muted)] italic">No tienes listas creadas aún.</div>}
                    </div>
                 </div>

              </div>
           </div>
         </div>
       </div>

       {/* Footer */}
        <div className="p-4 border-t border-slate-200/50 bg-[var(--bg-card)] flex justify-between gap-3 rounded-b-2xl items-center flex-wrap">
           {showDeleteConfirm ? (
              <div className="flex items-center gap-2">
                 <span className="text-xs font-bold text-rose-500">¿Estás seguro?</span>
                 <button onClick={() => { deleteItem(item.id); onClose(); }} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-rose-500 text-white hover:bg-rose-600 transition-colors">Sí, eliminar</button>
                 <button onClick={() => setShowDeleteConfirm(false)} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-200 text-slate-600 hover:bg-slate-300 transition-colors">Cancelar</button>
              </div>
           ) : (
              <button onClick={() => setShowDeleteConfirm(true)} className="px-3 py-1.5 rounded-xl text-sm font-bold text-rose-500 hover:bg-rose-50 transition-colors flex items-center gap-2">
                 <Trash2 className="w-4 h-4" /> Eliminar
              </button>
           )}
           <div className="flex gap-3 ml-auto">
              <span className="text-xs text-slate-400 italic">Cambios se guardan desde el botón superior.</span>
           </div>
        </div>
      </div>
    </div>
  );

  if (inline) {
    return modalContent;
  }
  
  return createPortal(modalContent, document.body);
}
