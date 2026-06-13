import type { CSSProperties } from "react";
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Las listas/playlists guardan su color como clase Tailwind (ej. "bg-rose-500")
// o, si el usuario elige un color personalizado con el selector nativo, como
// hex (ej. "#a1b2c3"). Esta función separa ambos casos para que los círculos
// de color se rendericen igual sin importar el origen.
export function colorSwatchProps(color?: string): { className?: string; style?: CSSProperties } {
  if (color && color.startsWith('#')) {
    return { style: { backgroundColor: color } };
  }
  return { className: color || 'bg-slate-800' };
}
