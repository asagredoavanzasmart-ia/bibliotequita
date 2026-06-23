// =============================================================================
// NotesPanel.tsx — Panel de notas/citas dentro del lector
// -----------------------------------------------------------------------------
// Componente de PRESENTACIÓN: el estado real (notes/activePalette) y su
// persistencia viven en el hook useDocumentNotes, instanciado en ReaderView
// (mismo ciclo de vida que el lector, no el de este panel). Por eso una cita
// creada durante el TTS se guarda aunque este panel esté cerrado/desmontado.
//
// Tipos de "Note":
//   - 'note'     → texto libre escrito por el usuario o cita capturada al
//                  resaltar texto del PDF / marcada durante la lectura por voz.
//   - 'bookmark' → marcador rápido a la página actual.
// =============================================================================

import React, { useState, useEffect, useRef } from 'react';
import { Trash2, Edit2, Send, Tag, Mic, Square, Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { cn } from '../lib/utils';
import type { Note } from '../hooks/useDocumentNotes';

export type { Note };

// Extrae un número de página real de `pageReference`. En EPUB, `pageReference`
// puede ser un CFI (p.ej. "epubcfi(/6/14!/4/2/16,/1:0,/1:117)") en vez de un
// número de página: si se interpretara su primer dígito como página, las notas
// quedarían ordenadas por un número arbitrario en vez de cronológicamente.
// Por eso solo se trata como "página" si la referencia es puramente numérica.
const parsePageNum = (ref: any): number => {
  if (typeof ref === 'number') return ref > 0 ? ref : 0;
  if (typeof ref !== 'string') return 0;
  const str = ref.trim();
  if (!/^\d+$/.test(str)) return 0;
  return parseInt(str, 10);
};

interface NotesPanelProps {
  documentId: string;
  notes: Note[];
  addNote: (content: string, page?: number | string) => void;
  addBookmark: (page?: number | string) => void;
  editNote: (id: string, patch: Partial<Pick<Note, 'content' | 'pageReference' | 'color'>>) => void;
  deleteNote: (id: string) => void;
  onNavigateToPage?: (page: number | string) => void;
  onNavigateToCitation?: (note: Note) => void;
  // Re-pinta el resaltado de una cita con su nuevo color SIN desplazar la vista
  // (a diferencia de onNavigateToCitation, que sí centra). Se usa al recolorear.
  onRecolorCitation?: (note: Note) => void;
  currentPage?: number | string;
}

export function NotesPanel({ documentId, notes, addNote, addBookmark, editNote, deleteNote, onNavigateToPage, onNavigateToCitation, onRecolorCitation, currentPage }: NotesPanelProps) {
  const [editorContent, setEditorContent] = useState('');
  const [showSavedFeedback, setShowSavedFeedback] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editPage, setEditPage] = useState<string | number>('');
  const notesEndRef = useRef<HTMLDivElement>(null);

  // Móvil/tablet: ocultamos el título "Anotaciones" para ganar espacio vertical
  // y dejar más sitio a las notas cuando el teclado está abierto.
  const [isCompact, setIsCompact] = useState(typeof window !== 'undefined' ? window.innerWidth < 1024 : false);
  useEffect(() => {
    const onResize = () => setIsCompact(window.innerWidth < 1024);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Grabación de notas de voz.
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessingAudio, setIsProcessingAudio] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioStreamRef = useRef<MediaStream | null>(null);

  // Feedback visual "Guardado" tras cualquier mutación. notes/activePalette y
  // su persistencia ya viven en useDocumentNotes (ver ReaderView); aquí solo
  // se decide cuándo mostrar el indicador.
  const flashSavedFeedback = () => {
    setShowSavedFeedback(true);
    setTimeout(() => setShowSavedFeedback(false), 2000);
  };

  // Scroll to bottom when notes array changes
  useEffect(() => {
    notesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [notes.length]);

  const handleSaveNote = () => {
    if (!editorContent.trim()) return;
    addNote(editorContent, currentPage);
    setEditorContent('');
    flashSavedFeedback();
  };

  // Envía el audio grabado al servidor: lo transcribe, lo ordena y, si es una
  // pregunta, genera una explicación. El resultado se guarda como una nota más,
  // que se ordena junto al resto (por página/cronología) igual que las demás.
  const processVoiceNote = async (blob: Blob) => {
    setIsProcessingAudio(true);
    setAudioError(null);
    try {
      const audioBase64: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });

      const res = await fetch('/api/gemini/voice-note', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioBase64 }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || 'No se pudo procesar la nota de voz.');
      }
      const data = await res.json();
      const content: string = (data?.content || '').trim();
      if (!content) throw new Error('La transcripción quedó vacía.');

      addNote(content, currentPage);
      flashSavedFeedback();
    } catch (err: any) {
      setAudioError(err?.message || 'Error al procesar el audio.');
    } finally {
      setIsProcessingAudio(false);
    }
  };

  const stopStream = () => {
    audioStreamRef.current?.getTracks().forEach(t => t.stop());
    audioStreamRef.current = null;
  };

  const startRecording = async () => {
    setAudioError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = stream;
      audioChunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      recorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        stopStream();
        if (blob.size > 0) processVoiceNote(blob);
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
    } catch (err) {
      setAudioError('No se pudo acceder al micrófono.');
      stopStream();
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  };

  // Limpieza: si el componente se desmonta mientras graba, soltamos el micrófono.
  useEffect(() => () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    stopStream();
  }, []);

  const handleAddBookmark = () => {
     addBookmark(currentPage);
     flashSavedFeedback();
  };

  const saveEdit = (id: string) => {
    editNote(id, { content: editContent, pageReference: editPage || undefined });
    setEditingNoteId(null);
    flashSavedFeedback();
  };

  return (
    <div className="flex flex-col bg-[#fdfdfd] h-full w-full">
      {/* En móvil/tablet ocultamos el encabezado para no robar alto al listado
          de notas (especialmente con el teclado abierto). */}
      {!isCompact && (
        <div className="flex px-4 py-3 shrink-0 items-center justify-between border-b border-slate-100 bg-white">
           <h3 className="font-bold text-sm text-slate-700 flex items-center gap-2">
              <Edit2 className="w-4 h-4 text-[#00558F]" />
              Anotaciones
           </h3>
        </div>
      )}
      <div className="flex-1 overflow-y-auto px-2 py-4 sm:px-4 space-y-3 bg-[#fdfdfd] no-scrollbar">
         {notes.length === 0 ? (
            <div className="text-center text-[#7D94A0] text-sm mt-10 px-4">
              Selecciona texto en el documento para empezar a citar.
            </div>
         ) : (
            [...notes]
              .sort((a, b) => {
                const pageA = parsePageNum(a.pageReference);
                const pageB = parsePageNum(b.pageReference);
                
                const hasPageA = pageA > 0;
                const hasPageB = pageB > 0;
                
                if (hasPageA && hasPageB) {
                  if (pageA !== pageB) return pageA - pageB;
                } else if (hasPageA) {
                  return -1;
                } else if (hasPageB) {
                  return 1;
                }
                return a.timestamp - b.timestamp;
              })
              .map(note => {
                 if (editingNoteId === note.id) {
                 return (
                   <div key={note.id} className="relative border-l-[3px] border-[#00558F] p-3 mb-2 shadow-sm rounded-r-xl bg-slate-50 transition-colors">
                     <div className="text-sm relative flex flex-col gap-2">
                       <textarea 
                         autoFocus
                         className="w-full bg-white border border-slate-200 outline-none resize-none p-2 focus:border-[#00558F] text-sm overflow-hidden rounded-md shadow-sm"
                         value={editContent}
                         onChange={e => setEditContent(e.target.value)}
                         ref={el => {
                             if (el) {
                                 el.style.height = 'auto';
                                 el.style.height = `${el.scrollHeight}px`;
                             }
                         }}
                       />
                       <div className="flex items-center justify-between mt-1">
                          <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-md px-2 py-1 shadow-sm w-32">
                             <span className="text-xs text-slate-500 font-medium">Pág:</span>
                             <input 
                               type="text" 
                               value={editPage} 
                               onChange={e => setEditPage(e.target.value)}
                               className="w-full text-xs outline-none bg-transparent"
                               placeholder="Num"
                             />
                          </div>
                          <div className="flex justify-end gap-1">
                             <button onClick={() => setEditingNoteId(null)} className="text-slate-400 hover:text-slate-600 px-3 py-1 font-medium text-xs bg-slate-100 rounded-lg">Cancelar</button>
                             <button onClick={() => saveEdit(note.id)} className="text-white bg-[#00558F] px-3 py-1 font-medium text-xs rounded-lg shadow-sm">Guardar</button>
                          </div>
                       </div>
                     </div>
                   </div>
                 );
               }

               if (note.type === 'bookmark') {
                 return (
                   <div 
                     key={note.id} 
                     className="relative group bg-[#0284c7] hover:bg-[#0369a1] text-white p-2.5 mb-2 shadow-sm rounded-xl transition-all flex items-center justify-between gap-3 cursor-pointer active:scale-[0.99]"
                     onClick={() => { if (onNavigateToPage && note.pageReference) onNavigateToPage(note.pageReference); }}
                   >
                     <div className="flex items-center gap-2 min-w-0 flex-1">
                       <Tag className="w-3.5 h-3.5 text-white/90 shrink-0" />
                       <span className="text-xs font-semibold truncate text-white">{note.content}</span>
                       {note.pageReference && parsePageNum(note.pageReference) > 0 && (
                         <span className="text-[10px] font-bold text-white/95 shrink-0 bg-white/20 px-1.5 py-0.5 rounded ml-1">
                           pág. {note.pageReference}
                         </span>
                       )}
                     </div>
                     <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                       <button 
                         onClick={(e) => { 
                           e.stopPropagation(); 
                           setEditingNoteId(note.id); 
                           setEditContent(note.content); 
                           setEditPage(note.pageReference || ''); 
                         }} 
                         className="p-1 text-white/85 hover:text-white hover:bg-white/15 rounded transition-colors"
                         title="Editar"
                       >
                         <Edit2 className="w-3 h-3" />
                       </button>
                       <button 
                         onClick={(e) => { 
                           e.stopPropagation(); 
                           deleteNote(note.id); 
                         }} 
                         className="p-1 text-white/85 hover:text-rose-100 hover:bg-rose-500/35 rounded transition-colors"
                         title="Eliminar"
                       >
                         <Trash2 className="w-3 h-3" />
                       </button>
                     </div>
                   </div>
                 );
               }

               return (
                 <div key={note.id} className={cn("relative group border-l-[3px] p-3 mb-2 shadow-sm rounded-r-xl transition-colors",
                    note.color === 'emerald-400' ? "border-emerald-400 bg-emerald-50/50" : 
                    note.color === 'rose-400' ? "border-rose-400 bg-rose-50/50" :
                    note.color === 'sky-400' ? "border-sky-400 bg-sky-50/50" :
                    note.color === 'amber-400' ? "border-amber-400 bg-amber-50/50" :
                    "bg-slate-50 border-slate-300"
                 )}>
                    <div className="flex justify-between items-start mb-0.5">
                      <div className="flex items-center gap-2">
                          {/* Normal note header details */}
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                         <>
                             {(['emerald-400', 'amber-400', 'sky-400', 'rose-400'] as const).map((colorId) => {
                               const dot: Record<string, string> = {
                                 'emerald-400': 'bg-emerald-400 border-emerald-500',
                                 'amber-400': 'bg-amber-400 border-amber-500',
                                 'sky-400': 'bg-sky-400 border-sky-500',
                                 'rose-400': 'bg-rose-400 border-rose-500',
                               };
                               return (
                                 <button
                                   key={colorId}
                                   onClick={() => {
                                     editNote(note.id, { color: colorId });
                                     // Re-pinta el resaltado en el documento con el nuevo color.
                                     if (onRecolorCitation) {
                                       const quote = note.quote || (note.content.startsWith('>') ? note.content.replace(/^>\s*/, '') : undefined);
                                       if (quote) onRecolorCitation({ ...note, color: colorId, quote });
                                     }
                                   }}
                                   className={cn("w-3 h-3 rounded-full border hover:scale-110 transition-transform", dot[colorId])}
                                 />
                               );
                             })}
                             <div className="w-px h-3 bg-slate-300 mx-0.5" />
                         </>
                        <button onClick={() => { setEditingNoteId(note.id); setEditContent(note.content); setEditPage(note.pageReference || ''); }} className="p-1 text-slate-400 hover:text-[#00558F] hover:bg-[#00558F]/10 rounded">
                          <Edit2 className="w-3 h-3" />
                        </button>
                        <button onClick={() => deleteNote(note.id)} className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                    <div className="prose prose-sm prose-slate max-w-none prose-p:my-1 prose-blockquote:my-1 prose-blockquote:border-l-[2px] prose-blockquote:border-[#00558F]/30 prose-blockquote:pl-2 prose-blockquote:text-slate-600 prose-blockquote:italic cursor-text py-1">
                      <div className="inline">
                        <ReactMarkdown 
                          components={{ 
                            p: ({node, ...props}) => <span className="text-sm inline" {...props} />,
                            blockquote: ({node, ...props}) => <span className="border-l-[2px] border-[#00558F]/30 pl-2 text-slate-600 italic inline" {...props} />
                          }}
                        >
                          {note.content}
                        </ReactMarkdown>
                        {note.pageReference && (
                          <>
                            {' '}
                            <button
                              onClick={() => {
                                const quote = note.quote || (note.content.startsWith('>') ? note.content.replace(/^>\s*/, '') : undefined);
                                if (quote && onNavigateToCitation) {
                                  onNavigateToCitation({ ...note, quote });
                                } else if (onNavigateToPage) {
                                  onNavigateToPage(note.pageReference!);
                                }
                              }}
                              className="text-xs text-[#00558F] font-semibold hover:underline inline"
                            >
                              (pag.{note.pageReference})
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                 </div>
               );
             })
         )}
         <div ref={notesEndRef} className="h-4" />
      </div>

      <div className="p-2.5 sm:p-3 border-t border-slate-100 bg-[#fdfdfd] shrink-0 shadow-[0_-10px_20px_-10px_rgba(0,0,0,0.05)] relative z-20">
         {audioError && (
           <div className="mb-2 text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-2.5 py-1.5">
             {audioError}
           </div>
         )}
         {isRecording && (
           <div className="mb-2 flex items-center gap-2 text-xs text-rose-600 font-medium">
             <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
             Grabando nota de voz…
           </div>
         )}
         {isProcessingAudio && (
           <div className="mb-2 flex items-center gap-2 text-xs text-[#00558F] font-medium">
             <Loader2 className="w-3.5 h-3.5 animate-spin" />
             Procesando audio…
           </div>
         )}
         <div className="flex items-end gap-2">
           <textarea
             value={editorContent}
             onChange={e => setEditorContent(e.target.value)}
             placeholder="Escribe una nota…"
             rows={isCompact ? 1 : 2}
             className="flex-1 bg-slate-50 border border-slate-200 rounded-2xl px-3.5 py-2.5 text-sm focus:border-[#00558F] focus:ring-1 focus:ring-[#00558F] focus:bg-white transition-all resize-none shadow-sm no-scrollbar max-h-32"
           />
           {/* Botón de nota de voz */}
           <button
             onClick={isRecording ? stopRecording : startRecording}
             disabled={isProcessingAudio}
             title={isRecording ? 'Detener grabación' : 'Grabar nota de voz'}
             className={cn(
               "p-3 rounded-full transition-colors shrink-0 flex items-center justify-center transform active:scale-95 shadow-sm disabled:opacity-50",
               isRecording ? "bg-rose-500 hover:bg-rose-600 text-white animate-pulse" : "bg-white border border-slate-200 text-rose-500 hover:bg-rose-50"
             )}
           >
             {isProcessingAudio ? <Loader2 className="w-4 h-4 animate-spin" /> : isRecording ? <Square className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
           </button>
           {/* Botón de enviar nota escrita */}
           <button
             onClick={handleSaveNote}
             disabled={!editorContent.trim()}
             title="Guardar nota"
             className="bg-[#00558F] hover:bg-[#004270] disabled:bg-slate-200 disabled:text-white text-white p-3 rounded-full transition-colors shrink-0 flex items-center justify-center transform active:scale-95 shadow-sm"
           >
             <Send className="w-4 h-4 ml-0.5" />
           </button>
         </div>
      </div>

    </div>
  );
}
