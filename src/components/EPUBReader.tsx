import { useState, useEffect } from 'react';
import { ReactReader } from 'react-reader';
import { get } from 'idb-keyval';
import { List } from 'lucide-react';

interface EPUBReaderProps {
  url: string;
}

export function EPUBReader({ url }: EPUBReaderProps) {
  const [location, setLocation] = useState<string | number>(0);
  const [actualUrl, setActualUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<boolean>(false);

  useEffect(() => {
    let objectUrl: string | null = null;
    let isActive = true;

    // Mismo esquema de resolución que PDFReader. Las nuevas URLs son
    // "/api/files/<uuid>.epub" y se cargan directo; mantenemos compatibilidad
    // con "idb://" y "blob:" para items legacy de la maqueta.
    const resolveUrl = async () => {
      setLoadError(false);
      try {
        if (url.startsWith('idb://')) {
          const file = await get(url);
          if (file && isActive) {
            objectUrl = URL.createObjectURL(file as Blob);
            setActualUrl(objectUrl);
          } else if (isActive) {
            setLoadError(true);
          }
        } else if (url.startsWith('blob:')) {
          const res = await fetch(url).catch(() => null);
          if (!res || !res.ok) {
            if (isActive) setLoadError(true);
          } else {
            if (isActive) setActualUrl(url);
          }
        } else {
          // URLs del servidor ("/api/files/...") y URLs públicas: directas.
          if (isActive) setActualUrl(url);
        }
      } catch (err) {
        if (isActive) setLoadError(true);
      }
    };

    resolveUrl();

    return () => {
      isActive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);

  return (
    <div className="h-full relative bg-[#f8fafc] flex justify-center">
      <div className="w-full h-full max-w-5xl shadow-xl bg-white border-x border-slate-200">
         {loadError || !actualUrl ? (
            loadError && (
               <div className="w-full max-w-[600px] h-[400px] mx-auto mt-20 bg-slate-50 border-2 border-dashed border-slate-300 rounded-lg flex flex-col items-center justify-center p-8 text-center text-slate-500 shadow-sm">
                  <div className="w-16 h-16 mb-4 text-slate-300"><List className="w-full h-full"/></div>
                  <p className="font-bold text-slate-700 mb-2">No se pudo cargar el documento EPUB</p>
                  <p className="text-sm">Si este archivo se subió localmente, es posible que el enlace temporal haya expirado. Por favor, vuelve a subir el archivo desde el editor.</p>
               </div>
            )
         ) : (
            <ReactReader
              url={actualUrl}
              location={location}
              locationChanged={(epubcfi: string) => setLocation(epubcfi)}
              epubInitOptions={{
                 openAs: 'epub'
              }}
              epubOptions={{
                flow: 'paginated',
                manager: 'continuous',
              }}
            />
         )}
      </div>
    </div>
  );
}
