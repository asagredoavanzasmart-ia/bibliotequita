// =============================================================================
// StarRating.tsx — Valoración decimal (1.0–5.0, pasos de 0.1)
// -----------------------------------------------------------------------------
// Fila de 5 estrellas que actúa como barra continua: la posición del click/tap
// determina el valor exacto (ej. 64% del ancho → 3.2). El relleno fraccional
// de la estrella parcial se logra superponiendo una capa de estrellas llenas
// recortada con clip-path.
//
// El número junto a las estrellas es editable in-place: un click lo convierte
// en un <input> sin borde/fondo (mismo tamaño que el texto) que recibe foco
// y abre el teclado numérico en móvil.
// =============================================================================

import { useState, useRef } from 'react';
import { X } from 'lucide-react';
import { cn } from '../lib/utils';

interface StarRatingProps {
  value: number; // 0 = sin rating, 1.0–5.0
  onChange: (value: number) => void;
  size?: 'sm' | 'md' | 'lg';
  readOnly?: boolean;
  // Vista de grilla pequeña: UNA estrella + el puntaje (mismo color por tramo)
  // en vez de las 5 estrellas, para caber en la línea de la barra de avance.
  // El número sigue siendo editable in-place, que es como se fija el valor.
  compact?: boolean;
}

// Puntos del polígono de estrella (lucide-react Star). Debe ser una lista de
// coordenadas pura — un prefijo "M" (sintaxis de <path d>) rompe el render.
const STAR_POINTS = "12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26";

function clampRating(v: number): number {
  if (!Number.isFinite(v)) return 0;
  const rounded = Math.round(v * 10) / 10;
  return Math.min(5, Math.max(0, rounded));
}

// Color del número según tramo: rojo 1,0–2,0 · naranjo 2,1–2,9 · amarillo 3,0–5,0
function ratingColor(v: number): string {
  if (v >= 3) return 'text-amber-400';
  if (v >= 2.1) return 'text-orange-500';
  if (v >= 1) return 'text-red-500';
  return 'text-slate-400';
}

export function StarRating({ value, onChange, size = 'sm', readOnly = false, compact = false }: StarRatingProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  const starSize = size === 'sm' ? 'w-3.5 h-3.5' : size === 'lg' ? 'w-8 h-8' : 'w-6 h-6';
  const textSize = size === 'sm' ? 'text-[12px]' : size === 'lg' ? 'text-base' : 'text-sm';
  const gap = size === 'sm' ? 'gap-0.5' : 'gap-1';
  // Separación extra (~20% del tamaño de estrella) entre las estrellas y el número
  const numGap = size === 'sm' ? 'ml-[3px]' : 'ml-[5px]';

  const fillPercent = value > 0 ? Math.min(100, Math.max(0, (value / 5) * 100)) : 0;

  const draggingRef = useRef(false);

  const valueFromPointer = (clientX: number): number | null => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return null;
    const ratio = (clientX - rect.left) / rect.width;
    return clampRating(ratio * 5);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (readOnly) return;
    e.stopPropagation();
    e.preventDefault();
    draggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    const v = valueFromPointer(e.clientX);
    if (v !== null) onChange(v);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    e.stopPropagation();
    const v = valueFromPointer(e.clientX);
    if (v !== null) onChange(v);
  };

  const handlePointerUp = () => {
    draggingRef.current = false;
  };

  const startEditing = (e: React.MouseEvent | React.TouchEvent) => {
    if (readOnly) return;
    e.stopPropagation();
    setDraft(value > 0 ? value.toFixed(1).replace('.', ',') : '');
    setEditing(true);
  };

  const commitEdit = () => {
    const normalized = draft.trim().replace(',', '.');
    if (normalized === '') {
      onChange(0);
    } else {
      const parsed = parseFloat(normalized);
      onChange(Number.isFinite(parsed) ? clampRating(parsed) : 0);
    }
    setEditing(false);
  };

  const numberField = editing ? (
    <input
      autoFocus
      type="text"
      inputMode="decimal"
      value={draft}
      onChange={(e) => setDraft(e.target.value.replace(/\./g, ','))}
      onBlur={commitEdit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.currentTarget.blur(); }
        if (e.key === 'Escape') { setEditing(false); }
      }}
      onClick={(e) => e.stopPropagation()}
      className={cn(textSize, numGap, "font-bold bg-transparent border-0 outline-none p-0", ratingColor(value))}
      style={{ width: `${Math.max(draft.length, 2) + 0.5}ch` }}
    />
  ) : (
    <span
      onClick={startEditing}
      className={cn(textSize, numGap, "font-bold cursor-text select-none", ratingColor(value))}
    >
      {value > 0 ? value.toFixed(1).replace('.', ',') : '–'}
    </span>
  );

  if (compact) {
    return (
      <div className={cn("flex items-center", gap)} onClick={(e) => e.stopPropagation()}>
        <svg
          className={cn(starSize, "shrink-0", value > 0 ? "text-amber-400 fill-amber-400" : "text-slate-400")}
          viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
          fill={value > 0 ? undefined : "none"}
        >
          <polygon points={STAR_POINTS} />
        </svg>
        {numberField}
      </div>
    );
  }

  return (
    <div className={cn("flex items-center", gap)} onClick={(e) => e.stopPropagation()}>
      <div
        ref={containerRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className={cn("relative flex touch-none", gap, !readOnly && "cursor-pointer")}
      >
        {/* Capa base: 5 estrellas vacías */}
        <div className={cn("flex", gap)}>
          {[0, 1, 2, 3, 4].map(i => (
            <svg key={i} className={cn(starSize, "text-slate-400")} viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none">
              <polygon points={STAR_POINTS} />
            </svg>
          ))}
        </div>
        {/* Capa de relleno: 5 estrellas llenas, recortada al % exacto */}
        <div
          className={cn("absolute inset-0 flex overflow-hidden pointer-events-none", gap)}
          style={{ width: `${fillPercent}%` }}
        >
          {[0, 1, 2, 3, 4].map(i => (
            <svg key={i} className={cn(starSize, "text-amber-400 fill-amber-400 shrink-0")} viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <polygon points={STAR_POINTS} />
            </svg>
          ))}
        </div>
      </div>

      {numberField}

      {!readOnly && value > 0 && (
        <button
          onClick={(e) => { e.stopPropagation(); onChange(0); }}
          title="Quitar calificación"
          className="text-slate-300 hover:text-rose-500 transition-colors shrink-0"
        >
          <X className={size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
        </button>
      )}
    </div>
  );
}
