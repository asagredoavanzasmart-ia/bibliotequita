// =============================================================================
// DraggableProgress.tsx — Barra de progreso de lectura arrastrable
// -----------------------------------------------------------------------------
// Extraída de BookGrid para poder reutilizarse también en EditBookModal sin
// crear un import circular entre ambos componentes. Se arrastra/clickea para
// fijar el porcentaje; `color` es una clase Tailwind (ej. "bg-emerald-500").
// =============================================================================

import { FC, useRef } from 'react';
import { cn } from '../lib/utils';

export const DraggableProgress: FC<{ value: number; color: string; onChange: (v: number) => void }> = ({ value, color, onChange }) => {
  const barRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const valueFromPointer = (clientX: number): number | null => {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return null;
    return Math.min(100, Math.max(0, Math.round(((clientX - rect.left) / rect.width) * 100)));
  };

  return (
    <div
      ref={barRef}
      onPointerDown={(e) => {
        e.stopPropagation();
        e.preventDefault();
        draggingRef.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        const v = valueFromPointer(e.clientX);
        if (v !== null) onChange(v);
      }}
      onPointerMove={(e) => {
        if (!draggingRef.current) return;
        e.stopPropagation();
        const v = valueFromPointer(e.clientX);
        if (v !== null) onChange(v);
      }}
      onPointerUp={() => { draggingRef.current = false; }}
      onPointerCancel={() => { draggingRef.current = false; }}
      className="flex-1 min-w-0 py-1.5 -my-1.5 cursor-pointer touch-none"
    >
      <div className="h-1.5 bg-slate-200/50 rounded-full overflow-hidden shadow-inner">
        <div className={cn("h-full rounded-full transition-[width] duration-100", color)} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
};
