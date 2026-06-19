// =============================================================================
// ImageCropModal.tsx — Editor simple de recorte + rotación para fotos de
// portada tomadas con la cámara del móvil (no hay corrección de perspectiva
// tipo "escáner"; es un recorte rectangular libre + rotación en pasos de 90°).
// Implementado con <canvas> nativo, sin dependencias nuevas.
// =============================================================================

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, RotateCw, Check } from 'lucide-react';

interface ImageCropModalProps {
  file: File | Blob;
  onConfirm: (blob: Blob) => void;
  onCancel: () => void;
}

interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const HANDLE_SIZE = 22;

export function ImageCropModal({ file, onConfirm, onCancel }: ImageCropModalProps) {
  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null);
  const [rotation, setRotation] = useState(0); // 0 | 90 | 180 | 270
  const [crop, setCrop] = useState<CropRect | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ mode: 'move' | 'nw' | 'ne' | 'sw' | 'se'; startX: number; startY: number; start: CropRect } | null>(null);

  // Carga la imagen desde el File/Blob
  useEffect(() => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => setImgEl(img);
    img.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Dimensiones del stage (rotadas) y reinicio del crop al cambiar imagen/rotación
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (!imgEl) return;
    const isSideways = rotation === 90 || rotation === 270;
    const naturalW = isSideways ? imgEl.naturalHeight : imgEl.naturalWidth;
    const naturalH = isSideways ? imgEl.naturalWidth : imgEl.naturalHeight;
    const maxW = Math.min(window.innerWidth * 0.9, 480);
    const maxH = window.innerHeight * 0.55;
    const scale = Math.min(maxW / naturalW, maxH / naturalH, 1);
    const width = naturalW * scale;
    const height = naturalH * scale;
    setStageSize({ width, height });
    // Recorte inicial: toda la imagen con un pequeño margen interior.
    const margin = Math.min(width, height) * 0.05;
    setCrop({ x: margin, y: margin, width: width - margin * 2, height: height - margin * 2 });
  }, [imgEl, rotation]);

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

  const handleRotate = () => setRotation(r => (r + 90) % 360 as 0 | 90 | 180 | 270);

  const handleConfirm = () => {
    if (!imgEl || !crop || stageSize.width === 0) return;
    const isSideways = rotation === 90 || rotation === 270;
    const naturalW = isSideways ? imgEl.naturalHeight : imgEl.naturalWidth;
    const scaleToNatural = naturalW / stageSize.width;

    // Canvas intermedio con la imagen ya rotada, del tamaño "stage" en
    // resolución natural, para recortar sobre coordenadas consistentes.
    const rotatedCanvas = document.createElement('canvas');
    const naturalH = isSideways ? imgEl.naturalWidth : imgEl.naturalHeight;
    rotatedCanvas.width = naturalW;
    rotatedCanvas.height = naturalH;
    const rctx = rotatedCanvas.getContext('2d');
    if (!rctx) return;
    rctx.save();
    rctx.translate(naturalW / 2, naturalH / 2);
    rctx.rotate((rotation * Math.PI) / 180);
    if (isSideways) {
      rctx.drawImage(imgEl, -imgEl.naturalWidth / 2, -imgEl.naturalHeight / 2);
    } else {
      rctx.drawImage(imgEl, -imgEl.naturalWidth / 2, -imgEl.naturalHeight / 2);
    }
    rctx.restore();

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
    outCanvas.toBlob((blob) => { if (blob) onConfirm(blob); }, 'image/jpeg', 0.85);
  };

  return createPortal(
    <div className="fixed inset-0 z-[10000] bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[var(--bg-app)] rounded-2xl shadow-xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90dvh]">
        <div className="flex items-center justify-between p-4 border-b border-slate-200/50">
          <h3 className="font-bold text-sm text-[var(--text-main)]">Ajustar portada</h3>
          <button onClick={onCancel} className="text-slate-400 hover:text-[var(--text-main)] p-1 rounded-full hover:bg-slate-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-auto flex items-center justify-center p-4 bg-slate-900/5">
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
                alt="Portada a recortar"
                draggable={false}
                className="absolute inset-0 w-full h-full object-cover pointer-events-none"
                style={{ transform: `rotate(${rotation}deg)`, transformOrigin: 'center' }}
              />
              {/* Overlay oscuro fuera del recorte */}
              <div className="absolute inset-0 bg-black/50" style={{ clipPath: `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 ${crop.y}px, ${crop.x}px ${crop.y}px, ${crop.x}px ${crop.y + crop.height}px, ${crop.x + crop.width}px ${crop.y + crop.height}px, ${crop.x + crop.width}px ${crop.y}px, 0 ${crop.y}px)` }} />
              {/* Rectángulo de recorte arrastrable */}
              <div
                onPointerDown={handlePointerDown('move')}
                className="absolute border-2 border-white shadow-[0_0_0_9999px_rgba(0,0,0,0)] cursor-move"
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

        <div className="flex items-center justify-between gap-3 p-4 border-t border-slate-200/50">
          <button onClick={handleRotate} className="flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors">
            <RotateCw className="w-4 h-4" /> Rotar
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
