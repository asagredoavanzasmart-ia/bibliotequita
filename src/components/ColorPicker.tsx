// =============================================================================
// ColorPicker.tsx — Selector de color reutilizable (etiquetas, listas, etc.)
// -----------------------------------------------------------------------------
// Botón "trigger" que muestra el color actual; al tocarlo abre un panel con:
//   - Paleta de colores de marca + variantes Tailwind (un solo set unificado,
//     en vez de tener 2-3 paletas ligeramente distintas dispersas por la app).
//   - Un swatch "Personalizado" con <input type="color"> superpuesto: en
//     Chrome/Edge, el selector nativo del sistema operativo incluye un
//     cuentagotas (eyedropper) integrado — no se necesita ninguna librería
//     externa para eso.
//   - Campo de texto para pegar un hex manualmente.
// El valor puede ser una clase Tailwind ('bg-rose-500') o un hex ('#rrggbb'),
// igual que ya usan PlaylistData.color / TagData.color (ver colorSwatchProps).
// =============================================================================

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Pipette } from 'lucide-react';
import { cn, colorSwatchProps } from '../lib/utils';

// Paleta unificada: colores institucionales de la app + un set Tailwind
// variado. Antes Sidebar.tsx y SettingsModal.tsx tenían cada uno su propia
// lista ligeramente distinta — una sola paleta compartida para etiquetas,
// listas y cualquier otro selector de color futuro.
export const APP_COLOR_PALETTE = [
  'bg-[#00558F]', 'bg-[#A0CFEB]', 'bg-[#FFA300]',
  'bg-rose-500', 'bg-orange-500', 'bg-amber-500', 'bg-emerald-500',
  'bg-teal-500', 'bg-sky-500', 'bg-indigo-500', 'bg-violet-500', 'bg-slate-800',
];

interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
  label?: string;
}

export function ColorPicker({ value, onChange, label }: ColorPickerProps) {
  const [open, setOpen] = useState(false);
  const [hexInput, setHexInput] = useState(value.startsWith('#') ? value : '');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    setHexInput(value.startsWith('#') ? value : '');
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (panelRef.current?.contains(e.target as Node) || triggerRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  const handleOpen = () => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 6, left: Math.max(8, Math.min(rect.left, window.innerWidth - 248)) });
    }
    setOpen(true);
  };

  const isCustomHex = value.startsWith('#') && !APP_COLOR_PALETTE.includes(value);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? setOpen(false) : handleOpen())}
        title={label || 'Elegir color'}
        className={cn(
          "w-8 h-8 rounded-full border-2 transition-all shrink-0",
          open ? "border-[var(--primary)] scale-110" : "border-white/40 hover:scale-105"
        )}
      >
        <span className={cn("block w-full h-full rounded-full", colorSwatchProps(value).className)} style={colorSwatchProps(value).style} />
      </button>

      {open && pos && createPortal(
        <div
          ref={panelRef}
          className="fixed z-[1100] w-60 bg-[var(--bg-card)] border border-[var(--border-card)] rounded-2xl shadow-2xl p-3 animate-in fade-in zoom-in-95 duration-150"
          style={{ top: pos.top, left: pos.left }}
        >
          {label && <p className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wide mb-2">{label}</p>}

          <div className="grid grid-cols-6 gap-2 mb-3">
            {APP_COLOR_PALETTE.map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => { onChange(color); setOpen(false); }}
                title={color}
                className={cn("w-7 h-7 rounded-full flex items-center justify-center transition-transform hover:scale-110", color)}
              >
                {value === color && <Check className="w-3.5 h-3.5 text-white drop-shadow" />}
              </button>
            ))}
          </div>

          <div className="border-t border-[var(--border-card)] pt-3 flex items-center gap-2">
            {/* El <input type="color"> nativo abre el selector del sistema
                operativo, que en Chrome/Edge incluye un cuentagotas (eyedropper)
                para tomar cualquier color de la pantalla — no requiere ninguna
                librería ni implementación propia. */}
            <label
              title="Color personalizado (incluye cuentagotas)"
              className={cn(
                "relative w-9 h-9 rounded-full shrink-0 cursor-pointer overflow-hidden border-2 transition-all",
                isCustomHex ? "border-[var(--primary)] scale-105" : "border-[var(--border-card)]"
              )}
              style={isCustomHex ? { backgroundColor: value } : { background: 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)' }}
            >
              <input
                type="color"
                value={isCustomHex ? value : '#3b82f6'}
                onChange={(e) => onChange(e.target.value)}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
              <Pipette className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 text-white drop-shadow pointer-events-none" />
            </label>
            <input
              type="text"
              value={hexInput}
              onChange={(e) => setHexInput(e.target.value)}
              onBlur={() => { if (/^#[0-9a-fA-F]{6}$/.test(hexInput)) onChange(hexInput); }}
              onKeyDown={(e) => { if (e.key === 'Enter' && /^#[0-9a-fA-F]{6}$/.test(hexInput)) onChange(hexInput); }}
              placeholder="#rrggbb"
              maxLength={7}
              className="flex-1 min-w-0 text-xs px-2 py-2 rounded-lg border border-[var(--border-card)] bg-[var(--bg-app)] text-[var(--text-main)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
            />
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
