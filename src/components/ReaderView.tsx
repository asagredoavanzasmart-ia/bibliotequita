// =============================================================================
// ReaderView.tsx — Pantalla de lectura
// -----------------------------------------------------------------------------
// Hub central de la experiencia de lectura. Coordina:
//   - <PDFReader>      → render de PDF con react-pdf (zoom, paginación, scroll).
//   - <EPUBReader>     → render de EPUB con react-reader.
//   - <iframe>         → para recursos 'externa' (URLs web).
//   - <NotesPanel>     → panel lateral/inferior de notas y citas.
//   - <CitationsManager> → administrador completo de citas + resúmenes IA.
//   - <EditBookModal>  → vista de metadatos del recurso (inline=true).
//
// Características clave:
//   * Split-view redimensionable (horizontal en desktop, vertical en móvil).
//   * Selección de texto → toolbar flotante con colores para crear cita.
//   * Bookmarks: guarda página actual en BookItem.bookmarkPage → reanuda lectura.
//   * Brillo, pantalla completa y posición notes (izq/der) son estado local.
//   * activePalette (colores de citas) se persiste por libro en
//     localStorage[`color-palette-${bookId}`].
// =============================================================================

import { useLibrary } from '../hooks/useLibrary';
import { ChevronLeft, Maximize, View, Columns, Check, Edit2, MessageSquareQuote, ArrowRightLeft, ArrowUpDown, Minimize, Hand, Type, Sun, BookOpen, ClipboardList, Info, Volume2, VolumeX, Play, Pause, Square, Loader2, SkipBack, SkipForward, Rewind, FastForward } from 'lucide-react';
import { useState, useRef, FormEvent, ChangeEvent, useEffect, useCallback, useMemo } from 'react';
import { cn } from '../lib/utils';
import { PDFReader } from './PDFReader';
import { EPUBReader } from './EPUBReader';
import { FolderManagerModal } from './FolderManagerModal';
import { NotesPanel } from './NotesPanel';
import { EditBookModal } from './EditBookModal';
import { CitationsManager } from './CitationsManager';
import { BookmarksMenu } from './BookmarksMenu';

interface ReaderViewProps {
  bookId: string;
  onClose: () => void;
}

export function ReaderView({ bookId, onClose }: ReaderViewProps) {
  const { items, updateItem } = useLibrary();
  const item = items.find(i => i.id === bookId);

  const [activeTab, setActiveTab ] = useState<'reader' | 'edit' | 'citations'>('reader');
  
  const [showFolderManager, setShowFolderManager ] = useState(false);
  const [showNotes, setShowNotes ] = useState(false);

  const [selectedText, setSelectedText ] = useState('');
  const [selectedCitation, setSelectedCitation ] = useState<{text: string; color: string; timestamp: number; page: number | string}>();
  const [selectionRect, setSelectionRect ] = useState<{ top: number, left: number, width: number } | null>(null);
  
  // Start from bookmark page if saved to re-resume exactly where reader left off 
  const [currentPage, setCurrentPage ] = useState<number | string>(item?.bookmarkPage || 1);
  const [targetPage, setTargetPage ] = useState<{ page: number, t: number } | undefined>(
    item?.bookmarkPage ? { page: Number(item.bookmarkPage), t: Date.now() } : undefined
  );
  
  const [totalPages, setTotalPages ] = useState<number>(100);

  // --- Estados de Lector de Voz (TTS ElevenLabs) ------------------------------
  const [showTtsWidget, setShowTtsWidget] = useState(false);
  const [ttsStatus, setTtsStatus] = useState<'idle' | 'loading' | 'playing' | 'paused' | 'error'>('idle');
  const [ttsErrorMessage, setTtsErrorMessage] = useState('');
  const [currentAudio, setCurrentAudio] = useState<HTMLAudioElement | null>(null);
  const [ttsTextSource, setTtsTextSource] = useState<'selection' | 'page'>('page');

  // Proveedores de Voz
  const [selectedProvider, setSelectedProvider] = useState<'elevenlabs' | 'google' | 'google-standard'>('elevenlabs');

  // Voces favoritas persistidas en localStorage
  const [favoriteVoices, setFavoriteVoices] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('tts-favorite-voices') || '[]'); } catch { return []; }
  });
  const [showVoiceDropdown, setShowVoiceDropdown] = useState(false);

  const toggleFavoriteVoice = useCallback((voiceId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setFavoriteVoices(prev => {
      const next = prev.includes(voiceId) ? prev.filter(id => id !== voiceId) : [...prev, voiceId];
      localStorage.setItem('tts-favorite-voices', JSON.stringify(next));
      return next;
    });
  }, []);

  // Voces de ElevenLabs
  const ELEVENLABS_VOICES = useMemo(() => [
    // 🇨🇱 Voces chilenas
    { id: '6Gr4AVmTax1pMJO0lHRK', name: '🇨🇱 Catalina (Femenina Chilena)' },
    { id: 'Fd38GRHtJllY0CuguAy9', name: '🇨🇱 Victoria (Femenina Profesional)' },
    { id: 'lLsDvdl6OjtZfLJPM2HA', name: '🇨🇱 Isa Pro (Femenina Cálida)' },
    { id: 'cLzIVykddLltvgkzos6C', name: '🇨🇱 Vale (Femenina Amigable)' },
    { id: 'OFrdGXwCzoE56a9sp1fk', name: '🇨🇱 Marco (Masculino Cálido)' },
    { id: '6WgXEzo1HGn3i7ilT4Fh', name: '🇨🇱 Vicente Pro (Masculino Profesional)' },
    { id: 'ClNifCEVq1smkl4M3aTk', name: '🇨🇱 Cristian (Masculino Fluido)' },
    { id: '0cheeVA5B3Cv6DGq65cT', name: '🇨🇱 Alejandro (Conversacional)' },
    { id: '9ZVfdvBemUaGEWZgCiv0', name: '🇨🇱 Mateo (Masculino)' },
    { id: '6ZDFxWiAykFxCoe683WK', name: '🇨🇱 El Cordovez (Masculino)' },
    // 🌎 Voces latinoamericanas
    { id: '9EU0h6CVtEDS6vriwwq5', name: '🌎 Verónica (Femenina Suave)' },
    { id: 'V6isiXLBuRuM7uwHOVBA', name: '🌎 Luisa (Femenina Calmada)' },
    { id: 'p5EUznrYaWnafKvUkNiR', name: '🌎 Gaby (Natural Casual)' },
    { id: '4XUsiqPDK4UACIM2BILe', name: '🌎 JC (Locutor Enérgico)' },
  ], []);

  // Voces de Google Gemini TTS
  const GOOGLE_VOICES = useMemo(() => [
    { id: 'Erinome', name: '🇨🇱 Erinome (Ágil y Alegre)' },
    { id: 'Autonoe', name: '🇨🇱 Autonoe (Energía y Alegría)' },
    { id: 'Erin', name: '🇨🇱 Erin (Voz Activa 20a)' },
    { id: 'Aoede', name: '🇨🇱 Aoede (Voz Alegre 20a)' }
  ], []);

  // Modelos de Google Gemini TTS
  const GOOGLE_MODELS = useMemo(() => [
    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash (Recomendado)' },
    { id: 'gemini-2.5-pro-preview-tts', name: 'Gemini 2.5 Pro (Estudio - Cuota Baja)' }
  ], []);

  // Voces de Google Cloud TTS Standard (gratis hasta 4M chars/mes)
  const GOOGLE_STANDARD_VOICES = useMemo(() => [
    { id: 'es-ES-Standard-A', name: 'es-ES Standard A (Femenina)' },
    { id: 'es-ES-Standard-B', name: 'es-ES Standard B (Masculina)' },
    { id: 'es-ES-Standard-C', name: 'es-ES Standard C (Femenina)' },
    { id: 'es-ES-Standard-D', name: 'es-ES Standard D (Femenina)' },
    { id: 'es-US-Standard-A', name: 'es-US Standard A (Femenina)' },
    { id: 'es-US-Standard-B', name: 'es-US Standard B (Masculina)' },
    { id: 'es-ES-Neural2-A', name: 'es-ES Neural2 A (Femenina)' },
    { id: 'es-ES-Neural2-B', name: 'es-ES Neural2 B (Masculina)' },
    { id: 'es-ES-Neural2-C', name: 'es-ES Neural2 C (Femenina)' },
  ], []);

  const [selectedVoice, setSelectedVoice] = useState('6Gr4AVmTax1pMJO0lHRK');
  const [selectedModel, setSelectedModel] = useState('gemini-2.0-flash');

  // Frases extraídas para navegación paso a paso
  const [phrases, setPhrases] = useState<string[]>([]);
  const [currentPhraseIndex, setCurrentPhraseIndex] = useState(-1);

  // Referencia para la precarga (pre-fetching) de la siguiente frase de audio
  const preloadedAudioRef = useRef<{ index: number; audio: HTMLAudioElement; url: string } | null>(null);

  // Función para extraer texto del DOM de la página activa del PDF
  const getActivePageText = useCallback(() => {
    if (item?.type === 'pdf') {
      const pageEl = document.getElementById(`pdf-page-${currentPage}`);
      if (!pageEl) return '';
      
      const textLayer = pageEl.querySelector('.react-pdf__Page__textContent');
      const text = textLayer ? textLayer.textContent : pageEl.textContent;
      
      if (!text) return '';
      
      return text.replace(/\s+/g, ' ').trim();
    }
    return '';
  }, [item?.type, currentPage]);

  // Divide el texto en frases de punto a punto de forma simple y robusta
  const splitIntoPhrases = useCallback((text: string): string[] => {
    if (!text) return [];
    return text
      .split('.')
      .map(p => p.trim())
      .filter(p => p.length > 0)
      .map(p => p + '.');
  }, []);

  // Resalta de manera no destructiva y súper premium la frase actual en el DOM del PDF
  const highlightPhraseInDOM = useCallback((phraseText: string) => {
    const activePageEl = document.getElementById(`pdf-page-${currentPage}`);
    if (!activePageEl) return;

    // 1. Limpiar todos los resaltados anteriores en la página activa
    const spans = activePageEl.querySelectorAll('.react-pdf__Page__textContent span');
    spans.forEach((span: any) => {
      span.style.backgroundColor = '';
      span.style.borderRadius = '';
      span.style.transition = '';
      span.style.mixBlendMode = '';
      span.style.opacity = '';
    });

    if (!phraseText || phraseText.trim().length === 0) return;

    // Normalizar espacios para una búsqueda robusta
    const cleanPhrase = phraseText.replace(/\s+/g, ' ').trim().toLowerCase();
    if (cleanPhrase.length < 3) return;

    // 2. Construir el texto completo y registrar los rangos de caracteres de cada span
    let fullText = '';
    const spanRanges: { span: any; start: number; end: number }[] = [];

    spans.forEach((span: any) => {
      const text = span.textContent || '';
      const start = fullText.length;
      fullText += text;
      const end = fullText.length;
      spanRanges.push({ span, start, end });
    });

    // Normalizar el texto completo
    const normalizedFullText = fullText.toLowerCase().replace(/\s+/g, ' ');
    const normalizedPhrase = cleanPhrase;

    // 3. Buscar la frase en el texto completo de la página
    const matchIndex = normalizedFullText.indexOf(normalizedPhrase);
    if (matchIndex === -1) {
      // Coincidencia parcial si no hay coincidencia exacta (respaldo)
      const firstWords = normalizedPhrase.split(' ').slice(0, 3).join(' ');
      const partialMatchIndex = normalizedFullText.indexOf(firstWords);
      if (partialMatchIndex !== -1) {
        highlightRanges(partialMatchIndex, partialMatchIndex + normalizedPhrase.length);
      }
      return;
    }

    const startCharPos = matchIndex;
    const endCharPos = matchIndex + normalizedPhrase.length;
    highlightRanges(startCharPos, endCharPos);

    function highlightRanges(startPos: number, endPos: number) {
      let highlightedAny = false;
      let currentPos = 0;

      spanRanges.forEach(({ span, start, end }) => {
        const spanLength = end - start;
        const spanStartNormalized = normalizedFullText.indexOf(span.textContent?.toLowerCase() || '', currentPos);
        if (spanStartNormalized !== -1) {
          currentPos = spanStartNormalized + spanLength;
          const spanEndNormalized = spanStartNormalized + spanLength;

          // Verificar solapamiento de rangos de caracteres
          const overlaps = (spanStartNormalized < endPos && spanEndNormalized > startPos);
          if (overlaps) {
            span.style.transition = 'background-color 0.25s ease-in-out, opacity 0.25s ease-in-out';
            span.style.backgroundColor = '#fbbf24'; // Amarillo cálido premium
            span.style.opacity = '0.5';             // 50% de opacidad requerida
            span.style.mixBlendMode = 'multiply';   // Mantiene los negros absolutos del fondo
            span.style.borderRadius = '3px';

            if (!highlightedAny) {
              span.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
              highlightedAny = true;
            }
          }
        }
      });
    }
  }, [currentPage]);

  // Detener la reproducción de voz
  const handleTtsStop = useCallback(() => {
    if (currentAudio) {
      currentAudio.onended = null;
      currentAudio.onerror = null;
      currentAudio.pause();
      currentAudio.src = '';
      setCurrentAudio(null);
    }
    // Liberar recursos de la precarga si existen
    if (preloadedAudioRef.current) {
      URL.revokeObjectURL(preloadedAudioRef.current.url);
      preloadedAudioRef.current.audio.src = '';
      preloadedAudioRef.current = null;
    }
    setTtsStatus('idle');
    setCurrentPhraseIndex(-1);
    highlightPhraseInDOM('');
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = 'none';
    }
  }, [currentAudio, highlightPhraseInDOM]);

  // Reproducción paso a paso frase por frase con pre-fetching asíncrono y resiliencia a errores
  const playPhrase = useCallback(async (index: number, phraseList: string[]) => {
    if (index < 0 || index >= phraseList.length) {
      handleTtsStop();
      return;
    }

    setTtsStatus('loading');
    setCurrentPhraseIndex(index);
    const phraseText = phraseList[index];

    // Resaltar visualmente en el PDF por rangos de caracteres exactos
    highlightPhraseInDOM(phraseText);

    // Desconectar listeners del audio previo para evitar el "error fantasma"
    if (currentAudio) {
      currentAudio.onended = null;
      currentAudio.onerror = null;
      currentAudio.pause();
      currentAudio.src = '';
    }

    try {
      let audio: HTMLAudioElement;
      let audioUrl: string;

      // 1. Usar audio precargado si coincide con el índice solicitado
      if (preloadedAudioRef.current && preloadedAudioRef.current.index === index) {
        audio = preloadedAudioRef.current.audio;
        audioUrl = preloadedAudioRef.current.url;
        preloadedAudioRef.current = null; // Liberar la referencia de precarga
      } else {
        const response = await fetch('/api/tts', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ text: phraseText, provider: selectedProvider, voiceId: selectedVoice, model: selectedModel })
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.error || 'Fallo de respuesta de audio.');
        }

        const blob = await response.blob();
        audioUrl = URL.createObjectURL(blob);
        audio = new Audio(audioUrl);
      }

      audio.onended = () => {
        URL.revokeObjectURL(audioUrl);
        // Avanzar automáticamente a la siguiente frase si existe
        const nextIndex = index + 1;
        if (nextIndex < phraseList.length) {
          playPhrase(nextIndex, phraseList);
        } else {
          handleTtsStop();
        }
      };

      audio.onerror = () => {
        // Evitar activar el estado de error si el audio fue detenido o vaciado a propósito
        if (audio.src === '') return;
        setTtsStatus('error');
        setTtsErrorMessage('Error al reproducir esta frase.');
      };

      setCurrentAudio(audio);
      audio.play();
      setTtsStatus('playing');

      // 2. Pre-cargar la siguiente frase de forma totalmente asíncrona y transparente
      const nextIndex = index + 1;
      if (nextIndex < phraseList.length) {
        // Limpiar precarga anterior si existiera
        if (preloadedAudioRef.current) {
          URL.revokeObjectURL(preloadedAudioRef.current.url);
          preloadedAudioRef.current.audio.src = '';
          preloadedAudioRef.current = null;
        }

        const nextPhraseText = phraseList[nextIndex];
        fetch('/api/tts', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            text: nextPhraseText,
            provider: selectedProvider,
            voiceId: selectedVoice,
            model: selectedModel
          })
        })
        .then(res => {
          if (res.ok) return res.blob();
          throw new Error('Error de precarga');
        })
        .then(blob => {
          const url = URL.createObjectURL(blob);
          const preloadedAudio = new Audio(url);
          preloadedAudio.load();
          preloadedAudioRef.current = { index: nextIndex, audio: preloadedAudio, url };
        })
        .catch(err => {
          console.warn('[WARN] No se pudo precargar la siguiente frase:', err.message || err);
        });
      }

      // Configurar API MediaSession para mandos Bluetooth (auriculares/auto) y pantalla de bloqueo
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'playing';
        navigator.mediaSession.metadata = new MediaMetadata({
          title: item?.title || 'Biblioteca Personal',
          artist: 'Lector de Voz Inteligente',
          album: `Pág. ${currentPage} · Frase ${index + 1} de ${phraseList.length}`,
          artwork: [
            { src: item?.thumbnailUrl || '/logo.png', sizes: '96x96', type: 'image/png' }
          ]
        });

        // Controles de auriculares o mandos inalámbricos
        navigator.mediaSession.setActionHandler('play', () => {
          audio.play();
          setTtsStatus('playing');
          navigator.mediaSession.playbackState = 'playing';
        });
        navigator.mediaSession.setActionHandler('pause', () => {
          audio.pause();
          setTtsStatus('paused');
          navigator.mediaSession.playbackState = 'paused';
        });
        
        navigator.mediaSession.setActionHandler('previoustrack', () => {
          if (index > 0) {
            playPhrase(index - 1, phraseList);
          }
        });
        navigator.mediaSession.setActionHandler('nexttrack', () => {
          if (index < phraseList.length - 1) {
            playPhrase(index + 1, phraseList);
          }
        });
      }
    } catch (error: any) {
      console.error('Error in playPhrase:', error);
      setTtsStatus('error');
      setTtsErrorMessage(error.message || 'No se pudo reproducir la frase actual.');
    }
  }, [currentAudio, item, currentPage, selectedVoice, selectedProvider, selectedModel, highlightPhraseInDOM, handleTtsStop]);

  // Controles directos de Adelantar (>>) y Retroceder (<<) en la interfaz
  const handleTtsPrevious = useCallback(() => {
    if (currentPhraseIndex > 0) {
      playPhrase(currentPhraseIndex - 1, phrases);
    }
  }, [currentPhraseIndex, phrases, playPhrase]);

  const handleTtsNext = useCallback(() => {
    if (currentPhraseIndex < phrases.length - 1) {
      playPhrase(currentPhraseIndex + 1, phrases);
    }
  }, [currentPhraseIndex, phrases, playPhrase]);

  // Cambio de página desde el widget TTS con auto-lectura
  const handleTtsPrevPage = useCallback(() => {
    const page = typeof currentPage === 'number' ? currentPage : parseInt(String(currentPage), 10);
    if (page <= 1) return;
    const newPage = page - 1;
    setTargetPage({ page: newPage, t: Date.now() });
    setCurrentPage(newPage);
    handleTtsStop();
    setTimeout(() => {
      const text = (() => {
        const pageEl = document.getElementById(`pdf-page-${newPage}`);
        if (!pageEl) return '';
        const textLayer = pageEl.querySelector('.react-pdf__Page__textContent');
        return (textLayer ? textLayer.textContent : pageEl.textContent || '').replace(/\s+/g, ' ').trim();
      })();
      if (text) {
        const phraseList = text.split('.').map(p => p.trim()).filter(p => p.length > 0).map(p => p + '.');
        setPhrases(phraseList);
        setTtsTextSource('page');
        playPhrase(0, phraseList);
      }
    }, 800);
  }, [currentPage, handleTtsStop, playPhrase]);

  const handleTtsNextPage = useCallback(() => {
    const page = typeof currentPage === 'number' ? currentPage : parseInt(String(currentPage), 10);
    if (page >= totalPages) return;
    const newPage = page + 1;
    setTargetPage({ page: newPage, t: Date.now() });
    setCurrentPage(newPage);
    handleTtsStop();
    setTimeout(() => {
      const text = (() => {
        const pageEl = document.getElementById(`pdf-page-${newPage}`);
        if (!pageEl) return '';
        const textLayer = pageEl.querySelector('.react-pdf__Page__textContent');
        return (textLayer ? textLayer.textContent : pageEl.textContent || '').replace(/\s+/g, ' ').trim();
      })();
      if (text) {
        const phraseList = text.split('.').map(p => p.trim()).filter(p => p.length > 0).map(p => p + '.');
        setPhrases(phraseList);
        setTtsTextSource('page');
        playPhrase(0, phraseList);
      }
    }, 800);
  }, [currentPage, totalPages, handleTtsStop, playPhrase]);

  // Play / Pausa general
  const handleTtsPlayPause = async () => {
    if (ttsStatus === 'playing' && currentAudio) {
      currentAudio.pause();
      setTtsStatus('paused');
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'paused';
      }
      return;
    }

    if (ttsStatus === 'paused' && currentAudio) {
      currentAudio.play();
      setTtsStatus('playing');
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'playing';
      }
      return;
    }

    // Nueva lectura
    setTtsStatus('loading');
    setTtsErrorMessage('');

    let textToRead = '';
    let source: 'selection' | 'page' = 'page';

    if (selectedText && selectedText.trim().length > 0) {
      textToRead = selectedText.trim();
      source = 'selection';
    } else {
      textToRead = getActivePageText();
      source = 'page';
    }

    if (!textToRead || textToRead.length === 0) {
      setTtsStatus('error');
      setTtsErrorMessage('No se encontró texto legible en la página actual. Intenta seleccionando texto.');
      return;
    }

    setTtsTextSource(source);

    const phraseList = splitIntoPhrases(textToRead);
    if (phraseList.length === 0) {
      setTtsStatus('error');
      setTtsErrorMessage('No se pudo segmentar el texto en frases legibles.');
      return;
    }

    setPhrases(phraseList);
    playPhrase(0, phraseList);
  };

  const handleTtsClose = useCallback(() => {
    handleTtsStop();
    setShowTtsWidget(false);
  }, [handleTtsStop]);

  useEffect(() => {
    return () => {
      if (currentAudio) {
        currentAudio.pause();
        currentAudio.src = '';
      }
    };
  }, [currentAudio]);

  const handlePageChange = useCallback((page: number | string, total?: number) => {
    setCurrentPage(page);
    if (total && total > 0) {
      setTotalPages(total);
    }
  }, []);

  const [activePalette, setActivePalette ] = useState<{ id: string, color: string, bgClass: string, borderClass: string, textClass: string, name: string, hex: string }[]>([]);

  useEffect(() => {
    if (!bookId) return;
    const savedPalette = localStorage.getItem(`color-palette-${bookId}`);
    if (savedPalette) {
      try {
        setActivePalette(JSON.parse(savedPalette));
      } catch (e) {
        setActivePalette([
          { id: 'rose-400', color: 'rose-400', bgClass: 'bg-rose-50/50', borderClass: 'border-rose-400', textClass: 'text-rose-600', name: 'Rojo', hex: '#fb7185' },
          { id: 'sky-400', color: 'sky-400', bgClass: 'bg-sky-50/50', borderClass: 'border-sky-400', textClass: 'text-sky-600', name: 'Azul', hex: '#38bdf8' },
          { id: 'emerald-400', color: 'emerald-400', bgClass: 'bg-emerald-50/50', borderClass: 'border-emerald-400', textClass: 'text-emerald-600', name: 'Verde', hex: '#34d399' },
          { id: 'amber-400', color: 'amber-400', bgClass: 'bg-amber-50/50', borderClass: 'border-amber-400', textClass: 'text-amber-600', name: 'Amarillo', hex: '#fbbf24' }
        ]);
      }
    } else {
      setActivePalette([
        { id: 'rose-400', color: 'rose-400', bgClass: 'bg-rose-50/50', borderClass: 'border-rose-400', textClass: 'text-rose-600', name: 'Rojo', hex: '#fb7185' },
        { id: 'sky-400', color: 'sky-400', bgClass: 'bg-sky-50/50', borderClass: 'border-sky-400', textClass: 'text-sky-600', name: 'Azul', hex: '#38bdf8' },
        { id: 'emerald-400', color: 'emerald-400', bgClass: 'bg-emerald-50/50', borderClass: 'border-emerald-400', textClass: 'text-emerald-600', name: 'Verde', hex: '#34d399' },
        { id: 'amber-400', color: 'amber-400', bgClass: 'bg-amber-50/50', borderClass: 'border-amber-400', textClass: 'text-amber-600', name: 'Amarillo', hex: '#fbbf24' }
      ]);
    }
  }, [bookId]);

  // New states for fullscreen and split view
  const [isFullscreen, setIsFullscreen] = useState(typeof window !== 'undefined' ? window.innerWidth < 768 : false);
  const [showControls, setShowControls] = useState(typeof window !== 'undefined' ? window.innerWidth >= 768 : true);
  const [notesPosition, setNotesPosition] = useState<'right' | 'left'>('right');
  const [splitRatio, setSplitRatio] = useState<number>(50);
  const [isDragging, setIsDragging] = useState(false);
  const [isPortrait, setIsPortrait] = useState(typeof window !== 'undefined' ? window.innerWidth < 768 : false);

  useEffect(() => {
    const handleResize = () => {
       setIsPortrait(window.innerWidth < 768);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent | TouchEvent) => {
        if (!isDragging) return;
        const container = containerRef.current;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        
        const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
        const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

        if (isPortrait) {
            // vertical split
            const y = Math.max(0, Math.min(clientY - rect.top, rect.height));
            const p = (y / rect.height) * 100;
            // if position is 'left' (which means top in portrait), Reader is at the top
            // actually let's say 'right' means Notes are at the bottom, so Reader is top
            setSplitRatio(notesPosition === 'right' ? p : 100 - p);
        } else {
            // horizontal split
            const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
            const p = (x / rect.width) * 100;
            setSplitRatio(notesPosition === 'right' ? p : 100 - p);
        }
    };
    const onMouseUp = () => setIsDragging(false);
    
    if (isDragging) {
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('touchmove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
        document.addEventListener('touchend', onMouseUp);
        document.body.style.userSelect = 'none'; // prevent text selection while dragging
    } else {
        document.body.style.userSelect = '';
    }
    return () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('touchmove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.removeEventListener('touchend', onMouseUp);
        document.body.style.userSelect = '';
    }
  }, [isDragging, notesPosition, isPortrait]);

  // Handle controls disappearing when clicking the screen in fullscreen
  const handleScreenClick = (e: React.MouseEvent) => {
     if (isFullscreen) {
        setShowControls(prev => !prev);
     }
  };

  useEffect(() => {
    const handleMouseUp = () => {
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed && selection.rangeCount > 0) {
        const text = selection.toString().trim();
        if (text) {
          const range = selection.getRangeAt(0);
          const rect = range.getBoundingClientRect();
          setSelectedText(text);
          setSelectionRect({ top: rect.top, left: rect.left, width: rect.width });
          return;
        }
      }
      if (selectionRect) {
         setSelectionRect(null);
      }
    };

    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('touchend', () => setTimeout(handleMouseUp, 100));
    return () => {
       document.removeEventListener('mouseup', handleMouseUp);
       document.removeEventListener('touchend', handleMouseUp);
    };
  }, [selectionRect]);



  const [brightness, setBrightness] = useState(100);
  const [showBrightnessPopup, setShowBrightnessPopup] = useState(false);
  const [interactionMode, setInteractionMode] = useState<'pan' | 'select'>(isPortrait ? 'pan' : 'select');

  if (!item) {
    return <div className="h-screen flex items-center justify-center font-bold">Elemento no encontrado</div>;
  }

  const renderReader = () => (
     <div 
        className={cn("w-full h-full flex flex-col relative transition-all duration-300 pointer-events-auto")}
        onClick={handleScreenClick}
     >
        <div className="flex-1 overflow-hidden pointer-events-auto">
          {item.type === 'pdf' && <PDFReader url={item.source} hideControls={isFullscreen && !showControls} onPageChange={handlePageChange} targetPage={targetPage} />}
          {item.type === 'epub' && <EPUBReader url={item.source} />}
          {item.type === 'externa' && (
            <div className="w-full h-full flex flex-col pointer-events-auto">
              <div className="bg-[#FFA300]/10 text-[#FFA300] p-3 text-sm font-medium text-center shadow-inner">
                 Estás viendo contenido externo. Algunas funciones pueden estar limitadas.
              </div>
              <iframe src={item.source} className="w-full flex-1 border-0" sandbox="allow-scripts allow-same-origin bg-white" />
            </div>
          )}
        </div>
     </div>
  );

  const [isNotesFocused, setIsNotesFocused] = useState(false);

  const handleClearSelection = useCallback(() => {
     setSelectedText(''); 
     setSelectionRect(null);
  }, []);

  const renderNotes = () => (
     <div 
        className="w-full h-full relative bg-white flex flex-col pointer-events-auto overflow-hidden text-sm"
        onFocus={(e) => {
           if (e.target.tagName.toLowerCase() === 'textarea') setIsNotesFocused(true);
        }}
        onBlur={() => setIsNotesFocused(false)}
     >
        <NotesPanel 
            documentId={bookId} 
            selectedText={selectedText}
            selectedCitation={selectedCitation}
            clearSelection={handleClearSelection}
            currentPage={currentPage}
            onNavigateToPage={(page) => setTargetPage({ page: Number(page), t: Date.now() })}
        />
     </div>
  );

  const readerPaneStyle: React.CSSProperties = showNotes 
      ? { 
          [isPortrait ? 'height' : 'width']: (isPortrait && isNotesFocused) ? '100%' : `${splitRatio}%`,
          [isPortrait ? 'width' : 'height']: '100%'
        }
      : { width: '100%', height: '100%' };

  const notesPaneStyle: React.CSSProperties = showNotes
      ? (isPortrait && isNotesFocused 
          ? { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 100 }
          : { 
              [isPortrait ? 'height' : 'width']: `${100 - splitRatio}%`,
              [isPortrait ? 'width' : 'height']: '100%'
            })
      : { display: 'none' };

  // Actualización automática del progreso al cambiar de página.
  useEffect(() => {
    if (!item || !totalPages) return;
    const pageNum = Number(currentPage);
    if (!Number.isFinite(pageNum) || pageNum < 1) return;
    const calculatedProgress = Math.min(100, Math.max(0, Math.round((pageNum / totalPages) * 100)));
    if (calculatedProgress !== item.progress) {
      updateItem(item.id, { progress: calculatedProgress, bookmarkPage: currentPage });
    }
  }, [currentPage, totalPages, item, updateItem]);

  return (
    <div 
      className={cn("flex flex-col h-screen bg-white overflow-hidden relative", isFullscreen ? "fixed inset-0 z-[100] bg-black" : "")}
      style={{ filter: `brightness(${brightness}%)` }}
    >
      
      {/* Header */}
      {(!isFullscreen || showControls) && (
        <header className="bg-white border-b border-slate-200 px-2 sm:px-4 h-14 flex flex-row items-center justify-between shrink-0 shadow-sm z-30 gap-2 w-full animate-in slide-in-from-top-4">
            <div className="flex items-center gap-2 sm:gap-4 shrink-0">
            <button 
                onClick={() => {
                  if (isFullscreen) setIsFullscreen(false);
                  else onClose();
                }}
                className="flex items-center text-slate-500 hover:text-[#00558F] transition-colors shrink-0 bg-slate-100/50 hover:bg-slate-100 p-2 rounded-lg"
                title="Volver"
            >
                <ChevronLeft className="w-5 h-5" />
            </button>
            <div className="h-6 w-px bg-slate-200 mx-1 shrink-0 hidden sm:block" />
            <div className="flex-1 min-w-0 flex items-center pr-2 hidden md:flex">
                <h2 className="text-sm sm:text-base font-bold text-slate-800 tracking-tight leading-tight truncate">
                {item.title}
                </h2>
            </div>
            </div>

            <div className="flex items-center justify-end gap-2 flex-1 min-w-0">
             <div className="flex items-center justify-end gap-2 overflow-x-auto no-scrollbar shrink">
                 <div className="flex bg-slate-100 p-1 rounded-lg shrink-0 gap-1 items-center">
                     <button 
                         onClick={() => setActiveTab('reader')}
                         className={cn("p-1.5 sm:p-2 rounded-md transition-all", activeTab === 'reader' ? "bg-white text-[#00558F] shadow-sm scale-105" : "text-slate-500 hover:text-slate-700 hover:bg-slate-200/50")}
                         title="Lectura"
                     >
                         <BookOpen className="w-4 h-4 sm:w-5 sm:h-5" />
                     </button>
                     <button 
                         onClick={() => setActiveTab(activeTab === 'citations' ? 'reader' : 'citations')}
                         className={cn("p-1.5 sm:p-2 rounded-md transition-all", activeTab === 'citations' ? "bg-white text-[#00558F] shadow-sm scale-105" : "text-slate-500 hover:text-slate-700 hover:bg-slate-200/50")}
                         title="Administrar citas"
                     >
                         <ClipboardList className="w-4 h-4 sm:w-5 sm:h-5" />
                     </button>
                     <button 
                         onClick={() => setActiveTab(activeTab === 'edit' ? 'reader' : 'edit')}
                         className={cn("p-1.5 sm:p-2 rounded-md transition-all", activeTab === 'edit' ? "bg-white text-[#00558F] shadow-sm scale-105" : "text-slate-500 hover:text-slate-700 hover:bg-slate-200/50")}
                         title="Información y Metadatos"
                     >
                         <Info className="w-4 h-4 sm:w-5 sm:h-5" />
                     </button>
                 </div>
             </div>
 
             {/* Fixed right tools */}
             {activeTab === 'reader' && (item.type === 'pdf' || item.type === 'epub') && (
                 <div className="flex items-center gap-1 sm:gap-2 shrink-0">
                  {/* Lector de Voz (TTS ElevenLabs) */}
                  <button 
                      onClick={() => setShowTtsWidget(!showTtsWidget)} 
                      className={cn("p-2 rounded-lg flex items-center justify-center transition-colors shadow-sm border shrink-0", showTtsWidget ? "bg-slate-100 text-[#00558F] border-slate-200" : "bg-white text-slate-600 hover:text-[#00558F] border-slate-200 hover:border-[#A0CFEB]")}
                      title="Lector de Voz (TTS)"
                  >
                      <Volume2 className="w-4 h-4 sm:w-5 sm:h-5" />
                  </button>
                  {/* Brightness */}
                  <div className="relative">
                     <button 
                         onClick={() => setShowBrightnessPopup(!showBrightnessPopup)} 
                         className={cn("p-2 rounded-lg flex items-center justify-center transition-colors shadow-sm border shrink-0", showBrightnessPopup ? "bg-slate-100 text-[#00558F] border-slate-200" : "bg-white text-slate-600 hover:text-[#00558F] border-slate-200 hover:border-[#A0CFEB]")}
                         title="Brillo"
                     >
                         <Sun className="w-4 h-4 sm:w-5 sm:h-5" />
                     </button>
                     {showBrightnessPopup && (
                         <div className="absolute top-full right-0 mt-2 bg-white rounded-xl shadow-xl border border-slate-200 p-3 z-50 flex items-center gap-3">
                             <Sun className="w-4 h-4 text-slate-400" />
                             <input 
                                type="range" 
                                min="20" max="100" 
                                value={brightness} 
                                onChange={(e) => setBrightness(Number(e.target.value))} 
                                className="w-24 sm:w-32 accent-[#00558F]" 
                             />
                         </div>
                     )}
                  </div>
                  
                  {/* Multi-bookmark: lista desplegable + modal de nombre. */}
                  <BookmarksMenu
                     documentId={bookId}
                     currentPage={currentPage}
                     onNavigate={(page) => setTargetPage({ page: Number(page), t: Date.now() })}
                  />

                  <button 
                      onClick={() => {
                          setIsFullscreen(!isFullscreen);
                          if (!isFullscreen) setShowControls(false); // hide controls when entering
                      }} 
                      className={cn("p-2 rounded-lg flex items-center justify-center transition-colors shadow-sm border shrink-0", isFullscreen ? "bg-[#00558F] text-white border-[#00558F]" : "bg-white text-slate-600 hover:text-[#00558F] border-slate-200 hover:border-[#A0CFEB]")}
                      title="Pantalla Completa"
                  >
                      {isFullscreen ? <Minimize className="w-4 h-4 sm:w-5 sm:h-5" /> : <Maximize className="w-4 h-4 sm:w-5 sm:h-5" />}
                  </button>
                  <button 
                      onClick={() => setShowNotes(!showNotes)} 
                      className={cn("p-2 rounded-lg flex items-center justify-center transition-colors shadow-sm border shrink-0", showNotes ? "bg-[#00558F] text-white border-[#00558F]" : "bg-white text-slate-600 hover:text-[#00558F] border-slate-200 hover:border-[#A0CFEB]")}
                      title="Apuntes y Notas"
                  >
                      <MessageSquareQuote className="w-4 h-4 sm:w-5 sm:h-5" />
                  </button>
                 </div>
             )}
            </div>
        </header>
      )}

      {/* Main Content Area */}
      <main 
         ref={containerRef}
         className={cn("flex-1 relative overflow-hidden flex", isPortrait ? "flex-col" : "flex-row", (isFullscreen && !showControls) ? "bg-[#e2e8f0]" : "bg-[#e2e8f0]")}
      >
         {selectionRect && selectedText && (
            <div 
              className="fixed z-[1000] bg-slate-800 text-white rounded-lg shadow-2xl flex items-center overflow-hidden animate-in fade-in zoom-in-95 duration-100"
              style={{ 
                top: Math.max(10, selectionRect.top - 45), 
                left: Math.max(10, selectionRect.left + (selectionRect.width / 2) - 100) 
              }}
              onMouseDown={e => e.preventDefault()}
            >
               <div className="flex px-4 py-2.5 gap-3 items-center">
                  {activePalette.map((colorItem) => (
                     <button 
                       key={colorItem.id}
                       onClick={() => { 
                         setSelectedCitation({ text: selectedText, color: colorItem.color, timestamp: Date.now(), page: currentPage }); 
                         if (!showNotes) setShowNotes(true); 
                         setSelectionRect(null); 
                       }} 
                       style={{ backgroundColor: colorItem.hex }}
                       className="w-5 h-5 rounded-full hover:scale-110 active:scale-95 transition-transform ring-2 ring-transparent hover:ring-white/50 cursor-pointer" 
                       title={colorItem.name} 
                     />
                  ))}
               </div>
            </div>
         )}

         {notesPosition === 'right' ? (
             <>
             <div style={readerPaneStyle} className="relative z-10 min-w-0 min-h-0">{renderReader()}</div>
             {showNotes && (
                 <>
                     <div 
                         onMouseDown={() => setIsDragging(true)}
                         onTouchStart={() => setIsDragging(true)}
                         className={cn("z-20 hover:bg-[#00558F] transition-colors flex items-center justify-center shadow-lg active:bg-[#00558F] shrink-0", isPortrait ? "h-6 w-full cursor-row-resize bg-slate-200" : "w-6 h-full cursor-col-resize bg-slate-200")}
                     >
                         <div className={cn("bg-slate-400 rounded-full", isPortrait ? "w-8 h-1" : "h-8 w-1")} />
                     </div>
                     <div style={notesPaneStyle} className="relative z-10 border-t md:border-t-0 md:border-l border-slate-200 shadow-2xl min-w-0 min-h-0">{renderNotes()}</div>
                 </>
             )}
             </>
         ) : (
             <>
             {showNotes && (
                 <>
                     <div style={notesPaneStyle} className="relative z-10 border-b md:border-b-0 md:border-r border-slate-200 shadow-2xl min-w-0 min-h-0">{renderNotes()}</div>
                     <div 
                         onMouseDown={() => setIsDragging(true)}
                         onTouchStart={() => setIsDragging(true)}
                         className={cn("z-20 hover:bg-[#00558F] transition-colors flex items-center justify-center shadow-lg active:bg-[#00558F] shrink-0", isPortrait ? "h-6 w-full cursor-row-resize bg-slate-200" : "w-6 h-full cursor-col-resize bg-slate-200")}
                     >
                         <div className={cn("bg-slate-400 rounded-full", isPortrait ? "w-8 h-1" : "h-8 w-1")} />
                     </div>
                 </>
             )}
             <div style={readerPaneStyle} className="relative z-10 min-w-0 min-h-0">{renderReader()}</div>
             </>
         )}

         {/* Info & Metadatos Overlay Panel. ÚNICO scroll: el del propio overlay.
             EditBookModal inline NO debe tener su propio overflow-y-auto. */}
         {activeTab === 'edit' && (
            <div className="absolute inset-0 z-40 bg-white/95 backdrop-blur-md animate-in fade-in slide-in-from-bottom-5 duration-300 overflow-y-auto shadow-2xl">
               <EditBookModal item={item} inline={true} onClose={() => setActiveTab('reader')} onSave={(id, updates) => { updateItem(id, updates); setActiveTab('reader'); }} />
            </div>
          )}

          {/* Citations Administration View */}
          {activeTab === 'citations' && (
             <CitationsManager 
               documentId={item.id} 
               onClose={() => setActiveTab('reader')} 
               onNavigateToPage={(page) => {
                 setTargetPage({ page: Number(page), t: Date.now() });
                 setActiveTab('reader');
               }}
               currentPage={currentPage}
             />
          )}

          {/* Widget de Lector de Voz Flotante (ElevenLabs TTS Proxy) */}
          {showTtsWidget && (
             <div className="absolute top-4 right-4 z-40 bg-[var(--bg-card)] border border-[var(--border-card)] rounded-2xl shadow-2xl p-4 backdrop-blur-md animate-in slide-in-from-top-2 duration-300 w-80 max-w-[calc(100vw-32px)]">
                <div className="flex items-center justify-between mb-3 border-b border-[var(--border-card)] pb-2.5">
                   <div className="flex items-center gap-2">
                      <Volume2 className={cn("w-5 h-5 text-[var(--primary)]", ttsStatus === 'playing' && "animate-pulse")} />
                      <span className="font-bold text-sm text-[var(--text-main)]">Lector de Voz (TTS)</span>
                   </div>
                   <button 
                      onClick={handleTtsClose} 
                      className="text-[var(--text-muted)] hover:text-[var(--primary)] p-1.5 rounded-full hover:bg-[var(--primary)]/10 transition-colors"
                      title="Cerrar Lector"
                   >
                      <VolumeX className="w-4 h-4" />
                   </button>
                </div>

                <div className="flex flex-col gap-2.5 mb-4">
                   {/* Selector de Proveedor / Motor de Voz */}
                   <div className="flex items-center justify-between text-xs bg-[var(--bg-app)]/40 border border-[var(--border-card)] rounded-xl p-2.5">
                      <span className="text-[var(--text-muted)] font-semibold">Motor de Voz:</span>
                      <select
                         value={selectedProvider}
                         onChange={(e) => {
                            const prov = e.target.value as 'elevenlabs' | 'google' | 'google-standard';
                            setSelectedProvider(prov);
                            handleTtsStop();
                            // Limpiar precarga para que no se use con el proveedor anterior
                            if (preloadedAudioRef.current) {
                               URL.revokeObjectURL(preloadedAudioRef.current.url);
                               preloadedAudioRef.current.audio.src = '';
                               preloadedAudioRef.current = null;
                            }
                            if (prov === 'elevenlabs') {
                               setSelectedVoice('6Gr4AVmTax1pMJO0lHRK');
                            } else if (prov === 'google') {
                               setSelectedVoice('Erinome');
                               setSelectedModel('gemini-2.0-flash');
                            } else {
                               setSelectedVoice('es-ES-Standard-A');
                            }
                         }}
                         className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 text-xs font-bold text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-[var(--primary)] cursor-pointer transition-colors shadow-sm outline-none"
                      >
                         <option value="elevenlabs" className="bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100">ElevenLabs (Voz)</option>
                         <option value="google" className="bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100">Google Gemini (Voz/IA)</option>
                         <option value="google-standard" className="bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100">Google Standard (Gratis)</option>
                      </select>
                   </div>

                   {/* Selector de Modelo (Solo si el motor es Google Gemini) */}
                   {selectedProvider === 'google' && (
                      <div className="flex items-center justify-between text-xs bg-[var(--bg-app)]/40 border border-[var(--border-card)] rounded-xl p-2.5 gap-2">
                         <span className="text-[var(--text-muted)] font-semibold shrink-0">Modelo IA:</span>
                         <select 
                            value={selectedModel} 
                            onChange={(e) => { setSelectedModel(e.target.value); handleTtsStop(); }}
                            className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 text-xs font-bold text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-[var(--primary)] cursor-pointer transition-colors shadow-sm outline-none max-w-[165px] truncate"
                         >
                            {GOOGLE_MODELS.map(m => (
                               <option key={m.id} value={m.id} className="bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100">{m.name}</option>
                            ))}
                         </select>
                      </div>
                   )}

                   {/* Selector de Voz con favoritos */}
                   {(() => {
                      const allVoices = selectedProvider === 'elevenlabs' ? ELEVENLABS_VOICES : selectedProvider === 'google' ? GOOGLE_VOICES : GOOGLE_STANDARD_VOICES;
                      const favorites = allVoices.filter(v => favoriteVoices.includes(v.id));
                      const rest = allVoices.filter(v => !favoriteVoices.includes(v.id));
                      const currentVoiceName = allVoices.find(v => v.id === selectedVoice)?.name || selectedVoice;
                      return (
                        <div className="relative text-xs">
                           <div className="flex items-center justify-between bg-[var(--bg-app)]/40 border border-[var(--border-card)] rounded-xl p-2.5 gap-2">
                              <span className="text-[var(--text-muted)] font-semibold shrink-0">Voz:</span>
                              <button
                                 onClick={() => setShowVoiceDropdown(v => !v)}
                                 className="flex items-center gap-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 font-bold text-slate-800 dark:text-slate-100 cursor-pointer transition-colors shadow-sm max-w-[170px] truncate"
                              >
                                 {favoriteVoices.includes(selectedVoice) && <span className="text-yellow-400 text-[10px]">★</span>}
                                 <span className="truncate">{currentVoiceName}</span>
                                 <ChevronLeft className="w-3 h-3 shrink-0 -rotate-90 opacity-50" />
                              </button>
                           </div>
                           {showVoiceDropdown && (
                              <div className="absolute right-0 top-full mt-1 z-50 w-64 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl overflow-hidden">
                                 <div className="max-h-56 overflow-y-auto custom-scrollbar">
                                    {favorites.length > 0 && (
                                       <div className="px-2 pt-2 pb-1">
                                          <span className="text-[10px] text-yellow-500 font-bold uppercase tracking-wide px-1">★ Favoritas</span>
                                          {favorites.map(v => (
                                             <button key={v.id} onClick={() => { setSelectedVoice(v.id); handleTtsStop(); setShowVoiceDropdown(false); }}
                                                className={cn("w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-left transition-colors", selectedVoice === v.id ? "bg-[var(--primary)]/15 text-[var(--primary)]" : "hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100")}
                                             >
                                                <span className="truncate text-xs">{v.name}</span>
                                                <span onClick={(e) => toggleFavoriteVoice(v.id, e)} className="text-yellow-400 hover:text-yellow-500 shrink-0 px-1 cursor-pointer">★</span>
                                             </button>
                                          ))}
                                       </div>
                                    )}
                                    {rest.length > 0 && (
                                       <div className="px-2 pt-1 pb-2">
                                          {favorites.length > 0 && <span className="text-[10px] text-[var(--text-muted)] font-bold uppercase tracking-wide px-1">Todas</span>}
                                          {rest.map(v => (
                                             <button key={v.id} onClick={() => { setSelectedVoice(v.id); handleTtsStop(); setShowVoiceDropdown(false); }}
                                                className={cn("w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-left transition-colors", selectedVoice === v.id ? "bg-[var(--primary)]/15 text-[var(--primary)]" : "hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100")}
                                             >
                                                <span className="truncate text-xs">{v.name}</span>
                                                <span onClick={(e) => toggleFavoriteVoice(v.id, e)} className="text-slate-300 hover:text-yellow-400 shrink-0 px-1 cursor-pointer">☆</span>
                                             </button>
                                          ))}
                                       </div>
                                    )}
                                 </div>
                              </div>
                           )}
                        </div>
                      );
                   })()}

                   <div className="bg-[var(--bg-app)]/50 border border-[var(--border-card)] rounded-xl p-2.5 flex items-center justify-between text-xs">
                      <div className="flex flex-col gap-0.5">
                         <span className="text-[var(--text-muted)] text-[10px]">Origen de lectura:</span>
                         <span className="font-semibold text-[var(--text-main)] truncate max-w-[150px]">
                            {ttsTextSource === 'selection' ? 'Texto Seleccionado' : `Pág. ${currentPage} de ${totalPages || '--'}`}
                         </span>
                      </div>
                      <span className="px-2 py-0.5 bg-[var(--primary)]/15 text-[var(--primary)] font-medium rounded-full text-[10px] shrink-0">
                         Español
                      </span>
                   </div>

                   {/* Indicador del progreso por frases */}
                   {currentPhraseIndex >= 0 && phrases.length > 0 && (
                      <div className="bg-[var(--bg-app)]/50 border border-[var(--border-card)] rounded-xl p-2 flex items-center justify-between text-[11px] font-mono">
                         <span className="text-[var(--text-muted)]">Lectura frase:</span>
                         <span className="font-bold text-[var(--primary)] tabular-nums">{currentPhraseIndex + 1} / {phrases.length}</span>
                      </div>
                   )}

                   {ttsStatus === 'error' && (
                      <div className="bg-red-500/10 border border-red-500/20 text-red-500 rounded-xl p-3 text-xs leading-relaxed max-h-24 overflow-y-auto custom-scrollbar">
                         {ttsErrorMessage}
                      </div>
                   )}
                </div>

                {/* Barra de controles: [pág◀] [◀◀frase] [stop] [▶play] [frase▶▶] [▶pág] */}
                <div className="flex items-center justify-center gap-2 py-1">

                   {/* Página anterior — triángulo+línea izquierda */}
                   <button
                     disabled={typeof currentPage === 'number' ? currentPage <= 1 : parseInt(String(currentPage)) <= 1}
                     onClick={handleTtsPrevPage}
                     className="p-2 bg-[var(--bg-app)] hover:bg-slate-200/50 border border-[var(--border-card)] text-[var(--text-muted)] hover:text-[var(--primary)] disabled:opacity-30 disabled:pointer-events-none rounded-full transition-all active:scale-95 shadow-sm"
                     title="Página Anterior"
                   >
                      <SkipBack className="w-4 h-4 fill-current" />
                   </button>

                   {/* Retroceder frase — flechas dobles */}
                   <button
                     disabled={currentPhraseIndex <= 0 || ttsStatus === 'loading' || ttsStatus === 'idle'}
                     onClick={handleTtsPrevious}
                     className="p-2 bg-[var(--bg-app)] hover:bg-slate-200/50 border border-[var(--border-card)] text-[var(--text-muted)] hover:text-[var(--primary)] disabled:opacity-30 disabled:pointer-events-none rounded-full transition-all active:scale-95 shadow-sm"
                     title="Frase Anterior"
                   >
                      <Rewind className="w-4 h-4 fill-current" />
                   </button>

                   {/* Stop */}
                   <button
                     disabled={ttsStatus === 'idle' || ttsStatus === 'loading'}
                     onClick={handleTtsStop}
                     className="p-2 bg-[var(--bg-app)] hover:bg-slate-200/50 border border-[var(--border-card)] text-[var(--text-muted)] hover:text-red-500 disabled:opacity-30 disabled:pointer-events-none rounded-full transition-all active:scale-95 shadow-sm"
                     title="Detener"
                   >
                      <Square className="w-4 h-4 fill-current" />
                   </button>

                   {/* Play / Pause — botón central grande */}
                   <button
                     disabled={ttsStatus === 'loading'}
                     onClick={handleTtsPlayPause}
                     className={cn(
                       "p-3.5 rounded-full text-white shadow-lg transition-all active:scale-95 duration-200 flex items-center justify-center",
                       ttsStatus === 'playing'
                         ? "bg-[var(--primary)] hover:bg-[var(--primary-hover)] ring-4 ring-[var(--primary)]/15"
                         : "bg-[var(--primary)] hover:bg-[var(--primary-hover)]"
                     )}
                     title={ttsStatus === 'playing' ? "Pausar" : "Reproducir"}
                   >
                      {ttsStatus === 'loading' ? (
                         <Loader2 className="w-5 h-5 animate-spin" />
                      ) : ttsStatus === 'playing' ? (
                         <Pause className="w-5 h-5 fill-current" />
                      ) : (
                         <Play className="w-5 h-5 fill-current ml-0.5" />
                      )}
                   </button>

                   {/* Adelantar frase — flechas dobles */}
                   <button
                     disabled={currentPhraseIndex >= phrases.length - 1 || ttsStatus === 'loading' || ttsStatus === 'idle'}
                     onClick={handleTtsNext}
                     className="p-2 bg-[var(--bg-app)] hover:bg-slate-200/50 border border-[var(--border-card)] text-[var(--text-muted)] hover:text-[var(--primary)] disabled:opacity-30 disabled:pointer-events-none rounded-full transition-all active:scale-95 shadow-sm"
                     title="Frase Siguiente"
                   >
                      <FastForward className="w-4 h-4 fill-current" />
                   </button>

                   {/* Página siguiente — triángulo+línea derecha */}
                   <button
                     disabled={typeof currentPage === 'number' ? currentPage >= totalPages : parseInt(String(currentPage)) >= totalPages}
                     onClick={handleTtsNextPage}
                     className="p-2 bg-[var(--bg-app)] hover:bg-slate-200/50 border border-[var(--border-card)] text-[var(--text-muted)] hover:text-[var(--primary)] disabled:opacity-30 disabled:pointer-events-none rounded-full transition-all active:scale-95 shadow-sm"
                     title="Página Siguiente"
                   >
                      <SkipForward className="w-4 h-4 fill-current" />
                   </button>

                </div>

                <div className="text-center h-4 mt-2">
                   <span className="text-[10px] text-[var(--text-muted)] italic">
                      {ttsStatus === 'loading' && 'Generando voz natural...'}
                      {ttsStatus === 'playing' && 'Reproduciendo lectura de voz'}
                      {ttsStatus === 'paused' && 'Lectura de voz pausada'}
                      {ttsStatus === 'idle' && 'Presiona Play para leer'}
                      {ttsStatus === 'error' && 'Error al procesar el audio'}
                   </span>
                </div>
             </div>
          )}
      </main>

      {showFolderManager && (
         <FolderManagerModal 
           book={item} 
           onClose={() => setShowFolderManager(false)} 
         />
      )}
    </div>
  );
}
