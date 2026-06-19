import React, { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { BookItem } from '../types';
import { UploadCloud, X, Plus, CheckCircle2, Link as LinkIcon, Tag, Sparkles, Loader2 } from 'lucide-react';
import { useLibrary } from '../hooks/useLibrary';
import { cn, colorSwatchProps } from '../lib/utils';
import { pdfjs } from 'react-pdf';
import ePub from 'epubjs';
// Migrado de idb-keyval a almacenamiento real en el servidor (ver src/lib/uploadFile.ts).
import { uploadFile, deleteUploadedFile } from '../lib/uploadFile';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

interface DemoQuota {
  max: number;
  current: number;
}

interface AddManualModalProps {
  onClose: () => void;
  onAdd: (item: Omit<BookItem, 'id' | 'timestamp'>) => void;
  demoQuota?: DemoQuota | null;
}

type RetryableField = 'title' | 'author' | 'year' | 'publisher' | 'isbn' | 'subject';

// Botón pequeño de IA junto a un campo vacío: fuerza un reintento de extracción
// (gemini-2.5-pro, hasta 5 páginas; el ISBN además busca online si no aparece
// en el texto). Solo se muestra si hay texto extraído disponible para analizar.
function AiRetryButton({ field, extractedText, retryingField, onRetry }: {
  field: RetryableField;
  extractedText: string;
  retryingField: string | null;
  onRetry: (field: RetryableField) => void;
}) {
  if (!extractedText) return null;
  const isLoading = retryingField === field;
  return (
    <button
      type="button"
      disabled={!!retryingField}
      onClick={() => onRetry(field)}
      title="Buscar con IA"
      className="p-0.5 rounded text-indigo-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
    >
      {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
    </button>
  );
}

export function AddManualModal({ onClose, onAdd, demoQuota }: AddManualModalProps) {
  const { categories, addCategory, playlists, addPlaylist, items } = useLibrary();

  const [formData, setFormData] = useState({
    title: '',
    author: '',
    year: '',
    category: categories[0]?.id || 'libro',
    subject: '',
    publisher: '',
    isbn: '',
    read: false,
    ownedPhysical: false,
    ownedDigital: false,
    toBuy: false
  });
  const [digitalSource, setDigitalSource] = useState('');
  const [digitalType, setDigitalType] = useState<'externa' | 'pdf' | 'epub' | 'txt'>('externa');

  const [coverUrl, setCoverUrl] = useState('');
  const coverInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadError, setUploadError] = useState('');
  // Texto de las primeras páginas, guardado para poder reintentar la
  // extracción de un campo específico sin volver a leer el archivo.
  const [extractedText, setExtractedText] = useState('');
  // Campo que se está reintentando ahora ('title' | 'author' | ... | null).
  const [retryingField, setRetryingField] = useState<string | null>(null);

  const isQuotaFull = !!demoQuota && demoQuota.current >= demoQuota.max;

  const [selectedFolderIds, setSelectedFolderIds] = useState<string[]>([]);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [showNewPlaylist, setShowNewPlaylist] = useState(false);

  const toggleFolder = (id: string) => {
    setSelectedFolderIds(prev =>
      prev.includes(id) ? prev.filter(fid => fid !== id) : [...prev, id]
    );
  };

  const [newCategoryName, setNewCategoryName] = useState('');
  const [showNewCategory, setShowNewCategory] = useState(false);

  const [tags, setTags] = useState<string[]>([]);
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
           setFormData(prev => ({
              ...prev,
              title: (!prev.title && extracted.title) ? extracted.title : prev.title,
              author: (!prev.author && extracted.author) ? extracted.author : prev.author
           }));
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
    // Si ya había una portada subida (aún sin guardar el libro), se reemplaza
    // por completo: borramos la anterior del servidor.
    const previousCoverUrl = coverUrl;
    // Preview optimista mientras sube.
    const previewUrl = URL.createObjectURL(file);
    setCoverUrl(previewUrl);
    try {
      const { url } = await uploadFile(file, `cover-${Date.now()}.jpg`);
      setCoverUrl(url);
      URL.revokeObjectURL(previewUrl);
      if (previousCoverUrl?.startsWith('/api/files/') && previousCoverUrl !== url) {
        deleteUploadedFile(previousCoverUrl);
      }
    } catch (err) {
      console.error('Error subiendo portada al servidor:', err);
      // Dejamos el preview blob como fallback visual; al recargar se perderá.
    }
    // Análisis IA en paralelo (no necesita esperar al upload).
    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64Data = event.target?.result as string;
      if (base64Data) await analyzeImageContent(base64Data);
    };
    reader.readAsDataURL(file);
  };

  const [isAnalyzing, setIsAnalyzing] = useState(false);

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

              // Convertimos a Blob y subimos al servidor en vez de meter el base64
              // en localStorage (evita reventar la cuota del navegador).
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
         } catch (e) { console.error("Cover extraction failed", e); }
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
       setExtractedText(textString);

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
         const extracted = await response.json();
         setFormData(prev => ({
           ...prev,
           title: extracted.title || prev.title,
           author: extracted.author || prev.author,
           year: extracted.year || prev.year,
           publisher: extracted.publisher || prev.publisher,
           isbn: extracted.isbn || prev.isbn,
           subject: extracted.subject || prev.subject
         }));
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
            const extracted = await response.json();
            setFormData(prev => ({
              ...prev,
              title: extracted.title || prev.title,
              author: extracted.author || prev.author,
              year: extracted.year || prev.year,
              publisher: extracted.publisher || prev.publisher,
              isbn: extracted.isbn || prev.isbn,
              subject: extracted.subject || prev.subject
            }));
         }
       } catch (e) {
         console.error("URL analysis failed:", e);
       }
     } finally {
       setIsAnalyzing(false);
     }
  };

  const analyzeEpubContent = async (buffer: ArrayBuffer) => {
    setIsAnalyzing(true);
    try {
      const book = ePub(buffer);
      await book.ready;
      const metadata = await book.loaded.metadata;

      // El ISBN suele venir en el identifier del OPF, a veces con prefijo "urn:isbn:" o "isbn:".
      const rawIdentifier = (metadata as any).identifier || '';
      const isbnMatch = String(rawIdentifier).match(/(?:urn:)?isbn:?\s*([\d-]{10,17})/i);
      const isbn = isbnMatch ? isbnMatch[1] : (/^[\d-]{10,17}$/.test(String(rawIdentifier).trim()) ? rawIdentifier.trim() : '');

      setFormData(prev => ({
        ...prev,
        title: metadata.title || prev.title,
        author: metadata.creator || prev.author,
        publisher: metadata.publisher || prev.publisher,
        year: (metadata.pubdate ? String(metadata.pubdate).slice(0, 4) : '') || prev.year,
        isbn: isbn || prev.isbn
      }));

      if (!coverUrl) {
        try {
          const coverBlobUrl = await book.coverUrl();
          if (coverBlobUrl) {
            const coverBlob = await (await fetch(coverBlobUrl)).blob();
            try {
              const { url } = await uploadFile(coverBlob, `cover-${Date.now()}.jpg`);
              setCoverUrl(url);
            } catch (err) {
              console.warn('No se pudo subir la auto-portada del EPUB, uso preview local:', err);
              setCoverUrl(coverBlobUrl);
            }
          }
        } catch (e) { console.error("EPUB cover extraction failed", e); }
      }

      // La materia principal y el ISBN (si no estaba en los metadatos) requieren
      // analizar el texto del contenido, igual que con los PDFs.
      try {
        const spineItems = (book.spine as any).spineItems as any[];
        const sectionsToRead = spineItems.slice(0, 7);
        // Para libros archivados (ArrayBuffer/zip), section.url ya viene resuelto,
        // por lo que hay que usar archive.request directo (book.load re-resolvería
        // la ruta y rompería la URL).
        const requestFn = book.archive.request.bind(book.archive);
        let fullText: string[] = [];
        for (const item of sectionsToRead) {
          try {
            const contents: Element = await item.load(requestFn);
            const text = contents.textContent?.replace(/\s+/g, ' ').trim() || '';
            if (text) fullText.push(text);
            item.unload();
          } catch { /* sección no legible, se ignora */ }
        }
        const textString = fullText.join(' \n').slice(0, 200000);
        setExtractedText(textString);

        if (textString) {
          const response = await fetch('/api/analyze-pdf', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: textString })
          });
          if (response.ok) {
            const extracted = await response.json();
            setFormData(prev => ({
              ...prev,
              title: prev.title || extracted.title || '',
              author: prev.author || extracted.author || '',
              year: prev.year || extracted.year || '',
              publisher: prev.publisher || extracted.publisher || '',
              isbn: prev.isbn || extracted.isbn || '',
              subject: extracted.subject || prev.subject
            }));
          }
        }
      } catch (e) { console.error("EPUB text analysis failed", e); }
    } catch (error) {
      console.error("EPUB analysis failed:", error);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleDigitalUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (isQuotaFull) {
      setUploadError(`Límite de contenidos alcanzado (${demoQuota!.current}/${demoQuota!.max}). Elimina un contenido antes de subir otro.`);
      return;
    }
    setUploadError('');
    const name = file.name.toLowerCase();
    const isPdf = file.type.includes('pdf') || name.endsWith('.pdf');
    const isTxt = file.type.includes('text/plain') || name.endsWith('.txt');

    // Si ya había un archivo digital subido (aún sin guardar el libro), se
    // reemplaza por completo: borramos el anterior del servidor para no dejar
    // archivos huérfanos cada vez que el usuario cambia de archivo antes de
    // presionar "Guardar".
    const previousSource = digitalSource;

    // Sube al servidor → obtenemos URL persistente "/api/files/<uuid>.<ext>".
    try {
      const { url } = await uploadFile(file);
      setDigitalSource(url);
      if (previousSource?.startsWith('/api/files/') && previousSource !== url) {
        deleteUploadedFile(previousSource);
      }
    } catch (err: any) {
      console.error('Error subiendo archivo al servidor:', err);
      if (err?.code === 'DEMO_LIMIT') {
        setUploadError(err.message);
        return;
      }
      setDigitalSource(URL.createObjectURL(file));
    }

    setDigitalType(isPdf ? 'pdf' : isTxt ? 'txt' : 'epub');
    setFormData(prev => ({ ...prev, ownedDigital: true }));

    if (isPdf) {
      // Pasamos el ArrayBuffer directo a pdfjs (más fiable que volver a fetchear).
      const buffer = await file.arrayBuffer();
      await analyzePdfContent(buffer);
    } else if (!isTxt) {
      // EPUB: extraemos metadatos (título, autor, editorial, año) y portada igual que un PDF.
      const buffer = await file.arrayBuffer();
      await analyzeEpubContent(buffer);
    }
  };

  const handleAnalyzeLink = async () => {
     if (!digitalSource) return;
     const proxyUrl = `/api/proxy-resource?url=${encodeURIComponent(digitalSource)}`;
     await analyzePdfContent(proxyUrl);
  };

  // Reintento forzado de un solo campo (botón de IA junto al input cuando
  // quedó vacío). Usa el texto de las primeras páginas ya extraído y, si es
  // isbn y no aparece en el texto, el servidor busca online por título/autor.
  const retryField = async (field: 'title' | 'author' | 'year' | 'publisher' | 'isbn' | 'subject') => {
    if (!extractedText || retryingField) return;
    setRetryingField(field);
    try {
      const response = await fetch('/api/analyze-field', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: extractedText, field, title: formData.title, author: formData.author })
      });
      if (response.ok) {
        const { value } = await response.json();
        if (value) setFormData(prev => ({ ...prev, [field]: value }));
      }
    } catch (err) {
      console.error(`No se pudo reintentar el campo ${field}:`, err);
    } finally {
      setRetryingField(null);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title) return;

    onAdd({
      category: formData.category,
      title: formData.title,
      author: formData.author,
      year: formData.year,
      source: digitalSource,
      type: digitalType,
      // Guardar también en el slot correspondiente para que PDF y EPUB puedan
      // coexistir (el segundo formato se añade luego desde Editar).
      pdfSource: digitalType === 'pdf' ? digitalSource || undefined : undefined,
      epubSource: digitalType === 'epub' ? digitalSource || undefined : undefined,
      thumbnailUrl: coverUrl,
      folderIds: selectedFolderIds,
      stageIds: [],
      subject: formData.subject,
      publisher: formData.publisher,
      isbn: formData.isbn,
      read: formData.read,
      ownedPhysical: formData.ownedPhysical,
      ownedDigital: formData.ownedDigital,
      toBuy: formData.toBuy,
      progress: 0,   // todo libro importado empieza en 0% de lectura
      tags
    });
  };

  const modalContent = (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-[9999]">
      <div className="bg-[var(--bg-app)] rounded-2xl shadow-xl w-full max-w-3xl lg:max-w-[62rem] overflow-hidden animate-in fade-in zoom-in-95 flex flex-col h-[95dvh] max-h-[95dvh] md:h-auto md:max-h-[85vh] [@media(max-height:500px)]:h-[92dvh] [@media(max-height:500px)]:max-h-[92dvh]">
        <div className="flex items-center justify-between p-3 md:p-5 border-b border-slate-200/50 shrink-0">
           <h2 className="text-base md:text-lg font-bold text-[var(--text-main)] truncate">Añadir Recurso Manualmente</h2>
           <div className="flex items-center gap-2 sm:gap-4 shrink-0">
             <span className="hidden sm:inline-block text-[10px] text-[var(--text-muted)] opacity-70 italic font-medium tracking-wide">
                Autoguardado activado
             </span>
             <button id="add-manual-save-btn" onClick={() => {
                const btn = document.getElementById('add-manual-save-btn');
                setTimeout(() => {
                    const form = document.getElementById('add-manual-form') as HTMLFormElement;
                    if(form) form.requestSubmit();
                }, 10);
                if (btn) {
                  const originalText = btn.textContent;
                  btn.textContent = '¡Guardado!';
                  btn.classList.add('bg-emerald-500');
                  btn.classList.remove('bg-[var(--primary)]');
                  setTimeout(() => {
                     btn.textContent = originalText;
                     btn.classList.remove('bg-emerald-500');
                     btn.classList.add('bg-[var(--primary)]');
                  }, 2000);
                }
             }} type="button" className="px-3 md:px-4 py-1.5 md:py-2 bg-[var(--primary)] text-white text-xs md:text-sm font-bold rounded-lg hover:opacity-90 transition-all flex items-center justify-center shadow-md">
                Guardar
             </button>
             <button onClick={onClose} type="button" className="text-slate-400 hover:text-[var(--text-main)] transition-colors p-1.5 rounded-full hover:bg-[var(--primary)]/10">
               <X className="w-5 h-5 md:w-6 md:h-6" />
             </button>
           </div>
        </div>
        
        <form id="add-manual-form" onSubmit={handleSubmit} className="flex-1 overflow-y-auto md:overflow-hidden [@media(max-height:500px)]:overflow-y-auto p-3 md:p-5">
           {/* En pantallas de poco alto (móvil horizontal) se usa el mismo grid
               de 3 columnas que desktop, sin importar el ancho, para no apilar
               todo verticalmente en un viewport que apenas tiene alto. */}
           <div className="grid grid-cols-1 md:grid-cols-3 [@media(max-height:500px)]:grid-cols-3 gap-4 md:gap-6 [@media(max-height:500px)]:gap-3 min-h-min md:h-full md:items-start [@media(max-height:500px)]:items-start">
              <div className="md:col-span-1 [@media(max-height:500px)]:col-span-1 flex flex-col gap-2 items-center md:sticky md:top-0 [@media(max-height:500px)]:sticky [@media(max-height:500px)]:top-0">
                 <label className="text-[11px] font-semibold text-[var(--text-muted)] block w-full text-center">Portada</label>
                 <div
                   className="w-1/2 md:w-[70%] lg:w-[70%] aspect-[2/3] bg-[var(--bg-card)] rounded-xl border-2 border-dashed border-slate-200/50 flex flex-col items-center justify-center text-slate-400 cursor-pointer overflow-hidden relative shadow-sm transition-all hover:border-[var(--primary)]/50 group"
                   onClick={() => coverInputRef.current?.click()}
                 >
                   {coverUrl ? (
                      <img src={coverUrl} alt="Cover preview" className="w-full h-full object-cover" />
                   ) : (
                      <>
                        <UploadCloud className="w-6 h-6 mb-2 opacity-50 group-hover:scale-110 transition-transform" />
                        <span className="text-xs font-medium text-center">Subir Portada</span>
                      </>
                   )}
                   <input type="file" ref={coverInputRef} accept="image/*" className="hidden" onChange={handleCoverUpload} />
                </div>
                
                <div className="flex flex-col gap-2 mt-3 w-full">
                   <button
                     disabled={isAnalyzing || isQuotaFull}
                     type="button"
                     onClick={() => fileInputRef.current?.click()}
                     className={cn("px-3 py-1.5 flex items-center justify-center font-bold gap-2 rounded-lg transition-all w-full text-xs shadow-md whitespace-nowrap", isAnalyzing || isQuotaFull ? "bg-slate-200 text-slate-400 opacity-70 cursor-not-allowed" : "bg-[var(--primary)] text-white hover:opacity-90")}
                   >
                     <UploadCloud className={cn("w-4 h-4 shrink-0", isAnalyzing && "animate-pulse")} />
                     {isAnalyzing ? "Analizando IA..." : isQuotaFull ? `Límite alcanzado (${demoQuota!.current}/${demoQuota!.max})` : "Importar archivo"}
                   </button>
                   {uploadError && (
                     <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-center">{uploadError}</p>
                   )}
                   <input type="file" ref={fileInputRef} onChange={handleDigitalUpload} accept=".pdf,.epub,.txt" className="hidden" />

                   <div className="relative mt-1">
                       {digitalType === 'externa' ? (
                          <>
                             <input
                               type="text"
                               value={digitalSource}
                               onChange={e => {
                                  setDigitalSource(e.target.value);
                                  setDigitalType('externa');
                                  if (e.target.value) {
                                     setFormData(prev => ({ ...prev, ownedDigital: true }));
                                  }
                               }}
                               className="w-full text-xs pl-9 pr-20 py-1.5 bg-[var(--bg-card)] border border-[var(--primary)]/20 rounded-lg focus:outline-none focus:ring-1 focus:ring-[var(--primary)] text-[var(--text-main)] placeholder-slate-400 font-medium transition-all shadow-sm"
                               placeholder="Pegar enlace..."
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
                          <div className="flex items-center justify-between p-2 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-xs text-emerald-600 font-medium shadow-sm transition-all animate-in fade-in">
                             <span className="flex items-center gap-1.5 truncate">
                               <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                               Archivo {digitalType.toUpperCase()} cargado con éxito
                             </span>
                             <button
                               type="button"
                               onClick={() => {
                                 setDigitalSource('');
                                 setDigitalType('externa');
                                 setFormData(prev => ({ ...prev, ownedDigital: false }));
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
             
             <div className="md:col-span-2 [@media(max-height:500px)]:col-span-2 space-y-4 md:h-full md:overflow-y-auto md:pr-2 [@media(max-height:500px)]:h-full [@media(max-height:500px)]:overflow-y-auto settings-scrollbar">
                <div>
                   <label className="text-[11px] font-semibold text-[var(--text-muted)] flex items-center justify-between mb-1">
                      Título *
                      {!formData.title && <AiRetryButton field="title" extractedText={extractedText} retryingField={retryingField} onRetry={retryField} />}
                   </label>
                   <input required type="text" value={formData.title} onChange={e => setFormData({...formData, title: e.target.value})} className="w-full text-sm font-medium px-3 py-1.5 bg-[var(--bg-card)] border border-slate-200/50 rounded-xl focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent transition-all shadow-sm text-[var(--text-main)]" placeholder="Ej. El Señor de los Anillos" />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                   <div>
                      <label className="text-[11px] font-semibold text-[var(--text-muted)] flex items-center justify-between mb-1">
                         Autor
                         {!formData.author && <AiRetryButton field="author" extractedText={extractedText} retryingField={retryingField} onRetry={retryField} />}
                      </label>
                      <input type="text" value={formData.author} onChange={e => setFormData({...formData, author: e.target.value})} className="w-full text-sm px-3 py-1.5 bg-[var(--bg-card)] border border-slate-200/50 rounded-xl focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-[var(--text-main)] transition-all shadow-sm" placeholder="Ej. J.R.R. Tolkien" />
                   </div>
                   <div>
                      <label className="text-[11px] font-semibold text-[var(--text-muted)] flex items-center justify-between mb-1">
                         Año
                         {!formData.year && <AiRetryButton field="year" extractedText={extractedText} retryingField={retryingField} onRetry={retryField} />}
                      </label>
                      <input type="text" value={formData.year} onChange={e => setFormData({...formData, year: e.target.value})} className="w-full text-sm px-3 py-1.5 bg-[var(--bg-card)] border border-slate-200/50 rounded-xl focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-[var(--text-main)] transition-all shadow-sm" placeholder="Ej. 1954" />
                   </div>
                </div>

                <div>
                   <label className="text-[11px] font-semibold text-[var(--text-muted)] flex items-center justify-between mb-1">
                      Materia
                      {!formData.subject && <AiRetryButton field="subject" extractedText={extractedText} retryingField={retryingField} onRetry={retryField} />}
                   </label>
                   <input type="text" value={formData.subject} onChange={e => setFormData({...formData, subject: e.target.value})} className="w-full text-sm px-3 py-1.5 bg-[var(--bg-card)] border border-slate-200/50 rounded-xl focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-[var(--text-main)] transition-all shadow-sm" placeholder="Ej. Filosofía" />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                   <div>
                      <label className="text-[11px] font-semibold text-[var(--text-muted)] flex items-center justify-between mb-1">
                         Editorial
                         {!formData.publisher && <AiRetryButton field="publisher" extractedText={extractedText} retryingField={retryingField} onRetry={retryField} />}
                      </label>
                      <input type="text" value={formData.publisher} onChange={e => setFormData({...formData, publisher: e.target.value})} className="w-full text-sm px-3 py-1.5 bg-[var(--bg-card)] border border-slate-200/50 rounded-xl focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-[var(--text-main)] transition-all shadow-sm" placeholder="Ej. Planeta" />
                   </div>
                   <div>
                      <label className="text-[11px] font-semibold text-[var(--text-muted)] flex items-center justify-between mb-1">
                         ISBN
                         {!formData.isbn && <AiRetryButton field="isbn" extractedText={extractedText} retryingField={retryingField} onRetry={retryField} />}
                      </label>
                      <input type="text" value={formData.isbn} onChange={e => setFormData({...formData, isbn: e.target.value})} className="w-full text-sm px-3 py-1.5 bg-[var(--bg-card)] border border-slate-200/50 rounded-xl focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-[var(--text-main)] transition-all shadow-sm" placeholder="Ej. 978-3-16-148410-0" />
                   </div>
                </div>

                <div>
                   <label className="flex items-center justify-between text-[11px] font-semibold text-[var(--text-muted)] mb-2">
                      Categoría
                      <button type="button" onClick={() => setShowNewCategory(!showNewCategory)} className="p-0.5 hover:bg-slate-200 rounded text-slate-400 hover:text-[var(--primary)] transition-colors">
                         <Plus className="w-3 h-3" />
                      </button>
                   </label>
                   {showNewCategory && (
                      <div className="flex gap-2 mb-3">
                         <input autoFocus value={newCategoryName} onChange={e => setNewCategoryName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (newCategoryName.trim()) { addCategory({ name: newCategoryName.trim() }); setFormData({...formData, category: newCategoryName.trim()}); setNewCategoryName(''); setShowNewCategory(false); } } }} className="flex-1 text-sm px-3 py-1.5 bg-[var(--bg-app)] border border-slate-200/50 rounded-lg focus:outline-none focus:ring-1 focus:ring-[var(--primary)] text-[var(--text-main)]" placeholder="Nombre..." />
                         <button type="button" onClick={() => { if (newCategoryName.trim()) { addCategory({ name: newCategoryName.trim() }); setNewCategoryName(''); setShowNewCategory(false); } }} className="bg-[var(--primary)] text-white px-3 py-1.5 rounded-lg text-sm font-bold">Añadir</button>
                      </div>
                   )}
                   <div className="flex flex-wrap gap-2">
                       {categories?.map(c => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => setFormData({...formData, category: c.id})}
                            className={cn("px-3 py-1.5 rounded-lg text-sm font-medium transition-all shadow-sm border flex items-center gap-2", formData.category === c.id ? "bg-[var(--primary)]/10 text-[var(--text-main)] border-[var(--primary)]/40" : "bg-[var(--bg-card)] text-[var(--text-muted)] border-slate-200/50 hover:border-[var(--primary)]/50")}
                          >
                             {c.name}
                             {formData.category === c.id && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />}
                          </button>
                       ))}
                   </div>
                </div>

                <div>
                   <label className="flex items-center justify-between text-[11px] font-semibold text-[var(--text-muted)] mb-2 select-none">
                      <span className="flex items-center gap-1">Asignar a Listas / Carpetas (Etiquetas)</span>
                      <button type="button" onClick={() => setShowNewPlaylist(!showNewPlaylist)} className="p-0.5 hover:bg-slate-200 rounded text-slate-400 hover:text-[var(--primary)] transition-colors" title="Nueva lista/etiqueta">
                         <Plus className="w-3 h-3" />
                      </button>
                   </label>
                   {showNewPlaylist && (
                      <div className="flex gap-2 mb-3">
                         <input autoFocus value={newPlaylistName} onChange={e => setNewPlaylistName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (newPlaylistName.trim()) { addPlaylist({ name: newPlaylistName.trim(), color: 'bg-slate-800' }); setNewPlaylistName(''); setShowNewPlaylist(false); } } }} className="flex-1 text-sm px-3 py-1.5 bg-[var(--bg-app)] border border-slate-200/50 rounded-lg focus:outline-none focus:ring-1 focus:ring-[var(--primary)] text-[var(--text-main)]" placeholder="Nombre..." />
                         <button type="button" onClick={() => { if (newPlaylistName.trim()) { addPlaylist({ name: newPlaylistName.trim(), color: 'bg-slate-800' }); setNewPlaylistName(''); setShowNewPlaylist(false); } }} className="bg-[var(--primary)] text-white px-3 py-1.5 rounded-lg text-sm font-bold">Añadir</button>
                      </div>
                   )}
                   {playlists.length === 0 ? (
                      <p className="text-xs text-[var(--text-muted)] italic">No tienes listas creadas aún. Presiona "+" para agregar una.</p>
                   ) : (
                      <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto pr-1">
                          {playlists.map(pl => {
                             const checked = selectedFolderIds.includes(pl.id);
                             return (
                                <button
                                  key={pl.id}
                                  type="button"
                                  onClick={() => toggleFolder(pl.id)}
                                  className={cn("px-3 py-1.5 rounded-lg text-xs font-medium transition-all shadow-sm border flex items-center gap-2", checked ? "bg-[var(--primary)]/10 text-[var(--text-main)] border-[var(--primary)]/40" : "bg-[var(--bg-card)] text-[var(--text-muted)] border-slate-200/50 hover:border-[var(--primary)]/50")}
                                >
                                   <span className={cn("w-2.5 h-2.5 rounded-full shrink-0", colorSwatchProps(pl.color).className)} style={colorSwatchProps(pl.color).style} />
                                   <span className="truncate max-w-[120px]">{pl.name}</span>
                                   {checked && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />}
                                </button>
                             );
                          })}
                      </div>
                   )}
                </div>

                <div>
                   <label className="text-[11px] font-semibold text-[var(--text-muted)] block mb-2">Etiquetas</label>
                   <div className="bg-[var(--bg-card)] border border-slate-200/50 rounded-xl p-2.5 flex flex-col gap-2 shadow-sm">
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
                            list="add-tags-suggestions"
                            className="flex-1 text-sm px-3 py-1.5 bg-[var(--bg-app)] border border-slate-200/50 rounded-lg focus:outline-none focus:ring-1 focus:ring-[var(--primary)] text-[var(--text-main)] placeholder-slate-400"
                            placeholder="Nueva etiqueta y Enter..."
                         />
                         <datalist id="add-tags-suggestions">
                            {allExistingTags.map((tag) => (
                               <option key={tag} value={tag} />
                            ))}
                         </datalist>
                         <button
                            type="button"
                            onClick={() => addTag(tagInput)}
                            className="bg-[var(--primary)] text-white px-3 py-1.5 rounded-lg text-sm font-bold hover:opacity-90 active:scale-95 transition-all"
                         >
                            +
                         </button>
                      </div>
                      <div className="flex flex-wrap gap-1.5 min-h-[1.5rem]">
                         {tags.map((tag) => (
                            <span
                               key={tag}
                               className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[var(--bg-app)] border border-slate-200/50 text-[11px] font-bold text-[var(--text-muted)] transition-all hover:bg-slate-100"
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
                            <span className="text-[11px] text-[var(--text-muted)] italic py-0.5">Sin etiquetas</span>
                         )}
                      </div>
                   </div>
                </div>

                <div className="pt-3 border-t border-slate-200/50">
                   <label className="text-[11px] font-semibold text-[var(--text-muted)] block mb-2">Formato</label>
                   <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setFormData({...formData, ownedPhysical: !formData.ownedPhysical})}
                        className={cn("px-3 py-1.5 rounded-lg text-sm font-medium transition-all shadow-sm border flex items-center gap-2", formData.ownedPhysical ? "bg-[var(--primary)]/10 text-[var(--text-main)] border-[var(--primary)]/40" : "bg-[var(--bg-card)] text-[var(--text-muted)] border-slate-200/50 hover:border-[var(--primary)]/50")}
                      >
                         Físico
                         {formData.ownedPhysical && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => setFormData({...formData, ownedDigital: !formData.ownedDigital})}
                        className={cn("px-3 py-1.5 rounded-lg text-sm font-medium transition-all shadow-sm border flex items-center gap-2", formData.ownedDigital ? "bg-[var(--primary)]/10 text-[var(--text-main)] border-[var(--primary)]/40" : "bg-[var(--bg-card)] text-[var(--text-muted)] border-slate-200/50 hover:border-[var(--primary)]/50")}
                      >
                         Digital
                         {formData.ownedDigital && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => setFormData({...formData, toBuy: !formData.toBuy})}
                        className={cn("px-3 py-1.5 rounded-lg text-sm font-medium transition-all shadow-sm border flex items-center gap-2", formData.toBuy ? "bg-[var(--primary)]/10 text-[var(--text-main)] border-[var(--primary)]/40" : "bg-[var(--bg-card)] text-[var(--text-muted)] border-slate-200/50 hover:border-[var(--primary)]/50")}
                      >
                         Wishlist
                         {formData.toBuy && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />}
                      </button>
                   </div>
                </div>
             </div>
          </div>
          
          <div className="flex items-center justify-between gap-3 mt-8">
             <div />
          </div>
        </form>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
