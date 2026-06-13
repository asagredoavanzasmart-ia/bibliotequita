import { useEffect, useState } from 'react';

interface TxtReaderProps {
  url: string;
}

export function TxtReader({ url }: TxtReaderProps) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setError('');
    fetch(url, { credentials: 'include' })
      .then(r => {
        if (!r.ok) throw new Error(`Error ${r.status}`);
        return r.text();
      })
      .then(t => { setText(t); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [url]);

  if (loading) {
    return (
      <div className="w-full h-full flex items-center justify-center text-[var(--text-muted)]">
        Cargando...
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full h-full flex items-center justify-center text-red-500">
        No se pudo cargar el archivo: {error}
      </div>
    );
  }

  return (
    <div
      id="txt-content"
      className="w-full h-full overflow-y-auto p-6 md:p-12 bg-[var(--bg-surface)]"
    >
      <pre className="whitespace-pre-wrap font-[var(--font-reader,_'Georgia',_serif)] text-[var(--text-main)] text-base leading-relaxed max-w-3xl mx-auto">
        {text}
      </pre>
    </div>
  );
}
