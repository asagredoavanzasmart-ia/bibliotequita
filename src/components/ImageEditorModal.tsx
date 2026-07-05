// =============================================================================
// ImageEditorModal.tsx — Editor de fotos de portada (recorte, rotación,
// enderezado fino, brillo/contraste/saturación/enfoque y tintes de color).
// Reemplaza a ImageCropModal.tsx, del que hereda el mecanismo de recorte con
// esquinas arrastrables. Implementado con <canvas> nativo, sin dependencias.
//
// onConfirm entrega DOS blobs: la imagen ya editada (para thumbnailUrl) y el
// ORIGINAL sin tocar tal cual entró (para coverOriginalUrl) — permite
// reabrir el editor más adelante y reajustar desde cero.
// =============================================================================

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, RotateCw, Check, SlidersHorizontal, RotateCcw } from 'lucide-react';
import { cn } from '../lib/utils';

interface ImageEditorModalProps {
  file: File | Blob;
  onConfirm: (edited: Blob, original: Blob) => void;
  onCancel: () => void;
}

interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

type TintColor = 'blue' | 'yellow' | 'green' | 'magenta';
const TINT_HEX: Record<TintColor, string> = {
  blue: '#3b82f6',
  yellow: '#eab308',
  green: '#22c55e',
  magenta: '#d946ef',
};

interface Adjustments {
  brightness: number;   // 0-200, 100 = neutro
  contrast: number;     // 0-200, 100 = neutro
  saturation: number;   // 0-200, 100 = neutro
  sharpen: number;      // 0-100, 0 = neutro
  tint: TintColor | null;
  tintStrength: number; // 0-100
}

const NEUTRAL_ADJUSTMENTS: Adjustments = {
  brightness: 100,
  contrast: 100,
  saturation: 100,
  sharpen: 0,
  tint: null,
  tintStrength: 40,
};

const HANDLE_SIZE = 22;
const MAX_FINE_ANGLE = 15; // grados, para "enderezar" una foto ligeramente torcida

// CSS filter para el preview en vivo. El "sharpen" no tiene equivalente CSS
// real (no hay convolución vía filter()); se aproxima con contraste extra
// para dar sensación de mayor nitidez sin recalcular píxeles en cada frame.
// El resultado final SÍ aplica una convolución real (ver applySharpen).
function buildCssFilter(a: Adjustments): string {
  const sharpenApprox = 100 + a.sharpen * 0.15;
  return `brightness(${a.brightness}%) contrast(${a.contrast * (sharpenApprox / 100)}%) saturate(${a.saturation}%)`;
}

// Convolución 3×3 de realce de bordes (kernel clásico de sharpen), aplicada
// una sola vez sobre los píxeles finales — es la única parte que no puede
// resolver ctx.filter/CSS.
function applySharpen(ctx: CanvasRenderingContext2D, width: number, height: number, amount: number) {
  if (amount <= 0) return;
  const strength = amount / 100; // 0..1
  const src = ctx.getImageData(0, 0, width, height);
  const out = ctx.createImageData(width, height);
  const s = src.data;
  const d = out.data;
  const kernel = [0, -1, 0, -1, 5, -1, 0, -1, 0];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        d[i] = s[i]; d[i + 1] = s[i + 1]; d[i + 2] = s[i + 2]; d[i + 3] = s[i + 3];
        continue;
      }
      for (let c = 0; c < 3; c++) {
        let acc = 0;
        let k = 0;
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const ni = ((y + ky) * width + (x + kx)) * 4 + c;
            acc += s[ni] * kernel[k++];
          }
        }
        const sharpened = Math.max(0, Math.min(255, acc));
        d[i + c] = s[i + c] + (sharpened - s[i + c]) * strength;
      }
      d[i + 3] = s[i + 3];
    }
  }
  ctx.putImageData(out, 0, 0);
}

export function ImageEditorModal({ file, onConfirm, onCancel }: ImageEditorModalProps) {
  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null);
  const [rotation90, setRotation90] = useState(0); // 0 | 90 | 180 | 270
  const [fineAngle, setFineAngle] = useState(0);   // -15..15, "enderezar"
  const [crop, setCrop] = useState<CropRect | null>(null);
  const [adjustments, setAdjustments] = useState<Adjustments>(NEUTRAL_ADJUSTMENTS);
  const [showAdjustments, setShowAdjustments] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ mode: 'move' | 'nw' | 'ne' | 'sw' | 'se'; startX: number; startY: number; start: CropRect } | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => setImgEl(img);
    img.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (!imgEl) return;
    const isSideways = rotation90 === 90 || rotation90 === 270;
    const naturalW = isSideways ? imgEl.naturalHeight : imgEl.naturalWidth;
    const naturalH = isSideways ? imgEl.naturalWidth : imgEl.naturalHeight;
    const maxW = Math.min(window.innerWidth * 0.9, 480);
    const maxH = window.innerHeight * 0.45;
    const scale = Math.min(maxW / naturalW, maxH / naturalH, 1);
    const width = naturalW * scale;
    const height = naturalH * scale;
    setStageSize({ width, height });
    const margin = Math.min(width, height) * 0.05;
    setCrop({ x: margin, y: margin, width: width - margin * 2, height: height - margin * 2 });
  }, [imgEl, rotation90]);

  const clampCrop = (r: CropRect): CropRect => {
    const minSize = 40;
    let { x, y, width, height } = r;
    width = Math.max(minSize, Math.min(width, stageSize.width - x));
    height = Math.max(minSize, Math.min(height, stageSize.height - y));
    x = Math.max(0, Math.min(x, stageSize.width - minSize));
    y = Math.max(0, Math.min(y, stageSize.height - minSize));
    return { x, y, width, height };
  };

  const handlePointerDown = (mode: 'move' | 'nw' | 'ne' | 'sw' | 'se') => (e: React.PointerEvent) => {
    if (!crop) return;
    e.stopPropagation();
    e.preventDefault();
    dragRef.current = { mode, startX: e.clientX, startY: e.clientY, start: crop };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || !crop) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    let next: CropRect = { ...drag.start };
    if (drag.mode === 'move') {
      next.x = drag.start.x + dx;
      next.y = drag.start.y + dy;
    } else if (drag.mode === 'se') {
      next.width = drag.start.width + dx;
      next.height = drag.start.height + dy;
    } else if (drag.mode === 'nw') {
      next.x = drag.start.x + dx;
      next.y = drag.start.y + dy;
      next.width = drag.start.width - dx;
      next.height = drag.start.height - dy;
    } else if (drag.mode === 'ne') {
      next.y = drag.start.y + dy;
      next.width = drag.start.width + dx;
      next.height = drag.start.height - dy;
    } else if (drag.mode === 'sw') {
      next.x = drag.start.x + dx;
      next.width = drag.start.width - dx;
      next.height = drag.start.height + dy;
    }
    setCrop(clampCrop(next));
  };

  const handlePointerUp = () => { dragRef.current = null; };

  const handleRotate90 = () => setRotation90(r => ((r + 90) % 360) as 0 | 90 | 180 | 270);

  const resetAdjustments = () => { setAdjustments(NEUTRAL_ADJUSTMENTS); setFineAngle(0); };

  const handleConfirm = () => {
    if (!imgEl || !crop || stageSize.width === 0) return;
    const isSideways = rotation90 === 90 || rotation90 === 270;
    const naturalW = isSideways ? imgEl.naturalHeight : imgEl.naturalWidth;
    const naturalH = isSideways ? imgEl.naturalWidth : imgEl.naturalHeight;
    const scaleToNatural = naturalW / stageSize.width;
    const totalAngleRad = ((rotation90 + fineAngle) * Math.PI) / 180;

    // 1. Rotar (90° + enderezado fino combinados en un único ángulo) sobre un
    // canvas intermedio del tamaño "stage" en resolución natural.
    const rotatedCanvas = document.createElement('canvas');
    rotatedCanvas.width = naturalW;
    rotatedCanvas.height = naturalH;
    const rctx = rotatedCanvas.getContext('2d');
    if (!rctx) return;
    rctx.save();
    rctx.translate(naturalW / 2, naturalH / 2);
    rctx.rotate(totalAngleRad);
    rctx.drawImage(imgEl, -imgEl.naturalWidth / 2, -imgEl.naturalHeight / 2);
    rctx.restore();

    // 2. Recortar según el rectángulo elegido.
    const outCanvas = document.createElement('canvas');
    outCanvas.width = Math.round(crop.width * scaleToNatural);
    outCanvas.height = Math.round(crop.height * scaleToNatural);
    const octx = outCanvas.getContext('2d');
    if (!octx) return;
    octx.drawImage(
      rotatedCanvas,
      crop.x * scaleToNatural, crop.y * scaleToNatural,
      crop.width * scaleToNatural, crop.height * scaleToNatural,
      0, 0, outCanvas.width, outCanvas.height
    );

    // 3. "Quemar" brillo/contraste/saturación en los píxeles: ctx.filter +
    // un segundo drawImage del canvas sobre sí mismo (Canvas 2D soporta
    // filter en navegadores actuales; es lo mismo que hace el preview CSS,
    // pero ahora horneado en la imagen final).
    const filtered = document.createElement('canvas');
    filtered.width = outCanvas.width;
    filtered.height = outCanvas.height;
    const fctx = filtered.getContext('2d');
    if (!fctx) return;
    fctx.filter = `brightness(${adjustments.brightness}%) contrast(${adjustments.contrast}%) saturate(${adjustments.saturation}%)`;
    fctx.drawImage(outCanvas, 0, 0);

    // 4. Tinte de color: capa plana del color elegido con blend "color" y
    // opacidad = intensidad, quemada con un getImageData manual (evita
    // depender de mix-blend-mode en canvas, con soporte más parejo entre
    // navegadores para exportar a blob).
    if (adjustments.tint) {
      const hex = TINT_HEX[adjustments.tint];
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      const alpha = adjustments.tintStrength / 100;
      const imgData = fctx.getImageData(0, 0, filtered.width, filtered.height);
      const d = imgData.data;
      for (let i = 0; i < d.length; i += 4) {
        d[i] = d[i] * (1 - alpha) + r * alpha;
        d[i + 1] = d[i + 1] * (1 - alpha) + g * alpha;
        d[i + 2] = d[i + 2] * (1 - alpha) + b * alpha;
      }
      fctx.putImageData(imgData, 0, 0);
    }

    // 5. Enfoque: convolución real sobre los píxeles finales.
    applySharpen(fctx, filtered.width, filtered.height, adjustments.sharpen);

    filtered.toBlob((blob) => {
      if (blob) onConfirm(blob, file);
    }, 'image/jpeg', 0.9);
  };

  const cssFilter = buildCssFilter(adjustments);

  return createPortal(
    <div className="fixed inset-0 z-[10000] bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[var(--bg-app)] rounded-2xl shadow-xl w-full max-w-lg overflow-hidden flex flex-col max-h-[92dvh]">
        <div className="flex items-center justify-between p-4 border-b border-slate-200/50 shrink-0">
          <h3 className="font-bold text-sm text-[var(--text-main)]">Ajustar portada</h3>
          <button onClick={onCancel} className="text-slate-400 hover:text-[var(--text-main)] p-1 rounded-full hover:bg-slate-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="flex items-center justify-center p-4 bg-slate-900/5">
            {imgEl && crop && (
              <div
                ref={stageRef}
                className="relative select-none touch-none"
                style={{ width: stageSize.width, height: stageSize.height }}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
              >
                <img
                  src={imgEl.src}
                  alt="Portada a editar"
                  draggable={false}
                  className="absolute inset-0 w-full h-full object-cover pointer-events-none"
                  style={{ transform: `rotate(${rotation90 + fineAngle}deg)`, transformOrigin: 'center', filter: cssFilter }}
                />
                {/* Capa de tinte: aproximación visual en vivo del color quemado al confirmar */}
                {adjustments.tint && (
                  <div
                    className="absolute inset-0 pointer-events-none"
                    style={{ backgroundColor: TINT_HEX[adjustments.tint], opacity: (adjustments.tintStrength / 100) * 0.55, mixBlendMode: 'color' }}
                  />
                )}
                <div className="absolute inset-0 bg-black/50 pointer-events-none" style={{ clipPath: `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 ${crop.y}px, ${crop.x}px ${crop.y}px, ${crop.x}px ${crop.y + crop.height}px, ${crop.x + crop.width}px ${crop.y + crop.height}px, ${crop.x + crop.width}px ${crop.y}px, 0 ${crop.y}px)` }} />
                <div
                  onPointerDown={handlePointerDown('move')}
                  className="absolute border-2 border-white cursor-move"
                  style={{ left: crop.x, top: crop.y, width: crop.width, height: crop.height }}
                >
                  {(['nw', 'ne', 'sw', 'se'] as const).map((corner) => (
                    <div
                      key={corner}
                      onPointerDown={handlePointerDown(corner)}
                      className="absolute bg-white border border-[var(--primary)] rounded-full"
                      style={{
                        width: HANDLE_SIZE, height: HANDLE_SIZE,
                        left: corner.includes('w') ? -HANDLE_SIZE / 2 : undefined,
                        right: corner.includes('e') ? -HANDLE_SIZE / 2 : undefined,
                        top: corner.includes('n') ? -HANDLE_SIZE / 2 : undefined,
                        bottom: corner.includes('s') ? -HANDLE_SIZE / 2 : undefined,
                        cursor: corner === 'nw' || corner === 'se' ? 'nwse-resize' : 'nesw-resize',
                        touchAction: 'none',
                      }}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          {showAdjustments && (
            <div className="p-4 border-t border-slate-200/50 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[var(--text-main)]">Ajustes</span>
                <button onClick={resetAdjustments} className="flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-[var(--primary)] transition-colors">
                  <RotateCcw className="w-3 h-3" /> Restablecer
                </button>
              </div>

              <SliderRow label="Enderezar" value={fineAngle} min={-MAX_FINE_ANGLE} max={MAX_FINE_ANGLE} display={`${fineAngle > 0 ? '+' : ''}${fineAngle}°`} onChange={(v) => setFineAngle(v)} />
              <SliderRow label="Brillo" value={adjustments.brightness} min={0} max={200} display={`${adjustments.brightness}%`} onChange={(v) => setAdjustments(a => ({ ...a, brightness: v }))} />
              <SliderRow label="Contraste" value={adjustments.contrast} min={0} max={200} display={`${adjustments.contrast}%`} onChange={(v) => setAdjustments(a => ({ ...a, contrast: v }))} />
              <SliderRow label="Saturación" value={adjustments.saturation} min={0} max={200} display={`${adjustments.saturation}%`} onChange={(v) => setAdjustments(a => ({ ...a, saturation: v }))} />
              <SliderRow label="Enfoque" value={adjustments.sharpen} min={0} max={100} display={`${adjustments.sharpen}%`} onChange={(v) => setAdjustments(a => ({ ...a, sharpen: v }))} />

              <div className="flex flex-col gap-1.5">
                <span className="text-[11px] font-semibold text-[var(--text-muted)]">Tinte de color</span>
                <div className="flex items-center gap-2">
                  {(Object.keys(TINT_HEX) as TintColor[]).map((c) => (
                    <button
                      key={c}
                      onClick={() => setAdjustments(a => ({ ...a, tint: a.tint === c ? null : c }))}
                      title={c}
                      className={cn('w-7 h-7 rounded-full border-2 transition-all', adjustments.tint === c ? 'border-[var(--primary)] scale-110' : 'border-white shadow')}
                      style={{ backgroundColor: TINT_HEX[c] }}
                    />
                  ))}
                </div>
                {adjustments.tint && (
                  <SliderRow label="Intensidad" value={adjustments.tintStrength} min={0} max={100} display={`${adjustments.tintStrength}%`} onChange={(v) => setAdjustments(a => ({ ...a, tintStrength: v }))} />
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 p-4 border-t border-slate-200/50 shrink-0">
          <button onClick={handleRotate90} className="flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors">
            <RotateCw className="w-4 h-4" /> Rotar
          </button>
          <button
            onClick={() => setShowAdjustments(v => !v)}
            className={cn('flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-lg transition-colors', showAdjustments ? 'bg-[var(--primary)]/10 text-[var(--primary)]' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}
          >
            <SlidersHorizontal className="w-4 h-4" /> Ajustes
          </button>
          <button onClick={handleConfirm} className="flex items-center gap-1.5 text-xs font-bold px-4 py-2 rounded-lg bg-[var(--primary)] text-white hover:opacity-90 transition-all shadow-md">
            <Check className="w-4 h-4" /> Usar foto
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function SliderRow({ label, value, min, max, display, onChange }: { label: string; value: number; min: number; max: number; display: string; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-[11px] font-semibold text-[var(--text-muted)] w-16 shrink-0">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 accent-[var(--primary)]"
      />
      <span className="text-[11px] font-mono text-[var(--text-muted)] w-10 text-right shrink-0">{display}</span>
    </div>
  );
}
