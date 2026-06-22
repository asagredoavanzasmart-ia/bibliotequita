import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Trash2, 
  Edit2, 
  Download, 
  ArrowUpDown, 
  SlidersHorizontal, 
  Settings2, 
  X, 
  Bookmark, 
  Tag, 
  GripVertical, 
  Plus, 
  Check, 
  AlertCircle,
  ChevronUp,
  ChevronDown,
  Sparkles,
  Copy,
  Save,
  FileText,
  Loader2,
  Info,
  ChevronLeft,
  BookOpen,
  FileSpreadsheet,
  Printer,
  BookMarked,
  FolderOpen
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { cn } from '../lib/utils';
import { exportToDocx, exportToPrintPdf, createGoogleDoc, loginWithGoogle } from '../utils/exportUtils';
import { uploadFile } from '../lib/uploadFile';

export interface CitationNote {
  id: string;
  documentId: string;
  quote?: string;
  content: string;
  pageReference?: number | string;
  timestamp: number;
  color?: string;
  type?: 'note' | 'bookmark';
}

export interface ColorDefinition {
  id: string;
  color: string;
  bgClass: string;
  borderClass: string;
  textClass: string;
  name: string;
  hex: string;
}

interface CitationsManagerProps {
  documentId: string;
  onClose: () => void;
  onNavigateToPage?: (page: number | string) => void;
  onNavigateToCitation?: (note: CitationNote) => void;
  currentPage?: number | string;
}

const ALL_POSSIBLE_COLORS: ColorDefinition[] = [
  { id: 'rose-400', color: 'rose-400', bgClass: 'bg-rose-50/50', borderClass: 'border-rose-400', textClass: 'text-rose-600', name: 'Rojo', hex: '#fb7185' },
  { id: 'sky-400', color: 'sky-400', bgClass: 'bg-sky-50/50', borderClass: 'border-sky-400', textClass: 'text-sky-600', name: 'Azul', hex: '#38bdf8' },
  { id: 'emerald-400', color: 'emerald-400', bgClass: 'bg-emerald-50/50', borderClass: 'border-emerald-400', textClass: 'text-emerald-600', name: 'Verde', hex: '#34d399' },
  { id: 'amber-400', color: 'amber-400', bgClass: 'bg-amber-50/50', borderClass: 'border-amber-400', textClass: 'text-amber-600', name: 'Amarillo', hex: '#fbbf24' },
  { id: 'violet-400', color: 'violet-400', bgClass: 'bg-violet-50/50', borderClass: 'border-violet-400', textClass: 'text-violet-600', name: 'Morado', hex: '#a78bfa' },
  { id: 'orange-400', color: 'orange-400', bgClass: 'bg-orange-50/50', borderClass: 'border-orange-400', textClass: 'text-orange-600', name: 'Naranja', hex: '#fb923c' }
];

const SUMMARY_PROMPTS = {
  breve: "Genera un resumen muy breve y conciso con viñetas que condense los puntos fundamentales y más importantes de las citas provistas, ordenándolas de manera lógica sin redundancias en español.",
  descriptivo: "Crea un texto a partir de la citas tomando el orden actual de las citas en un documento ordenado logico sinrecortar el contenido de las citas incluyendo lo más posible todas las ideas, fechas autores, argumentos definiciones en las citas.",
  personalizado: "Crea un texto a partir de la citas tomando el orden actual de las citas en un documento ordenado logico sinrecortar el contenido de las citas incluyendo lo más posible todas las ideas, fechas autores, argumentos definiciones en las citas."
};

const LOADING_MESSAGES = [
  "Analizando las citas seleccionadas...",
  "Estructurando el orden lógico de las anotaciones...",
  "Conectando de forma segura con Gemini 3.5 Flash...",
  "Sintetizando ideas, fechas, autores y definiciones clave...",
  "Generando el documento de resumen definitivo..."
];

// Si documentId no es de un libro sino ya de un recurso (sufijo "::res::"),
// no se cargan/anidan citas de recursos (evita recursión recurso-de-recurso).
const isBookDocumentId = (docId: string) => !docId.includes('::res::');

// Misma lógica de orden que usaba saveNotes/getSortedCitations: por página
// ascendente (las que tienen página van primero) y, si no hay página, por
// timestamp de creación. Centralizada para reusarla también en recursos.
function sortByPageAndTimestamp(list: CitationNote[]): CitationNote[] {
  const parsePageNum = (ref: any): number => {
    if (ref === undefined || ref === null) return 0;
    const str = String(ref).trim();
    if (!str) return 0;
    const match = str.match(/\d+/);
    return match ? parseInt(match[0], 10) : 0;
  };
  return [...list].sort((a, b) => {
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
  });
}

export function CitationsManager({ documentId, onClose, onNavigateToPage, onNavigateToCitation, currentPage }: CitationsManagerProps) {
  const [notes, setNotes] = useState<CitationNote[]>([]);
  const [activePalette, setActivePalette] = useState<ColorDefinition[]>([]);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  // documentId "propietario" de la nota que se está editando: el del libro
  // (documentId, valor por defecto) o el de un recurso de texto.
  const [editingDocId, setEditingDocId] = useState<string | null>(null);

  // --- Citas de recursos de texto del libro (separadas de `notes`) ---
  const isBookDocument = isBookDocumentId(documentId);
  const [textResources, setTextResources] = useState<{ id: string; title: string; docId: string }[]>([]);
  const [resourceCitations, setResourceCitations] = useState<Record<string, CitationNote[]>>({});
  const [editPage, setEditPage] = useState<string | number>('');
  
  const [selectedColorFilter, setSelectedColorFilter] = useState<string>('all');
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [colorToDelete, setColorToDelete] = useState<ColorDefinition | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Gemini Summary state
  const [showSummaryView, setShowSummaryView] = useState(false);
  const [summaryType, setSummaryType] = useState<'breve' | 'descriptivo' | 'personalizado'>('descriptivo');
  const [activePrompt, setActivePrompt] = useState(SUMMARY_PROMPTS.descriptivo);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedSummary, setGeneratedSummary] = useState('');
  const [editedSummary, setEditedSummary] = useState('');
  const [isEditingSummary, setIsEditingSummary] = useState(false);
  const [summaryError, setSummaryError] = useState('');
  
  const [loadingMsg, setLoadingMsg] = useState(LOADING_MESSAGES[0]);
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [saveNoteFeedback, setSaveNoteFeedback] = useState(false);
  const [savingSummaryResource, setSavingSummaryResource] = useState(false);
  const [saveResourceFeedback, setSaveResourceFeedback] = useState(false);
  const [summarySaveStatus, setSummarySaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');

  // New states for export dropdown, color picking, and Google Doc link
  const [activeColorPickerNoteId, setActiveColorPickerNoteId] = useState<string | null>(null);
  const [showExportSummaryDropdown, setShowExportSummaryDropdown] = useState(false);
  const [googleDocLink, setGoogleDocLink] = useState<string | null>(null);
  const [isExportingGoogleDoc, setIsExportingGoogleDoc] = useState(false);

  // Group by color toggle state (persistido en document_settings)
  const [isGroupedByColor, setIsGroupedByColor] = useState<boolean>(false);
  const groupByColorLoadedRef = useRef(false);

  useEffect(() => {
    if (!groupByColorLoadedRef.current) return;
    fetch(`/api/documents/${documentId}/settings`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupByColor: isGroupedByColor }),
    }).catch(err => console.error('No se pudo guardar el agrupado por color:', err));
  }, [isGroupedByColor, documentId]);

  // Close color picker when clicking anywhere else
  useEffect(() => {
    const handleOutsideClick = () => {
      setActiveColorPickerNoteId(null);
    };
    if (activeColorPickerNoteId) {
      window.addEventListener('click', handleOutsideClick);
    }
    return () => {
      window.removeEventListener('click', handleOutsideClick);
    };
  }, [activeColorPickerNoteId]);

  // Sync editedSummary when generatedSummary is produced
  useEffect(() => {
    if (generatedSummary) {
      setEditedSummary(generatedSummary);
    }
  }, [generatedSummary]);

  // Autosave when summary changes to persist "la proxima vez que entre debe estar"
  useEffect(() => {
    if (!groupByColorLoadedRef.current) return;
    fetch(`/api/documents/${documentId}/settings`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ summaryGen: generatedSummary || null }),
    }).catch(err => console.error('No se pudo guardar el resumen generado:', err));
  }, [generatedSummary, documentId]);

  useEffect(() => {
    if (!groupByColorLoadedRef.current) return;
    fetch(`/api/documents/${documentId}/settings`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ summaryEdit: editedSummary || null }),
    }).catch(err => console.error('No se pudo guardar el resumen editado:', err));
  }, [editedSummary, documentId]);

  // Load citations and saved summaries
  const loadCitations = async () => {
    try {
      const res = await fetch(`/api/documents/${documentId}/notes`, { credentials: 'include' });
      const d = await res.json();
      if (Array.isArray(d.notes)) setNotes(d.notes);
    } catch (e) {
      console.error("Error loading notes in Citations Manager", e);
    }
  };

  const loadSummaries = async () => {
    try {
      const res = await fetch(`/api/documents/${documentId}/settings`, { credentials: 'include' });
      const d = await res.json();
      if (d.settings?.summaryGen) setGeneratedSummary(d.settings.summaryGen);
      if (d.settings?.summaryEdit) setEditedSummary(d.settings.summaryEdit);
      if (typeof d.settings?.groupByColor === 'boolean') setIsGroupedByColor(d.settings.groupByColor);
    } catch (e) {
      console.error("Error loading document settings", e);
    } finally {
      // Esperar al siguiente tick para que los setState de carga ya hayan
      // disparado los efectos de autosave antes de "armarlos".
      setTimeout(() => { groupByColorLoadedRef.current = true; }, 0);
    }
  };

  // Helper to obtain citations sorted by their original order (position in source)
  const getSortedCitations = (): CitationNote[] => {
    const active = notes.filter(n => n.type !== 'bookmark' && (selectedColorFilter === 'all' || n.color === selectedColorFilter));
    
    return [...active].sort((a, b) => {
      const parsePageNum = (ref: any): number => {
        if (ref === undefined || ref === null) return 0;
        const str = String(ref).trim();
        if (!str) return 0;
        const match = str.match(/\d+/);
        return match ? parseInt(match[0], 10) : 0;
      };

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
    });
  };

  // Load color palette configuration
  const loadPalette = async () => {
    try {
      const res = await fetch(`/api/documents/${documentId}/settings`, { credentials: 'include' });
      const d = await res.json();
      setActivePalette(d.settings?.colorPalette ?? ALL_POSSIBLE_COLORS.slice(0, 4));
    } catch (e) {
      setActivePalette(ALL_POSSIBLE_COLORS.slice(0, 4));
    }
  };

  // Carga la lista de recursos del libro (de CUALQUIER tipo: texto, video,
  // audio, imagen — todos pueden tener notas vía NotesPanel en ResourcesPanel)
  // y, para cada uno, sus citas (documentId = `${documentId}::res::<id>`).
  // No aplica si `documentId` ya es de un recurso (evita anidar "recursos de recursos").
  const loadResourceCitations = async () => {
    if (!isBookDocument) { setTextResources([]); setResourceCitations({}); return; }
    try {
      const res = await fetch(`/api/books/${documentId}/resources`, { credentials: 'include' });
      const d = await res.json();
      const allResources = (d.resources ?? []);
      const mapped = allResources.map((r: any) => ({ id: r.id, title: r.title, docId: `${documentId}::res::${r.id}` }));
      setTextResources(mapped);

      const entries = await Promise.all(mapped.map(async (r: { id: string; title: string; docId: string }) => {
        try {
          const nres = await fetch(`/api/documents/${r.docId}/notes`, { credentials: 'include' });
          const nd = await nres.json();
          return [r.docId, Array.isArray(nd.notes) ? nd.notes : []] as const;
        } catch {
          return [r.docId, []] as const;
        }
      }));
      setResourceCitations(Object.fromEntries(entries));
    } catch (e) {
      console.error('No se pudieron cargar las citas de los recursos:', e);
      setTextResources([]);
      setResourceCitations({});
    }
  };

  useEffect(() => {
    groupByColorLoadedRef.current = false;
    loadCitations();
    loadPalette();
    loadSummaries();
    loadResourceCitations();
  }, [documentId]);

  const saveNotes = (updatedNotes: CitationNote[]) => {
    const parsePageNum = (ref: any): number => {
      if (ref === undefined || ref === null) return 0;
      const str = String(ref).trim();
      if (!str) return 0;
      const match = str.match(/\d+/);
      return match ? parseInt(match[0], 10) : 0;
    };

    const sorted = [...updatedNotes].sort((a, b) => {
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
    });

    fetch(`/api/documents/${documentId}/notes`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: sorted }),
    }).catch(err => console.error('No se pudieron guardar las notas:', err));
    setNotes(sorted);
  };

  // Al escribir el nombre de un color se llama una vez por tecla. Sin debounce,
  // cada pulsación dispara su propio PUT y, si dos llegan al servidor fuera de
  // orden (la del penúltimo carácter responde después que la del último), el
  // nombre final visible queda con una versión vieja aunque en pantalla se
  // viera el texto completo un instante. Se debounce 400ms y solo se envía la
  // versión más reciente de la paleta.
  const savePaletteTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPaletteRef = useRef<ColorDefinition[] | null>(null);
  const flushPalette = (palette: ColorDefinition[]) => {
    pendingPaletteRef.current = null;
    fetch(`/api/documents/${documentId}/settings`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ colorPalette: palette }),
    }).catch(err => console.error('No se pudo guardar la paleta de colores:', err));
  };
  const savePalette = (updatedPalette: ColorDefinition[]) => {
    setActivePalette(updatedPalette);
    pendingPaletteRef.current = updatedPalette;
    if (savePaletteTimeoutRef.current) clearTimeout(savePaletteTimeoutRef.current);
    savePaletteTimeoutRef.current = setTimeout(() => flushPalette(updatedPalette), 400);
  };

  // Si el usuario navega fuera (cambia de pestaña/cierra el panel) antes de
  // que venza el debounce, el guardado pendiente se envía de inmediato en vez
  // de perderse — evita que un cambio reciente quede sin persistir.
  useEffect(() => () => {
    if (savePaletteTimeoutRef.current) clearTimeout(savePaletteTimeoutRef.current);
    if (pendingPaletteRef.current) flushPalette(pendingPaletteRef.current);
  }, []);

  // Drag and drop logic
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
  };

  const handleDrop = (index: number) => {
    if (draggedIndex === null || draggedIndex === index) return;
    const items = [...notes];
    const [reorderedItem] = items.splice(draggedIndex, 1);
    items.splice(index, 0, reorderedItem);
    saveNotes(items);
    setDraggedIndex(null);
  };

  // Move manual buttons for accessibility / perfect mobile reordering
  const moveItem = (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= notes.length) return;
    const items = [...notes];
    const temp = items[index];
    items[index] = items[targetIndex];
    items[targetIndex] = temp;
    saveNotes(items);
  };

  const deleteCitation = (id: string) => {
    const filtered = notes.filter(n => n.id !== id);
    saveNotes(filtered);
  };

  const handleSaveEdit = (id: string) => {
    const updated = notes.map(n => n.id === id ? { ...n, content: editContent, pageReference: editPage || undefined } : n);
    saveNotes(updated);
    setEditingNoteId(null);
  };

  const startEditing = (note: CitationNote) => {
    setEditingNoteId(note.id);
    setEditContent(note.content);
    setEditPage(note.pageReference || '');
    setEditingDocId(documentId);
  };

  // --- Mutaciones de citas de RECURSOS de texto (aisladas de notes/saveNotes;
  // cada función recibe el documentId del recurso de forma explícita para
  // nunca mezclar sus citas con las del libro). ---
  const saveResourceNotes = (resDocId: string, updatedNotes: CitationNote[]) => {
    const sorted = sortByPageAndTimestamp(updatedNotes);
    fetch(`/api/documents/${resDocId}/notes`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: sorted }),
    }).catch(err => console.error('No se pudieron guardar las notas del recurso:', err));
    setResourceCitations(prev => ({ ...prev, [resDocId]: sorted }));
  };

  const deleteResourceCitation = (resDocId: string, id: string) => {
    const filtered = (resourceCitations[resDocId] ?? []).filter(n => n.id !== id);
    saveResourceNotes(resDocId, filtered);
  };

  const moveResourceItem = (resDocId: string, index: number, direction: 'up' | 'down') => {
    const list = resourceCitations[resDocId] ?? [];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= list.length) return;
    const items = [...list];
    const temp = items[index];
    items[index] = items[targetIndex];
    items[targetIndex] = temp;
    saveResourceNotes(resDocId, items);
  };

  const handleSaveResourceEdit = (resDocId: string, id: string) => {
    const updated = (resourceCitations[resDocId] ?? []).map(n => n.id === id ? { ...n, content: editContent, pageReference: editPage || undefined } : n);
    saveResourceNotes(resDocId, updated);
    setEditingNoteId(null);
    setEditingDocId(null);
  };

  const startEditingResource = (resDocId: string, note: CitationNote) => {
    setEditingNoteId(note.id);
    setEditContent(note.content);
    setEditPage(note.pageReference || '');
    setEditingDocId(resDocId);
  };

  // Group / Sort by color toggle (switch)
  const handleSortByColor = () => {
    setIsGroupedByColor(prev => {
      const nextVal = !prev;
      showFeedback(nextVal ? "Citas agrupadas por color." : "Citas ordenadas por su posición en la fuente.");
      return nextVal;
    });
  };

  const showFeedback = (msg: string) => {
    setMessage(msg);
    setTimeout(() => setMessage(null), 3000);
  };

  // Color palette settings management
  const updateColorName = (id: string, newName: string) => {
    const updated = activePalette.map(c => c.id === id ? { ...c, name: newName } : c);
    savePalette(updated);
  };

  const updateColorHex = (id: string, newHex: string) => {
    const updated = activePalette.map(c => c.id === id ? { ...c, hex: newHex } : c);
    savePalette(updated);
  };

  const removeColorFromPalette = (id: string) => {
    if (activePalette.length <= 1) {
      showFeedback("La paleta debe tener al menos un color activo.");
      return;
    }
    const color = activePalette.find(c => c.id === id);
    if (color) setColorToDelete(color);
  };

  const confirmRemoveColor = () => {
    if (!colorToDelete) return;
    const updated = activePalette.filter(c => c.id !== colorToDelete.id);
    savePalette(updated);
    if (selectedColorFilter === colorToDelete.id) setSelectedColorFilter('all');
    setColorToDelete(null);
  };

  const addColorToPalette = (colorId: string) => {
    if (activePalette.length >= 6) {
      showFeedback("La paleta puede tener un máximo de 6 colores.");
      return;
    }
    if (activePalette.some(c => c.id === colorId)) return;
    const baseColor = ALL_POSSIBLE_COLORS.find(c => c.id === colorId);
    if (baseColor) {
      savePalette([...activePalette, baseColor]);
    }
  };

  const getInactiveColors = () => {
    return ALL_POSSIBLE_COLORS.filter(pc => !activePalette.some(ap => ap.id === pc.id));
  };

  // Construye el bloque de texto plano de una lista de citas. Si isSorted,
  // agrupa por color de activePalette (igual que el modo agrupado del libro);
  // si no, lista plana en orden de fuente. Extraído para reusarse también en
  // las secciones de citas de recursos (siempre en modo plano, sin colores).
  const buildPlainTextSection = (activeNotes: CitationNote[], isSorted: boolean): string => {
    let textContent = '';
    if (isSorted) {
      const grouped: { [colorId: string]: CitationNote[] } = {};
      const noColorNotes: CitationNote[] = [];

      activeNotes.forEach(note => {
        if (note.color && activePalette.some(c => c.id === note.color)) {
          if (!grouped[note.color]) grouped[note.color] = [];
          grouped[note.color].push(note);
        } else {
          noColorNotes.push(note);
        }
      });

      activePalette.forEach(color => {
         const list = grouped[color.id];
         if (list && list.length > 0) {
           textContent += `${color.name.toUpperCase()}\n`;
           list.forEach(note => {
             const pageStr = note.pageReference ? ` (pág. ${note.pageReference})` : '';
             textContent += `${note.content.replace(/^>\s*/, '')}${pageStr}\n`;
           });
           textContent += '\n';
         }
      });

      if (noColorNotes.length > 0) {
        textContent += "SIN COLOR\n";
        noColorNotes.forEach(note => {
          const pageStr = note.pageReference ? ` (pág. ${note.pageReference})` : '';
          textContent += `${note.content.replace(/^>\s*/, '')}${pageStr}\n`;
        });
        textContent += '\n';
      }
    } else {
      activeNotes.forEach(note => {
        const pageStr = note.pageReference ? ` (pág. ${note.pageReference})` : '';
        textContent += `${note.content.replace(/^>\s*/, '')}${pageStr}\n\n`;
      });
    }
    return textContent;
  };

  // Conditionally export citations following the user's color-sorting rules
  const handleExportCitations = () => {
    const isSorted = isGroupedByColor;
    const activeNotes = getSortedCitations(); // Use our sorted list which is in natural source order!
    const hasResourceCitations = isBookDocument && textResources.some(r => (resourceCitations[r.docId] ?? []).filter(n => n.type !== 'bookmark').length > 0);

    if (activeNotes.length === 0 && !hasResourceCitations) {
      showFeedback("No hay citas seleccionadas para exportar.");
      return;
    }

    let textContent = buildPlainTextSection(activeNotes, isSorted);

    // Apéndice: citas de cada recurso de texto, separadas con su propio encabezado.
    if (isBookDocument) {
      textResources.forEach(r => {
        const list = sortByPageAndTimestamp((resourceCitations[r.docId] ?? []).filter(n => n.type !== 'bookmark'));
        if (list.length === 0) return;
        textContent += `\n\n=== CITAS DEL RECURSO: ${r.title.toUpperCase()} ===\n\n`;
        textContent += buildPlainTextSection(list, false);
      });
    }

    // Create download Blob for .txt file
    const blob = new Blob([textContent], { type: 'text/plain;charset=utf-8' });
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = isSorted ? `Citas_Agrupadas_${documentId}.txt` : `Citas_Listado_${documentId}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(downloadUrl);

    showFeedback("Citas exportadas con éxito.");
  };

  // Construye el bloque markdown de una lista de citas (mismo criterio que
  // buildPlainTextSection, pero con formato blockquote/encabezados markdown).
  const buildMarkdownSection = (activeNotes: CitationNote[], isSorted: boolean): string => {
    let markdown = '';
    if (isSorted) {
      const grouped: { [colorId: string]: CitationNote[] } = {};
      const noColorNotes: CitationNote[] = [];

      activeNotes.forEach(note => {
        if (note.color && activePalette.some(c => c.id === note.color)) {
          if (!grouped[note.color]) grouped[note.color] = [];
          grouped[note.color].push(note);
        } else {
          noColorNotes.push(note);
        }
      });

      activePalette.forEach(color => {
         const list = grouped[color.id];
         if (list && list.length > 0) {
           markdown += `## 🏷️ Citas de Color: ${color.name}\n\n`;
           list.forEach(note => {
             const pageStr = note.pageReference ? ` *(pág. ${note.pageReference})*` : '';
             markdown += `> ${note.content.replace(/^>\s*/, '')}${pageStr}\n\n`;
           });
         }
      });

      if (noColorNotes.length > 0) {
        markdown += "## 🏷️ Citas Sin Color\n\n";
        noColorNotes.forEach(note => {
          const pageStr = note.pageReference ? ` *(pág. ${note.pageReference})*` : '';
          markdown += `> ${note.content.replace(/^>\s*/, '')}${pageStr}\n\n`;
        });
      }
    } else {
      activeNotes.forEach(note => {
        const pageStr = note.pageReference ? ` *(pág. ${note.pageReference})*` : '';
        const colorDef = note.color ? activePalette.find(c => c.id === note.color) : null;
        const colorIndicator = colorDef ? `[${colorDef.name}] ` : '';
        markdown += `> ${colorIndicator}${note.content.replace(/^>\s*/, '')}${pageStr}\n\n`;
      });
    }
    return markdown;
  };

  // Generate a beautiful Markdown document from active citations
  const getCitationsMarkdown = (): string => {
    const isSorted = isGroupedByColor;
    const activeNotes = getSortedCitations();
    const hasResourceCitations = isBookDocument && textResources.some(r => (resourceCitations[r.docId] ?? []).filter(n => n.type !== 'bookmark').length > 0);

    if (activeNotes.length === 0 && !hasResourceCitations) return '';

    let markdown = `# Listado de Citas - Documento ${documentId}\n\n`;
    markdown += buildMarkdownSection(activeNotes, isSorted);

    // Apéndice: citas de cada recurso de texto, en su propia sección.
    if (isBookDocument) {
      textResources.forEach(r => {
        const list = sortByPageAndTimestamp((resourceCitations[r.docId] ?? []).filter(n => n.type !== 'bookmark'));
        if (list.length === 0) return;
        markdown += `\n\n## 📄 Citas de: ${r.title}\n\n`;
        markdown += buildMarkdownSection(list, false);
      });
    }

    return markdown;
  };

  // Export AI summary or Citations to PDF, Word (docx) or Google Doc
  const handleExportFormatted = async (
    format: 'pdf' | 'docx' | 'googledoc' | 'pdfdrive' | 'docx-drive',
    target: 'summary' | 'citations'
  ) => {
    const rawText = target === 'summary' ? editedSummary : getCitationsMarkdown();
    const title = target === 'summary' ? `Resumen Inteligente - ${documentId}` : `Listado de Citas - ${documentId}`;
    
    if (!rawText) {
      showFeedback(target === 'summary' ? "No hay ningún resumen generado para exportar." : "No hay citas seleccionadas para exportar.");
      return;
    }
    
    if (format === 'pdf') {
      exportToPrintPdf(title, rawText);
      showFeedback(`${target === 'summary' ? 'Resumen' : 'Listado de citas'} exportado a PDF correctamente.`);
    } else if (format === 'docx') {
      const filename = target === 'summary' ? `Resumen_Inteligente_${documentId}.docx` : `Listado_Citas_${documentId}.docx`;
      exportToDocx(filename, rawText);
      showFeedback(`${target === 'summary' ? 'Resumen' : 'Listado de citas'} de Word (.docx) descargado.`);
    } else if (format === 'googledoc' || format === 'docx-drive' || format === 'pdfdrive') {
      setIsExportingGoogleDoc(true);
      try {
        showFeedback("Iniciando sesión con Google...");
        const authData = await loginWithGoogle();
        if (authData) {
          showFeedback("Creando archivo en tu Google Drive...");
          const titlePrefix = format === 'pdfdrive' ? '[PDF] ' : '';
          const finalTitle = `${titlePrefix}${title}`;
          const docRes = await createGoogleDoc(finalTitle, rawText, authData.token);
          if (docRes && docRes.id) {
            const url = `https://docs.google.com/document/d/${docRes.id}/edit`;
            setGoogleDocLink(url);
            showFeedback("¡Archivo guardado en Google Drive con éxito!");
          } else {
            throw new Error("No se pudo obtener el ID del documento creado.");
          }
        }
      } catch (e: any) {
        console.error(e);
        showFeedback(`Error al exportar a Google Drive: ${e.message}`);
      } finally {
        setIsExportingGoogleDoc(false);
      }
    }
  };

  // Loading message animation
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isGenerating) {
      let idx = 0;
      setLoadingMsg(LOADING_MESSAGES[0]);
      interval = setInterval(() => {
        idx = (idx + 1) % LOADING_MESSAGES.length;
        setLoadingMsg(LOADING_MESSAGES[idx]);
      }, 2500);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isGenerating]);

  // Prompt template sync on type change
  const handleTypeChange = (type: 'breve' | 'descriptivo' | 'personalizado') => {
    setSummaryType(type);
    setActivePrompt(SUMMARY_PROMPTS[type]);
  };

  // Generate summary using backend API proxy to Gemini
  const handleGenerateSummary = async () => {
    const citationsOnly = notes
      .filter(n => n.type !== 'bookmark' && n.content.trim())
      .map(n => {
        let txt = n.content.trim();
        // Remove markdown quotes if present for cleaner feeding
        if (txt.startsWith('>')) {
          txt = txt.replace(/^>\s*/, '');
        }
        if (n.pageReference) {
          txt += ` (Pág. ${n.pageReference})`;
        }
        return txt;
      });

    if (citationsOnly.length === 0) {
      setSummaryError("No hay citas registradas en este documento. Destaca algún fragmento antes de intentar resumir.");
      return;
    }

    setIsGenerating(true);
    setSummaryError('');
    setGeneratedSummary('');
    setEditedSummary('');
    setIsEditingSummary(false);

    try {
      const response = await fetch('/api/gemini/summarize', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          citations: citationsOnly,
          prompt: activePrompt
        })
      });

      if (!response.ok) {
        const errJson = await response.json();
        throw new Error(errJson.error || "Ocurrió un error al obtener la respuesta de Gemini.");
      }

      const resData = await response.json();
      const text = resData.summary || "";
      setGeneratedSummary(text);
      setEditedSummary(text);
      setIsEditingSummary(false);
    } catch (e: any) {
      console.error(e);
      setSummaryError(e.message || "Fallo inesperado al conectar con el motor de Inteligencia Artificial.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopySummary = () => {
    if (!editedSummary) return;
    navigator.clipboard.writeText(editedSummary);
    setCopyFeedback(true);
    setTimeout(() => setCopyFeedback(false), 2000);
  };

  // Guarda de forma explícita el resumen editado en document_settings,
  // como respaldo al autoguardado para que el usuario tenga confirmación visual.
  const handleSaveSummaryNow = async () => {
    setSummarySaveStatus('saving');
    try {
      await fetch(`/api/documents/${documentId}/settings`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ summaryGen: generatedSummary || null, summaryEdit: editedSummary || null }),
      });
      setSummarySaveStatus('saved');
      setTimeout(() => setSummarySaveStatus('idle'), 2000);
    } catch (e) {
      console.error('No se pudo guardar el resumen:', e);
      setSummarySaveStatus('idle');
    }
  };

  const handleSaveSummaryAsNote = () => {
    if (!editedSummary) return;
    const typeLabel = summaryType === 'breve' ? 'Breve' : summaryType === 'descriptivo' ? 'Descriptivo' : 'Personalizado';
    const newNote: CitationNote = {
      id: crypto.randomUUID(),
      documentId,
      content: `### 🔮 Resumen IA (${typeLabel})\n\n${editedSummary}`,
      pageReference: 'Resumen',
      timestamp: Date.now(),
      type: 'note'
    };
    const updated = [...notes, newNote];
    saveNotes(updated);
    setSaveNoteFeedback(true);
    setTimeout(() => {
      setSaveNoteFeedback(false);
      setShowSummaryView(false);
    }, 1500);
  };

  // Guarda el resumen IA como un recurso de Texto (.txt) en la pestaña
  // Recursos del libro, marcado isSummary:true. Solo disponible cuando
  // documentId es el del libro (no el de un recurso ya existente).
  const handleSaveSummaryAsResource = async () => {
    if (!editedSummary || !isBookDocument) return;
    setSavingSummaryResource(true);
    try {
      const typeLabel = summaryType === 'breve' ? 'Breve' : summaryType === 'descriptivo' ? 'Descriptivo' : 'Personalizado';
      const fileName = `Resumen-${typeLabel}-${Date.now()}.txt`;
      const blob = new Blob([editedSummary], { type: 'text/plain;charset=utf-8' });
      const { url } = await uploadFile(blob, fileName);

      await fetch(`/api/books/${documentId}/resources`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'text',
          title: `Resumen IA (${typeLabel})`,
          source: url,
          fileType: 'txt',
          isSummary: true,
        }),
      });

      setSaveResourceFeedback(true);
      loadResourceCitations(); // refresca la lista para que el divisor de citas lo refleje si luego se cita
      setTimeout(() => setSaveResourceFeedback(false), 2000);
    } catch (e) {
      console.error('No se pudo guardar el resumen como recurso:', e);
    } finally {
      setSavingSummaryResource(false);
    }
  };

  const renderNoteRow = (note: CitationNote, index: number) => {
    const isDraggedNow = draggedIndex === index;
    const colorDef = activePalette.find(c => c.id === note.color);
    return (
       <div 
         key={note.id}
         draggable={!isGroupedByColor}
         onDragStart={(e) => handleDragStart(e, index)}
         onDragOver={(e) => handleDragOver(e, index)}
         onDrop={() => handleDrop(index)}
         onDragEnd={() => setDraggedIndex(null)}
         className={cn(
           "group bg-white border border-slate-150 rounded-lg sm:rounded-xl p-3 sm:p-4 transition-all flex gap-2.5 sm:gap-3 shadow-sm hover:shadow-md items-start",
           note.type === 'bookmark' ? "border-sky-300 bg-sky-50/10" : "",
           isDraggedNow ? "opacity-40 border-dashed border-[#00558F] bg-[#00558F]/5 scale-95" : ""
         )}
         style={note.type !== 'bookmark' && colorDef ? { borderLeft: `4px solid ${colorDef.hex}` } : undefined}
       >
          {/* Drag Handle & Ordering controls. El contenedor es visible siempre;
              dentro, el handle de arrastre solo aplica en desktop y los botones
              subir/bajar solo en móvil (antes el padre estaba oculto en móvil,
              dejando las citas sin forma de reordenarse en el teléfono). */}
          {!isGroupedByColor && (
             <div className="flex flex-col items-center justify-center gap-1.5 shrink-0 text-slate-400 self-center">
                <div className="cursor-grab hover:text-slate-600 p-1 rounded-md active:cursor-grabbing hover:bg-slate-100 hidden sm:block" title="Arrastrar para reordenar">
                   <GripVertical className="w-4 h-4" />
                </div>
                <div className="flex flex-col gap-0.5 sm:hidden">
                   <button 
                     disabled={index === 0} 
                     onClick={() => moveItem(index, 'up')}
                     className="p-1 hover:bg-slate-100 rounded disabled:opacity-20 text-slate-500"
                   >
                      <ChevronUp className="w-4 h-4" />
                   </button>
                   <button 
                     disabled={index === notes.length - 1} 
                     onClick={() => moveItem(index, 'down')}
                     className="p-1 hover:bg-slate-100 rounded disabled:opacity-20 text-slate-500"
                   >
                      <ChevronDown className="w-4 h-4" />
                   </button>
                </div>
             </div>
          )}

          <div className="flex-1 min-w-0">
             {/* Content Editor / Text View */}
             {editingNoteId === note.id ? (
                <div className="mt-2 space-y-3">
                   <textarea 
                      className="w-full text-sm bg-white border border-slate-200 focus:border-[#00558F] rounded-xl p-3 outline-none shadow-inner resize-none min-h-[90px]"
                      value={editContent}
                      onChange={e => setEditContent(e.target.value)}
                   />
                   <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1 bg-slate-100 border rounded-lg px-2 py-1 max-w-[150px]">
                         <span className="text-xs text-slate-500 font-bold shrink-0">Pág:</span>
                         <input 
                           type="text" 
                           value={editPage} 
                           onChange={e => setEditPage(e.target.value)} 
                           className="w-full text-xs font-bold outline-none bg-transparent"
                         />
                      </div>
                      <div className="flex gap-1.5">
                         <button onClick={() => setEditingNoteId(null)} className="text-xs font-medium bg-slate-150 text-slate-600 px-3 py-1.5 rounded-lg hover:bg-slate-200 transition-colors">Cancelar</button>
                         <button onClick={() => handleSaveEdit(note.id)} className="text-xs font-bold bg-[#00558F] text-white px-3 py-1.5 rounded-lg hover:bg-[#004d80] transition-colors shadow-sm">Guardar</button>
                      </div>
                   </div>
                </div>
             ) : (
                <div 
                   onDoubleClick={() => startEditing(note)}
                   onClick={() => {
                      const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
                      if (isTouch) {
                         startEditing(note);
                       }
                   }}
                   className="text-xs sm:text-sm prose prose-sm prose-slate max-w-none text-slate-700 font-medium leading-normal cursor-pointer hover:text-slate-900 transition-colors py-0.5 select-none break-words overflow-hidden"
                   title="Doble clic para editar (toque en pantalla táctil)"
                >
                   {/* Enforce inline rendering of text selection highlight inside paragraph as user requested */}
                   <div className="inline-block text-slate-800 not-italic">
                      <ReactMarkdown 
                        components={{ 
                          p: ({node, ...props}) => <span className="text-xs sm:text-sm inline not-italic" {...props} />,
                          blockquote: ({node, ...props}) => <span className="border-l-[3px] border-[#00558F]/30 pl-2 text-slate-600 not-italic inline" {...props} />
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
                                onClose();
                              }}
                              className="text-[10px] sm:text-xs text-[#00558F]/90 hover:text-[#00558F] font-semibold hover:underline inline"
                            >
                               (pag.{note.pageReference})
                            </button>
                         </>
                      )}
                   </div>
                </div>
             )}
          </div>

          {/* Secondary Operations in a single top-aligned horizontal line */}
          <div className="flex flex-row items-center shrink-0 gap-1 sm:gap-2 self-start pt-0.5">
             {/* Color Selector Popover triggered by single active assigned color dot */}
             {note.type !== 'bookmark' && colorDef && (
                <div className="relative">
                   <button 
                     onClick={(e) => {
                        e.stopPropagation();
                        setActiveColorPickerNoteId(prev => prev === note.id ? null : note.id);
                     }}
                     className="w-4 h-4 rounded-full border border-black/15 transition-transform hover:scale-110 active:scale-95 shadow-sm cursor-pointer block animate-in fade-in duration-200"
                     style={{ backgroundColor: colorDef.hex }}
                     title={`Cambiar color (actual: ${colorDef.name})`}
                   />
                   
                   {activeColorPickerNoteId === note.id && (
                      <div 
                        className="absolute right-0 top-6 z-55 bg-white border border-slate-205 shadow-xl rounded-xl p-2 flex gap-1.5 animate-in fade-in slide-in-from-top-1 duration-150 flex-row"
                        onClick={(e) => e.stopPropagation()}
                      >
                         {activePalette.map(color => (
                            <button 
                              key={color.id}
                              style={{ backgroundColor: color.hex }}
                              onClick={(e) => {
                                 e.stopPropagation();
                                 const updated = notes.map(n => n.id === note.id ? { ...n, color: color.id } : n);
                                 saveNotes(updated);
                                 setActiveColorPickerNoteId(null);
                              }}
                              className={cn(
                                 "w-4 h-4 rounded-full border border-black/10 transition-all active:scale-90 cursor-pointer block",
                                 note.color === color.id ? "ring-2 ring-indigo-500 scale-105" : "opacity-60 hover:opacity-100 hover:scale-105"
                              )}
                              title={`Seleccionar color ${color.name}`}
                            />
                         ))}
                      </div>
                   )}
                </div>
             )}

             {/* Lápiz rápidamente */}
             <button 
               onClick={(e) => {
                  e.stopPropagation();
                  startEditing(note);
               }}
               className="p-1 sm:p-1.5 rounded-lg text-slate-400 hover:text-[#00558F] hover:bg-[#00558F]/5 transition-colors cursor-pointer shrink-0"
               title="Editar cita"
             >
                <Edit2 className="w-3.5 h-3.5 sm:w-3.5 sm:h-3.5" />
             </button>

             {/* Trash bin */}
             <button 
               onClick={(e) => {
                  e.stopPropagation();
                  deleteCitation(note.id);
               }}
               className="p-1 sm:p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-rose-50 transition-colors cursor-pointer shrink-0"
               title="Eliminar cita"
             >
                <Trash2 className="w-3.5 h-3.5 sm:w-3.5 sm:h-3.5" />
             </button>
          </div>
       </div>
    );
  };

  // Fila de cita de un RECURSO de texto: versión simplificada de renderNoteRow
  // (sin selector de color/agrupado, con botones subir/bajar en vez de drag&drop)
  // para mantener renderNoteRow y el comportamiento del libro intactos.
  const renderResourceNoteRow = (resDocId: string, note: CitationNote, index: number, total: number) => {
    const isEditingThis = editingNoteId === note.id && editingDocId === resDocId;
    return (
      <div
        key={note.id}
        className="group bg-white border border-slate-150 rounded-lg sm:rounded-xl p-2 sm:p-4 transition-all flex gap-2.5 sm:gap-3 shadow-sm hover:shadow-md items-start"
      >
        <div className="flex flex-col gap-0.5 shrink-0 self-center">
          <button disabled={index === 0} onClick={() => moveResourceItem(resDocId, index, 'up')} className="p-1 hover:bg-slate-100 rounded disabled:opacity-20 text-slate-500">
            <ChevronUp className="w-4 h-4" />
          </button>
          <button disabled={index === total - 1} onClick={() => moveResourceItem(resDocId, index, 'down')} className="p-1 hover:bg-slate-100 rounded disabled:opacity-20 text-slate-500">
            <ChevronDown className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 min-w-0">
          {isEditingThis ? (
            <div className="mt-2 space-y-3">
              <textarea
                className="w-full text-sm bg-white border border-slate-200 focus:border-[#00558F] rounded-xl p-3 outline-none shadow-inner resize-none min-h-[90px]"
                value={editContent}
                onChange={e => setEditContent(e.target.value)}
              />
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1 bg-slate-100 border rounded-lg px-2 py-1 max-w-[150px]">
                  <span className="text-xs text-slate-500 font-bold shrink-0">Pág:</span>
                  <input type="text" value={editPage} onChange={e => setEditPage(e.target.value)} className="w-full text-xs font-bold outline-none bg-transparent" />
                </div>
                <div className="flex gap-1.5">
                  <button onClick={() => { setEditingNoteId(null); setEditingDocId(null); }} className="text-xs font-medium bg-slate-150 text-slate-600 px-3 py-1.5 rounded-lg hover:bg-slate-200 transition-colors">Cancelar</button>
                  <button onClick={() => handleSaveResourceEdit(resDocId, note.id)} className="text-xs font-bold bg-[#00558F] text-white px-3 py-1.5 rounded-lg hover:bg-[#004d80] transition-colors shadow-sm">Guardar</button>
                </div>
              </div>
            </div>
          ) : (
            <div
              onDoubleClick={() => startEditingResource(resDocId, note)}
              onClick={() => {
                const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
                if (isTouch) startEditingResource(resDocId, note);
              }}
              className="text-xs sm:text-sm prose prose-sm prose-slate max-w-none text-slate-700 font-medium leading-normal cursor-pointer hover:text-slate-900 transition-colors py-0.5 select-none break-words overflow-hidden"
              title="Doble clic para editar (toque en pantalla táctil)"
            >
              <div className="inline-block text-slate-800 not-italic">
                <ReactMarkdown
                  components={{
                    p: ({node, ...props}) => <span className="text-xs sm:text-sm inline not-italic" {...props} />,
                    blockquote: ({node, ...props}) => <span className="border-l-[3px] border-[#00558F]/30 pl-2 text-slate-600 not-italic inline" {...props} />
                  }}
                >
                  {note.content}
                </ReactMarkdown>
                {note.pageReference && <span className="text-[10px] sm:text-xs text-[#00558F]/70 font-semibold"> (pag.{note.pageReference})</span>}
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-row items-center shrink-0 gap-1 sm:gap-2 self-start pt-0.5">
          <button onClick={(e) => { e.stopPropagation(); startEditingResource(resDocId, note); }} className="p-1 sm:p-1.5 rounded-lg text-slate-400 hover:text-[#00558F] hover:bg-[#00558F]/5 transition-colors cursor-pointer shrink-0" title="Editar cita">
            <Edit2 className="w-3.5 h-3.5" />
          </button>
          <button onClick={(e) => { e.stopPropagation(); deleteResourceCitation(resDocId, note.id); }} className="p-1 sm:p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-rose-50 transition-colors cursor-pointer shrink-0" title="Eliminar cita">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    );
  };

  const documentCitationsCount = notes.filter(n => n.type !== 'bookmark' && n.content.trim()).length;
  const filteredCitations = notes.filter(n => n.type !== 'bookmark' && (selectedColorFilter === 'all' || n.color === selectedColorFilter));

  // Memoizado: getSortedCitations() filtra+ordena TODAS las notas, y se
  // necesitaba en varios puntos del render (incluido dentro de .map() por
  // cada cita para hallar su índice), repitiendo el filtro+sort O(N) veces
  // por cada una de las N citas — un freeze notable con muchas citas.
  const sortedCitations = useMemo(() => getSortedCitations(), [notes, selectedColorFilter]);
  const sortedCitationIndexById = useMemo(() => {
    const map = new Map<string, number>();
    sortedCitations.forEach((n, i) => map.set(n.id, i));
    return map;
  }, [sortedCitations]);

  return (
    <div className="absolute inset-0 z-50 bg-slate-50 flex flex-col overflow-hidden animate-in fade-in duration-200">
      
      {/* Google Document Created Banner */}
      {googleDocLink && (
        <div className="bg-indigo-600 text-white px-4 py-3 flex items-center justify-between gap-4 animate-in slide-in-from-top duration-350 shrink-0 z-50 shadow-md">
          <div className="flex items-center gap-2.5">
            <BookMarked className="w-5 h-5 text-indigo-150 animate-bounce" />
            <p className="text-xs sm:text-sm font-bold">
              ¡Tu Google Doc se ha creado! Haz clic en el enlace para abrirlo en una nueva pestaña:
            </p>
            <a 
              href={googleDocLink} 
              target="_blank" 
              rel="noopener noreferrer" 
              className="bg-white text-indigo-700 hover:bg-slate-55 transition-all font-extrabold px-3 py-1.5 rounded-lg text-xs tracking-wider uppercase ml-1 shadow-sm shrink-0"
            >
              Abrir Google Doc
            </a>
          </div>
          <button 
            onClick={() => setGoogleDocLink(null)} 
            className="text-white hover:text-white/80 p-1 rounded-md hover:bg-white/10"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      
      {/* Upper Navigation Bar */}
      <header className="bg-white border-b border-slate-200 px-4 py-3 md:h-16 md:py-0 flex flex-col md:flex-row md:items-center justify-between gap-2.5 md:gap-0 shrink-0 shadow-sm z-30">
         <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={showSummaryView ? () => { setShowSummaryView(false); setSummaryError(''); } : onClose}
              className="p-2 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors cursor-pointer shrink-0"
              title={showSummaryView ? "Volver a las citas" : "Volver al lector"}
            >
               {showSummaryView ? <ChevronLeft className="w-5 h-5" /> : <X className="w-5 h-5" />}
            </button>
            <div className="min-w-0">
               <h2 className="text-base font-extrabold text-slate-800 tracking-tight leading-none truncate">
                 {showSummaryView ? "Resumen Inteligente" : "Administración de Citas"}
               </h2>
               <p className="text-[11px] text-slate-500 mt-1 truncate md:whitespace-normal">
                 {showSummaryView ? "Potenciado por Gemini 3.5 Flash" : "Organiza, reordena, exporta y configura tus notas y marcadores"}
               </p>
            </div>
         </div>

         <div className="flex items-center gap-2 shrink-0">
            <button 
              onClick={() => setShowSummaryView(prev => !prev)}
              className={cn(
                "text-xs flex items-center gap-1.5 font-bold px-3 py-2 rounded-lg transition-all border shadow-sm cursor-pointer",
                showSummaryView 
                  ? "bg-slate-100 border-slate-300 text-slate-700 hover:bg-slate-200" 
                  : "bg-indigo-55 text-indigo-700 hover:bg-indigo-100 border-indigo-100"
              )}
              title={showSummaryView ? "Regresar a la administración de citas" : "Generar resumen de citas con Gemini"}
            >
               {showSummaryView ? <BookOpen className="w-3.5 h-3.5 text-slate-600" /> : <Sparkles className="w-3.5 h-3.5 text-indigo-600 animate-pulse" />}
               <span>{showSummaryView ? "Ver Citas" : "Resumen IA"}</span>
            </button>

            {/* Smart Adaptable Export Button */}
            <div className="relative">
              <button 
                onClick={() => setShowExportSummaryDropdown(prev => !prev)}
                className="text-xs flex items-center gap-1.5 font-bold px-3 py-2 rounded-lg bg-[#00558F]/10 text-[#00558F] hover:bg-[#00558F]/20 transition-colors shadow-sm cursor-pointer"
                title={showSummaryView ? "Exportar resumen IA en diferentes formatos" : "Exportar listado de citas"}
              >
                 <Download className="w-4 h-4" />
                 <span>Exportar</span>
              </button>
              
              {showExportSummaryDropdown && (
                <div 
                  className="absolute right-0 top-11 z-50 w-72 bg-white border border-slate-200/90 shadow-2xl rounded-2xl p-3 animate-in fade-in slide-in-from-top-2 duration-150 flex flex-col gap-2.5"
                  onMouseLeave={() => setShowExportSummaryDropdown(false)}
                >
                   {/* Word Category */}
                   <div className="space-y-1">
                     <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest px-2.5 block">1. Documento de Word</span>
                     <button
                       onClick={() => {
                          setShowExportSummaryDropdown(false);
                          handleExportFormatted('docx', showSummaryView ? 'summary' : 'citations');
                       }}
                       className="w-full text-left text-xs font-semibold text-slate-700 hover:text-[#00558F] hover:bg-slate-50 p-2.5 rounded-xl transition-colors flex items-center justify-between cursor-pointer"
                     >
                       <div className="flex items-center gap-2.5">
                         <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                         <span>Descargar archivo (.docx)</span>
                       </div>
                       <span className="text-[9px] bg-emerald-50 text-emerald-600 px-1.5 py-0.5 rounded font-bold">Local</span>
                     </button>
                     <button
                       onClick={() => {
                          setShowExportSummaryDropdown(false);
                          handleExportFormatted('docx-drive', showSummaryView ? 'summary' : 'citations');
                       }}
                       disabled={isExportingGoogleDoc}
                       className="w-full text-left text-xs font-semibold text-slate-700 hover:text-[#00558F] hover:bg-slate-50 p-2.5 rounded-xl transition-colors flex items-center justify-between cursor-pointer disabled:opacity-40"
                     >
                       <div className="flex items-center gap-2.5">
                         <FileText className="w-4 h-4 text-blue-500" />
                         <span>Crear en Google Drive</span>
                       </div>
                       <span className="text-[9px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded font-bold">Drive</span>
                     </button>
                   </div>

                   <div className="h-px bg-slate-100" />

                   {/* PDF Category */}
                   <div className="space-y-1">
                     <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest px-2.5 block">2. Documento PDF</span>
                     <button
                       onClick={() => {
                          setShowExportSummaryDropdown(false);
                          handleExportFormatted('pdf', showSummaryView ? 'summary' : 'citations');
                       }}
                       className="w-full text-left text-xs font-semibold text-slate-700 hover:text-[#00558F] hover:bg-slate-50 p-2.5 rounded-xl transition-colors flex items-center justify-between cursor-pointer"
                     >
                       <div className="flex items-center gap-2.5">
                         <Printer className="w-4 h-4 text-rose-500" />
                         <span>Descargar / Imprimir PDF</span>
                       </div>
                       <span className="text-[9px] bg-rose-50 text-rose-600 px-1.5 py-0.5 rounded font-bold">Local</span>
                     </button>
                     <button
                       onClick={() => {
                          setShowExportSummaryDropdown(false);
                          handleExportFormatted('pdfdrive', showSummaryView ? 'summary' : 'citations');
                       }}
                       disabled={isExportingGoogleDoc}
                       className="w-full text-left text-xs font-semibold text-slate-700 hover:text-[#00558F] hover:bg-slate-50 p-2.5 rounded-xl transition-colors flex items-center justify-between cursor-pointer disabled:opacity-40"
                     >
                       <div className="flex items-center gap-2.5">
                         <FileText className="w-4 h-4 text-rose-500" />
                         <span>Crear en Google Drive</span>
                       </div>
                       <span className="text-[9px] bg-rose-50 text-rose-600 px-1.5 py-0.5 rounded font-bold">Drive</span>
                     </button>
                   </div>

                   {!showSummaryView && (
                     <>
                       <div className="h-px bg-slate-100" />
                       <div className="space-y-1">
                         <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest px-2.5 block">Otros formatos</span>
                         <button
                           onClick={() => {
                              setShowExportSummaryDropdown(false);
                              handleExportCitations();
                           }}
                           className="w-full text-left text-xs font-semibold text-slate-700 hover:text-[#00558F] hover:bg-slate-50 p-2.5 rounded-xl transition-colors flex items-center justify-between cursor-pointer"
                         >
                           <div className="flex items-center gap-2.5">
                             <FileText className="w-4 h-4 text-slate-500" />
                             <span>Descargar listado (.txt)</span>
                           </div>
                           <span className="text-[9px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-bold">TXT</span>
                         </button>
                       </div>
                     </>
                   )}
                </div>
              )}
            </div>

            <button 
              onClick={() => setShowConfigModal(true)}
              className="p-2 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors border border-slate-200 shadow-sm cursor-pointer"
              title="Personalizar paleta de colores"
            >
               <Settings2 className="w-4 h-4" />
            </button>
         </div>
      </header>

      {/* Main Container */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden relative">
         
         {/* Feedbacks / Toast Messages */}
         {message && (
            <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-50 bg-slate-800 text-white text-xs px-4 py-2.5 rounded-xl shadow-xl flex items-center gap-2 animate-in fade-in slide-in-from-top-3 duration-200 font-medium">
               <Check className="w-3.5 h-3.5 text-emerald-400" />
               {message}
            </div>
         )}

         {showSummaryView ? (
            /* In-place AI Summarizer View optimized for Mobile & Web */
            <div className="flex-1 flex flex-col bg-slate-50/50 overflow-y-auto animate-in fade-in duration-300">
               <div className="max-w-3xl w-full mx-auto px-4 py-6 sm:py-8 space-y-6">
                 
                 {/* Back option for high usability in mobile */}
                 <div className="flex justify-between items-center pb-2 border-b border-slate-200/60 transition-all">
                   <button 
                     onClick={() => { setShowSummaryView(false); setSummaryError(''); }}
                     className="text-xs font-bold text-slate-600 hover:text-slate-900 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-50 shadow-sm cursor-pointer"
                   >
                     <ChevronLeft className="w-3.5 h-3.5 text-slate-500" />
                     Volver a citas
                   </button>
                   <span className="text-xs font-semibold text-slate-400">Pautas de Resumen IA</span>
                 </div>

                 {documentCitationsCount === 0 ? (
                   <div className="bg-white border rounded-2xl p-8 sm:p-12 text-center shadow-md max-w-xl mx-auto space-y-4 mt-4 animate-in zoom-in-95 duration-200">
                     <div className="w-16 h-16 bg-amber-50 text-amber-500 rounded-full flex items-center justify-center mx-auto border border-amber-100 shadow-xs">
                       <Info className="w-8 h-8" />
                     </div>
                     <div className="space-y-1">
                       <h4 className="font-extrabold text-slate-800 text-sm">No se encontraron citas anotadas</h4>
                       <p className="text-xs text-slate-500 max-w-sm mx-auto leading-relaxed">
                         Para poder generar un resumen inteligente, primero debes destacar textos relevantes dentro del documento actual o ingresar tus propias anotaciones.
                       </p>
                     </div>
                     <button 
                       onClick={() => setShowSummaryView(false)}
                       className="mt-2 text-xs font-bold px-4 py-2.5 border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 rounded-xl shadow-xs transition-all w-full sm:w-auto cursor-pointer"
                     >
                       Regresar y Destacar Texto
                     </button>
                   </div>
                 ) : (
                   <>
                     {/* Selector of summary levels */}
                     <div className="space-y-2">
                       <span className="text-xs font-extrabold text-slate-500 uppercase tracking-wider block">
                         Tipo de Resumen Deseado:
                       </span>
                       <div className="grid grid-cols-3 gap-2 sm:gap-3">
                         <button
                           onClick={() => handleTypeChange('breve')}
                           className={cn(
                             "flex flex-col items-center justify-center p-3 sm:p-4 rounded-xl border text-center transition-all cursor-pointer min-h-[85px] sm:min-h-[100px]",
                             summaryType === 'breve'
                               ? "bg-indigo-50/70 border-indigo-400 text-indigo-800 font-extrabold shadow-sm ring-1 ring-indigo-400/20"
                               : "bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50 text-xs font-semibold"
                           )}
                         >
                           <Sparkles className={cn("w-4 h-4 mb-1.5", summaryType === 'breve' ? "text-indigo-600" : "text-slate-400")} />
                           <span className="text-xs font-bold">Breve</span>
                           <span className="text-[10px] font-normal text-slate-400/85 mt-0.5 leading-tight hidden xs:block">Sintético y conciso</span>
                         </button>

                         <button
                           onClick={() => handleTypeChange('descriptivo')}
                           className={cn(
                             "flex flex-col items-center justify-center p-3 sm:p-4 rounded-xl border text-center transition-all cursor-pointer min-h-[85px] sm:min-h-[100px]",
                             summaryType === 'descriptivo'
                               ? "bg-indigo-50/70 border-indigo-400 text-indigo-800 font-extrabold shadow-sm ring-1 ring-indigo-400/20"
                               : "bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50 text-xs font-semibold"
                           )}
                         >
                           <FileText className={cn("w-4 h-4 mb-1.5", summaryType === 'descriptivo' ? "text-indigo-600" : "text-slate-400")} />
                           <span className="text-xs font-bold">Descriptivo</span>
                           <span className="text-[10px] font-normal text-slate-400/85 mt-0.5 leading-tight hidden xs:block">Lógico e íntegro</span>
                         </button>

                         <button
                           onClick={() => handleTypeChange('personalizado')}
                           className={cn(
                             "flex flex-col items-center justify-center p-3 sm:p-4 rounded-xl border text-center transition-all cursor-pointer min-h-[85px] sm:min-h-[100px]",
                             summaryType === 'personalizado'
                               ? "bg-indigo-50/70 border-indigo-400 text-indigo-800 font-extrabold shadow-sm ring-1 ring-indigo-400/20"
                               : "bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50 text-xs font-semibold"
                           )}
                         >
                           <Edit2 className={cn("w-4 h-4 mb-1.5", summaryType === 'personalizado' ? "text-indigo-600" : "text-slate-400")} />
                           <span className="text-xs font-bold">A medida</span>
                           <span className="text-[10px] font-normal text-slate-400/85 mt-0.5 leading-tight hidden xs:block">Instrucción custom</span>
                         </button>
                       </div>
                     </div>

                     {/* Active prompt config - SIGNIFICANTLY TALLER and optimized for Mobile */}
                     <div className="space-y-2">
                       <span className="text-xs font-extrabold text-slate-500 uppercase tracking-wider flex items-center justify-between">
                         <span>Indicaciones / Instrucciones de Resumen:</span>
                         {summaryType !== 'personalizado' && (
                           <span className="text-[10px] text-indigo-500 font-bold italic bg-indigo-50/80 px-2 py-0.5 rounded-md">Por defecto</span>
                         )}
                       </span>
                       <textarea
                         value={activePrompt}
                         onChange={(e) => setActivePrompt(e.target.value)}
                         placeholder="Ingresa las instrucciones específicas de organización y síntesis para Gemini..."
                         className="w-full text-xs sm:text-sm font-semibold text-slate-800 bg-white border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none rounded-2xl p-4 shadow-sm min-h-[160px] sm:min-h-[200px] transition-all leading-normal"
                       />
                     </div>

                     {/* Generate Trigger */}
                     {!generatedSummary && !isGenerating && (
                       <div className="flex justify-center pt-2">
                         <button
                           onClick={handleGenerateSummary}
                           className="w-full sm:w-auto flex items-center justify-center gap-2 px-8 py-3.5 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs sm:text-sm tracking-wide shadow-md hover:shadow-lg active:scale-[0.98] transform transition-all cursor-pointer"
                         >
                           <Sparkles className="w-4 h-4 text-white animate-pulse" />
                           Generar Resumen con Gemini ({documentCitationsCount} citas)
                         </button>
                       </div>
                     )}

                     {/* Generation Error */}
                     {summaryError && (
                       <div className="p-4 bg-rose-50 text-rose-600 rounded-2xl border border-rose-150 text-xs font-bold shadow-xs">
                         {summaryError}
                       </div>
                     )}

                     {/* Loading State */}
                     {isGenerating && (
                       <div className="flex flex-col items-center justify-center py-10 px-4 space-y-4 bg-white border border-slate-200/60 rounded-2xl shadow-xs">
                         <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
                         <div className="text-center space-y-1">
                           <p className="text-sm font-extrabold text-indigo-900 tracking-wide">Espera un momento...</p>
                           <p className="text-xs text-slate-500 italic animate-pulse px-4">{loadingMsg}</p>
                         </div>
                       </div>
                     )}

                     {/* Render result & edit controls once generated */}
                     {generatedSummary && !isGenerating && (
                       <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-300 pt-2">
                         <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white border border-slate-200/65 rounded-xl p-3 shadow-xs">
                           <div>
                             <span className="text-[10px] font-extrabold text-indigo-500 uppercase tracking-widest block mb-0.5">Control de Documento</span>
                             <span className="text-xs font-semibold text-slate-500">Usa las pestañas para leer o editar el resumen</span>
                           </div>
                           
                           {/* Tab toggle between Edit and Preview */}
                           <div className="flex bg-slate-100 p-1 rounded-lg self-start sm:self-center w-full sm:w-auto">
                             <button
                               onClick={() => setIsEditingSummary(false)}
                               className={cn(
                                 "flex-1 sm:flex-initial px-4 py-1.5 text-xs font-bold rounded-md transition-all cursor-pointer",
                                 !isEditingSummary 
                                   ? "bg-white text-indigo-700 shadow-xs scale-105" 
                                   : "text-slate-500 hover:text-slate-800"
                               )}
                             >
                               Vista Previa (MD)
                             </button>
                             <button
                               onClick={() => setIsEditingSummary(true)}
                               className={cn(
                                 "flex-1 sm:flex-initial px-4 py-1.5 text-xs font-bold rounded-md transition-all cursor-pointer",
                                 isEditingSummary 
                                   ? "bg-white text-indigo-700 shadow-xs scale-105" 
                                   : "text-slate-500 hover:text-slate-800"
                               )}
                             >
                               Editar Resumen
                             </button>
                           </div>
                         </div>

                         {/* Summary Editor Textarea / Preview Block */}
                         <div className="bg-white border border-slate-200/80 rounded-2xl shadow-sm overflow-hidden flex flex-col min-h-[280px] sm:min-h-[350px] relative">
                           {isEditingSummary ? (
                             <textarea
                               value={editedSummary}
                               onChange={(e) => setEditedSummary(e.target.value)}
                               placeholder="Modifica el contenido del resumen producido aquí..."
                               className="flex-1 w-full h-full p-4 sm:p-5 text-xs sm:text-sm font-semibold text-slate-800 leading-relaxed outline-none border-none resize-none focus:ring-0 custom-scrollbar"
                             />
                           ) : (
                             <div className="flex-1 overflow-y-auto p-4 sm:p-5 custom-scrollbar bg-white">
                               <div className="markdown-body text-slate-700 text-xs sm:text-sm leading-relaxed prose prose-indigo prose-sm">
                                 <ReactMarkdown>{editedSummary || '*El resumen se encuentra vacío. Selecciona la pestaña Editar para escribir algo.*'}</ReactMarkdown>
                               </div>
                             </div>
                           )}
                         </div>

                         {/* Secondary Operations bar (Saving / Copying / Regenerating) */}
                         <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
                           <button
                             onClick={handleGenerateSummary}
                             className="text-xs text-indigo-600 hover:text-indigo-800 font-bold flex items-center justify-center sm:justify-start gap-1.5 hover:underline transition-all py-1.5 cursor-pointer"
                           >
                             <Sparkles className="w-3.5 h-3.5" /> Regenerar de nuevo
                           </button>

                           <div className="flex items-center gap-2 w-full sm:w-auto">
                             <button
                               onClick={handleSaveSummaryNow}
                               disabled={summarySaveStatus === 'saving'}
                               className="flex-1 sm:flex-initial text-xs font-bold text-slate-700 hover:text-slate-900 bg-white hover:bg-slate-50 border border-slate-250 px-4 py-2.5 rounded-xl transition-all shadow-xs flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
                               title="Guardar el resumen editado"
                             >
                               {summarySaveStatus === 'saving' ? (
                                 <>
                                   <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-500" />
                                   Guardando...
                                 </>
                               ) : summarySaveStatus === 'saved' ? (
                                 <>
                                   <Check className="w-3.5 h-3.5 text-green-500" />
                                   Guardado
                                 </>
                               ) : (
                                 <>
                                   <Save className="w-3.5 h-3.5 text-slate-500" />
                                   Guardar
                                 </>
                               )}
                             </button>
                             <button
                               onClick={handleCopySummary}
                               className="flex-1 sm:flex-initial text-xs font-bold text-slate-700 hover:text-slate-900 bg-white hover:bg-slate-50 border border-slate-250 px-4 py-2.5 rounded-xl transition-all shadow-xs flex items-center justify-center gap-1.5 cursor-pointer"
                             >
                               {copyFeedback ? (
                                 <>
                                   <Check className="w-3.5 h-3.5 text-green-500" />
                                   Copiado
                                 </>
                               ) : (
                                 <>
                                   <Copy className="w-3.5 h-3.5 text-slate-500" />
                                   Copiar Texto
                                 </>
                               )}
                             </button>
                             <button
                               onClick={handleSaveSummaryAsNote}
                               className="flex-1 sm:flex-initial text-xs font-extrabold text-white bg-indigo-600 hover:bg-indigo-700 px-4 py-2.5 rounded-xl transition-all shadow-sm flex items-center justify-center gap-1.5 cursor-pointer"
                             >
                               {saveNoteFeedback ? (
                                 <>
                                   <Check className="w-3.5 h-3.5 text-white" />
                                   Guardado
                                 </>
                               ) : (
                                 <>
                                   <Save className="w-3.5 h-3.5 text-white/90" />
                                   Guardar Nota
                                 </>
                               )}
                             </button>
                             {isBookDocument && (
                               <button
                                 onClick={handleSaveSummaryAsResource}
                                 disabled={savingSummaryResource}
                                 className="flex-1 sm:flex-initial text-xs font-extrabold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-60 px-4 py-2.5 rounded-xl transition-all shadow-sm flex items-center justify-center gap-1.5 cursor-pointer"
                                 title="Guarda el resumen como un recurso de Texto en la pestaña Recursos"
                               >
                                 {saveResourceFeedback ? (
                                   <>
                                     <Check className="w-3.5 h-3.5 text-white" />
                                     Guardado
                                   </>
                                 ) : savingSummaryResource ? (
                                   <>
                                     <Loader2 className="w-3.5 h-3.5 text-white/90 animate-spin" />
                                     Guardando…
                                   </>
                                 ) : (
                                   <>
                                     <FolderOpen className="w-3.5 h-3.5 text-white/90" />
                                     Guardar como recurso
                                   </>
                                 )}
                               </button>
                             )}
                           </div>
                         </div>
                       </div>
                     )}
                   </>
                 )}
               </div>
            </div>
         ) : (
            <>
               {/* Desktop Left Controls/Filters Panel - Hidden on Mobile */}
               <aside className="hidden md:flex w-64 bg-white border-r border-slate-200 p-4 shrink-0 flex-col gap-4">
                  <div>
                     <div className="flex items-center justify-between mb-2.5">
                        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Filtrar por Color</h4>
                        {activePalette.length < 6 && (
                           <button
                             onClick={() => setShowConfigModal(true)}
                             className="p-1 rounded-md text-slate-400 hover:text-[#00558F] hover:bg-[#00558F]/5 transition-colors cursor-pointer"
                             title="Añadir color"
                           >
                              <Plus className="w-3.5 h-3.5" />
                           </button>
                        )}
                     </div>
                     <div className="flex flex-col gap-1.5">
                        <button
                          onClick={() => setSelectedColorFilter('all')}
                          className={cn(
                            "text-left text-xs font-semibold px-3 py-2 rounded-lg flex items-center gap-2 w-full transition-all border",
                            selectedColorFilter === 'all' 
                              ? "bg-[#00558F]/5 text-[#00558F] border-[#00558F]/20 shadow-sm" 
                              : "bg-transparent text-slate-600 hover:bg-slate-50 border-transparent"
                          )}
                        >
                           <div className="w-2.5 h-2.5 rounded-full bg-slate-300 border border-slate-400" />
                           Todos ({notes.filter(n => n.type !== 'bookmark').length})
                        </button>
                        {activePalette.map(color => {
                          const count = notes.filter(n => n.type !== 'bookmark' && n.color === color.id).length;
                          return (
                            <div 
                              key={color.id}
                              onClick={() => setSelectedColorFilter(color.id)}
                              className={cn(
                                "cursor-pointer flex items-center justify-between gap-1 px-3 py-2 rounded-lg border transition-all text-xs font-semibold w-full",
                                selectedColorFilter === color.id 
                                  ? "bg-[#00558F]/5 text-[#00558F] border-[#00558F]/20 shadow-sm" 
                                  : "bg-transparent text-slate-600 hover:bg-slate-50 border-transparent hover:border-slate-100"
                              )}
                            >
                               <div className="flex items-center gap-2 min-w-0 flex-1">
                                  {/* Color Picker interactivo */}
                                  <div 
                                    className="relative w-3.5 h-3.5 rounded-full border border-black/10 shadow-sm shrink-0 overflow-hidden cursor-pointer hover:scale-110 active:scale-95 transition-all" 
                                    style={{ backgroundColor: color.hex }}
                                    onClick={e => e.stopPropagation()}
                                  >
                                    <input 
                                      type="color" 
                                      value={color.hex} 
                                      onChange={e => updateColorHex(color.id, e.target.value)}
                                      className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                                      title="Cambiar color de etiqueta"
                                    />
                                  </div>
                                  
                                  {/* Input inline para cambiar nombre */}
                                  <input 
                                    type="text"
                                    value={color.name}
                                    onChange={e => updateColorName(color.id, e.target.value)}
                                    onClick={e => e.stopPropagation()}
                                    className="bg-transparent border-none p-0 text-xs font-semibold focus:ring-1 focus:ring-[#00558F]/35 focus:outline-none focus:bg-white rounded px-1 flex-1 truncate text-left min-w-0"
                                    placeholder="Nombre..."
                                    title="Escriba para cambiar nombre de etiqueta"
                                  />
                               </div>
                               
                               <span className="text-[10px] opacity-60 shrink-0 ml-1">({count})</span>
                            </div>
                          );
                        })}
                     </div>
                  </div>

                  <div className="h-px bg-slate-100" />

                  <div>
                     <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2.5">Herramientas de Orden</h4>
                     <div className="flex flex-col gap-2">
                        <button 
                          onClick={handleSortByColor}
                          className={cn(
                            "w-full text-xs font-semibold p-2.5 rounded-xl flex items-center justify-start gap-2 transition-all shadow-sm active:scale-95 transform cursor-pointer border",
                            isGroupedByColor
                              ? "bg-[#00558F] text-white border-[#00558F] shadow-inner"
                              : "bg-white border-slate-200 text-slate-700 hover:text-[#00558F] hover:border-[#00558F]/30"
                          )}
                          title="Agrupar citas de igual color juntas en secuencia"
                        >
                           <SlidersHorizontal className={cn("w-3.5 h-3.5", isGroupedByColor ? "text-white" : "text-[#00558F]")} />
                           {isGroupedByColor ? "Agrupado por Color" : "Agrupar por Color"}
                        </button>
                     </div>
                     <p className="text-[10px] text-slate-400 mt-2 block leading-normal">
                        *También puedes arrastrar y soltar (<GripVertical className="inline w-3 h-3 -mt-0.5" />) las citas para organizarlas en tu orden manual preferido.
                     </p>
                  </div>
               </aside>

               {/* Mobile/Tablet Compact Filters Header Line */}
               <div className="flex md:hidden w-full bg-white border-b border-slate-200 px-3.5 py-2 items-center justify-between gap-3 shrink-0 overflow-hidden">
                  {/* Horizontally scrollable color pill bar */}
                  <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5 flex-1 select-none">
                     <button 
                       onClick={() => setSelectedColorFilter('all')}
                       className={cn(
                         "text-[10px] font-extrabold px-2.5 py-1 rounded-full border transition-all shrink-0 flex items-center gap-1 cursor-pointer",
                         selectedColorFilter === 'all' 
                           ? "bg-[#00558F] text-white border-transparent shadow-xs" 
                           : "bg-slate-100 text-slate-600 border-transparent hover:bg-slate-150"
                       )}
                     >
                        Todos ({notes.filter(n => n.type !== 'bookmark').length})
                     </button>
                     {activePalette.map(color => {
                       const count = notes.filter(n => n.type !== 'bookmark' && n.color === color.id).length;
                       const isSelected = selectedColorFilter === color.id;
                       return (
                         <button 
                           key={color.id}
                           onClick={() => setSelectedColorFilter(color.id)}
                           className={cn(
                             "text-[10px] font-bold px-2.5 py-1 rounded-full border transition-all shrink-0 flex items-center gap-1.5 cursor-pointer",
                             isSelected 
                               ? "bg-slate-900 text-white border-transparent shadow-xs" 
                               : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                           )}
                         >
                            <div className="w-2 h-2 rounded-full border border-black/10 shrink-0" style={{ backgroundColor: color.hex }} />
                            <span className="max-w-[80px] truncate">{color.name}</span>
                            <span className="text-[9px] opacity-70">({count})</span>
                         </button>
                       );
                     })}
                     {activePalette.length < 6 && (
                        <button
                          onClick={() => setShowConfigModal(true)}
                          className="text-[10px] font-bold p-1 rounded-full border border-slate-200 text-slate-500 hover:text-[#00558F] hover:border-[#00558F]/30 hover:bg-[#00558F]/5 transition-all shrink-0 flex items-center justify-center cursor-pointer w-5 h-5"
                          title="Añadir color"
                        >
                           <Plus className="w-3 h-3" />
                        </button>
                     )}
                  </div>

                  {/* Ultra compact ordering button in mobile */}
                  <button 
                    onClick={handleSortByColor}
                    className={cn(
                      "text-[10px] font-bold py-1 px-2.5 rounded-full flex items-center gap-1.5 shrink-0 transition-all cursor-pointer shadow-xs active:scale-95 border",
                      isGroupedByColor
                        ? "bg-[#00558F] text-white border-transparent shadow-inner"
                        : "bg-white border-slate-250 text-slate-705 hover:bg-slate-50"
                    )}
                    title="Agrupar por color"
                  >
                     <SlidersHorizontal className={cn("w-3 h-3", isGroupedByColor ? "text-white" : "text-[#00558F]")} />
                     <span>{isGroupedByColor ? "Agrupado" : "Agrupar"}</span>
                  </button>
               </div>

               {/* Content Area / List of citations */}
               <main className="flex-1 overflow-y-auto px-3.5 py-4 sm:px-6 md:px-8 space-y-3 sm:space-y-4">
            {sortedCitations.length === 0 ? (
               <div className="bg-white border rounded-2xl p-12 text-center shadow-sm max-w-xl mx-auto mt-8">
                  <AlertCircle className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                  <h3 className="font-bold text-slate-700 text-sm mb-1">Sin elementos</h3>
                  <p className="text-xs text-slate-500 leading-relaxed">No se encontraron citas o apuntes con los filtros seleccionados actualmente.</p>
               </div>
            ) : isGroupedByColor ? (
               <div className="max-w-4xl mx-auto space-y-6">
                 {activePalette.map(color => {
                   const colorCitations = sortedCitations.filter(n => n.color === color.id);
                   if (colorCitations.length === 0) return null;

                   return (
                     <div key={color.id} className="space-y-2 animate-in fade-in duration-200">
                       {/* Color Group Header */}
                       <div className="flex items-center gap-2 pb-1 border-b border-slate-100 mt-4 select-none">
                         <div className="w-3 h-3 rounded-full border border-black/10 shadow-xs" style={{ backgroundColor: color.hex }} />
                         <h3 className="text-xs font-extrabold text-slate-700 tracking-wider uppercase">
                           {color.name} <span className="text-[10px] text-slate-400 font-semibold lowercase">({colorCitations.length} {colorCitations.length === 1 ? 'cita' : 'citas'})</span>
                         </h3>
                       </div>

                       <div className="space-y-3 sm:space-y-3">
                         {colorCitations.map((note) => {
                           const noteIndex = sortedCitationIndexById.get(note.id) ?? 0;
                           return renderNoteRow(note, noteIndex);
                         })}
                       </div>
                     </div>
                   );
                 })}

                 {/* Uncolored notes group if any exist */}
                 {(() => {
                   const noColorCitations = sortedCitations.filter(n => !n.color || !activePalette.some(ap => ap.id === n.color));
                   if (noColorCitations.length === 0) return null;

                   return (
                     <div className="space-y-2 animate-in fade-in duration-200">
                       <div className="flex items-center gap-2 pb-1 border-b border-slate-100 mt-4 select-none">
                         <div className="w-3 h-3 rounded-full border border-black/10 bg-slate-200 shadow-xs" />
                         <h3 className="text-xs font-extrabold text-slate-700 tracking-wider uppercase">
                           Sin Color <span className="text-[10px] text-slate-400 font-semibold lowercase">({noColorCitations.length})</span>
                         </h3>
                       </div>

                       <div className="space-y-3 sm:space-y-3">
                         {noColorCitations.map((note) => {
                           const noteIndex = sortedCitationIndexById.get(note.id) ?? 0;
                           return renderNoteRow(note, noteIndex);
                         })}
                       </div>
                     </div>
                   );
                 })()}
               </div>
            ) : (
               <div className="max-w-4xl mx-auto space-y-3 sm:space-y-3">
                  {sortedCitations.map((note, index) => renderNoteRow(note, index))}
               </div>
            )}

            {/* Citas de recursos de texto del libro, separadas por una línea
                divisoria. Solo se muestra si al menos un recurso tiene citas. */}
            {isBookDocument && textResources.some(r => (resourceCitations[r.docId] ?? []).length > 0) && (
               <div className="max-w-4xl mx-auto">
                  <div className="flex items-center gap-3 my-6">
                     <div className="h-px bg-slate-200 flex-1" />
                     <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest">Citas de recursos</span>
                     <div className="h-px bg-slate-200 flex-1" />
                  </div>

                  {textResources.map(r => {
                     const list = sortByPageAndTimestamp(
                       (resourceCitations[r.docId] ?? []).filter(n => n.type !== 'bookmark')
                     );
                     if (list.length === 0) return null;
                     return (
                       <div key={r.docId} className="space-y-2 mb-6">
                         <h3 className="text-xs font-extrabold text-slate-700 tracking-wide">
                           Citas del recurso: {r.title} <span className="text-[10px] text-slate-400 font-semibold">({list.length})</span>
                         </h3>
                         <div className="space-y-3 sm:space-y-3">
                           {list.map((note, idx) => renderResourceNoteRow(r.docId, note, idx, list.length))}
                         </div>
                       </div>
                     );
                  })}
               </div>
            )}
         </main>
         </>
         )}
      </div>

      {/* Color Configuration settings modal */}
      {showConfigModal && (
         <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-in fade-in duration-150">
            <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col border border-slate-100 animate-in zoom-in-95 duration-200">
               <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                  <div className="flex items-center gap-2">
                     <Settings2 className="w-4 h-4 text-[#00558F]" />
                     <h3 className="font-bold text-slate-800 text-sm">Configuración de Paleta de Colores</h3>
                  </div>
                  <button onClick={() => setShowConfigModal(false)} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg">
                     <X className="w-4 h-4" />
                  </button>
               </div>

               <div className="p-5 overflow-y-auto space-y-4 max-h-[380px] custom-scrollbar">
                  <p className="text-xs text-slate-500 leading-normal">
                     Personaliza tu paleta de lectura. Define el significado/etiqueta de cada color, añade hasta 6 opciones de color o elimina opciones hasta dejar un mínimo de una.
                  </p>

                  <div className="space-y-2.5">
                     <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">Colores de Selección Activos</h4>
                     {activePalette.map((color) => (
                        <div key={color.id} className="flex items-center gap-3 bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                           {/* Color Selector / Picker */}
                           <div className="relative w-6 h-6 rounded-full border border-black/10 shadow-sm shrink-0 overflow-hidden cursor-pointer hover:scale-105 active:scale-95 transition-all" style={{ backgroundColor: color.hex }}>
                              <input 
                                type="color" 
                                value={color.hex} 
                                onChange={e => updateColorHex(color.id, e.target.value)}
                                className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                                title="Haga clic para cambiar color de etiqueta"
                              />
                           </div>
                           
                           <input 
                             type="text" 
                             value={color.name}
                             onChange={e => updateColorName(color.id, e.target.value)}
                             className="flex-1 bg-white border border-slate-200 rounded-lg px-2.5 py-1 text-xs font-semibold focus:border-[#00558F] focus:outline-none"
                             placeholder="Significación del color..."
                           />

                           <button 
                             disabled={activePalette.length <= 1}
                             onClick={() => removeColorFromPalette(color.id)}
                             className="p-1 rounded text-slate-400 hover:text-red-500 hover:bg-red-50 disabled:opacity-20 transition-colors"
                             title="Eliminar de la paleta activa"
                           >
                              <X className="w-4 h-4" />
                           </button>
                        </div>
                     ))}
                  </div>

                  {getInactiveColors().length > 0 && activePalette.length < 6 && (
                     <div className="pt-3 border-t border-slate-100">
                        <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Añadir Colores a la Paleta</h4>
                        <div className="flex flex-wrap gap-2">
                           {getInactiveColors().map(color => (
                              <button 
                                key={color.id}
                                onClick={() => addColorToPalette(color.id)}
                                className="text-xs bg-slate-50 hover:bg-[#00558F]/5 hover:border-[#00558F]/20 text-slate-700 px-3 py-1.5 rounded-xl border border-slate-200 transition-colors flex items-center gap-2 font-semibold"
                              >
                                 <div className="w-3.5 h-3.5 rounded-full border border-black/10 shrink-0" style={{ backgroundColor: color.hex }} />
                                 {color.name}
                                 <Plus className="w-3.5 h-3.5 text-slate-400 ml-1" />
                              </button>
                           ))}
                        </div>
                     </div>
                  )}
               </div>

               <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-end">
                  <button
                    onClick={() => setShowConfigModal(false)}
                    className="text-xs font-bold bg-[#00558F] text-white px-4 py-2 rounded-xl hover:bg-[#004d80] transition-colors shadow-sm"
                  >
                     Listo
                  </button>
               </div>
            </div>
         </div>
      )}

      {/* Confirmación de borrado de color */}
      {colorToDelete && (
         <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[110] flex items-center justify-center p-4 animate-in fade-in duration-150">
            <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden flex flex-col border border-slate-100 animate-in zoom-in-95 duration-200">
               <div className="p-5 space-y-3">
                  <div className="flex items-center gap-3">
                     <div className="w-9 h-9 rounded-full bg-red-50 text-red-500 flex items-center justify-center shrink-0">
                        <AlertCircle className="w-5 h-5" />
                     </div>
                     <h3 className="font-bold text-slate-800 text-sm">Eliminar color de la paleta</h3>
                  </div>
                  <p className="text-xs text-slate-500 leading-relaxed">
                     ¿Seguro que deseas eliminar el color
                     {' '}
                     <span className="font-bold inline-flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full border border-black/10 inline-block" style={{ backgroundColor: colorToDelete.hex }} />
                        {colorToDelete.name}
                     </span>
                     {' '}de la paleta? Las citas que ya tengan este color asignado conservarán su etiqueta, pero dejará de estar disponible para nuevas selecciones.
                  </p>
               </div>
               <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-2">
                  <button
                    onClick={() => setColorToDelete(null)}
                    className="text-xs font-bold text-slate-600 bg-white border border-slate-200 px-4 py-2 rounded-xl hover:bg-slate-100 transition-colors"
                  >
                     Cancelar
                  </button>
                  <button
                    onClick={confirmRemoveColor}
                    className="text-xs font-bold bg-red-500 text-white px-4 py-2 rounded-xl hover:bg-red-600 transition-colors shadow-sm"
                  >
                     Eliminar
                  </button>
               </div>
            </div>
         </div>
      )}

    </div>
  );
}
