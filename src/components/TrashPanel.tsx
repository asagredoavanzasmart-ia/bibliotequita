import React from 'react';
import { useLibrary } from '../hooks/useLibrary';
import { Trash2, RotateCcw, AlertTriangle, FileText, BookOpen, Globe, Calendar } from 'lucide-react';
import { cn } from '../lib/utils';

export function TrashPanel() {
  const { trashItems, restoreItem, permanentlyDeleteItem } = useLibrary();

  // Calcular días restantes de retención (5 días desde deletedAt)
  const getRemainingDays = (deletedAt?: string) => {
    if (!deletedAt) return 5;
    const deletedDate = new Date(deletedAt);
    const expiryDate = new Date(deletedDate.getTime() + 5 * 24 * 60 * 60 * 1000);
    const now = new Date();
    const diffMs = expiryDate.getTime() - now.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    return Math.max(0, diffDays);
  };

  // Formatear la fecha de eliminación en español
  const formatDate = (dateString?: string) => {
    if (!dateString) return '';
    try {
      const d = new Date(dateString);
      return d.toLocaleDateString('es-ES', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return '';
    }
  };

  const handlePermanentDelete = (id: string, title: string) => {
    const confirmed = window.confirm(
      `¿Estás absolutamente seguro de que deseas eliminar permanentemente "${title}"?\n\nEsta acción es irreversible y borrará el registro de la base de datos y todos los archivos físicos asociados del servidor.`
    );
    if (confirmed) {
      permanentlyDeleteItem(id);
    }
  };

  return (
    <div className="w-full flex flex-col gap-6 animate-in fade-in duration-200">
      {/* Banner de Advertencia Informativa */}
      <div className="bg-[var(--bg-card)] border border-[var(--border-card)] backdrop-blur-md rounded-2xl p-4 sm:p-5 flex items-start gap-4 shadow-sm">
        <div className="p-2 bg-amber-500/10 text-amber-500 rounded-xl shrink-0">
          <AlertTriangle className="w-6 h-6" />
        </div>
        <div className="flex flex-col gap-1">
          <h3 className="font-bold text-sm text-[var(--text-main)]">Papelera de Reciclaje</h3>
          <p className="text-xs text-[var(--text-muted)] leading-relaxed">
            Los elementos aquí listados han sido eliminados de tu biblioteca. Se conservarán durante un máximo de <strong className="text-[var(--text-main)] font-semibold">5 días</strong> a partir de su eliminación para que puedas restaurarlos. Tras este plazo, el sistema los eliminará <strong className="text-rose-500 font-semibold">físicamente y de forma permanente</strong> de forma automática.
          </p>
        </div>
      </div>

      {/* Listado de elementos en papelera */}
      {trashItems.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 px-4 bg-[var(--bg-card)] border border-[var(--border-card)] rounded-2xl shadow-sm text-center">
          <div className="p-4 bg-slate-100 dark:bg-slate-800 rounded-full mb-4">
            <Trash2 className="w-12 h-12 text-slate-400 dark:text-slate-500" />
          </div>
          <h4 className="font-bold text-lg text-[var(--text-main)] mb-1">La papelera está vacía</h4>
          <p className="text-sm text-[var(--text-muted)] max-w-sm">
            No tienes contenidos eliminados recientemente. Todo lo que borres en el catálogo principal aparecerá aquí.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {trashItems.map((item) => {
            const remainingDays = getRemainingDays(item.deletedAt);
            const isCritical = remainingDays <= 1;
            
            // Icono según tipo de recurso
            const ResourceIcon = item.type === 'externa' ? Globe : (item.type === 'pdf' ? FileText : BookOpen);

            return (
              <div 
                key={item.id}
                className="bg-[var(--bg-card)] hover:bg-[var(--bg-card-hover)] border border-[var(--border-card)] rounded-2xl p-4 flex gap-4 transition-all duration-300 shadow-sm relative group overflow-hidden"
              >
                {/* Portada o icono placeholder */}
                <div className="w-16 h-20 bg-[var(--bg-app)] shrink-0 rounded-lg overflow-hidden flex items-center justify-center border border-[var(--border-card)] relative">
                  {item.thumbnailUrl ? (
                    <img 
                      src={item.thumbnailUrl} 
                      alt={item.title} 
                      className="w-full h-full object-cover" 
                      draggable={false} 
                    />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-br from-[var(--primary)]/30 to-slate-800/10 flex items-center justify-center">
                      <ResourceIcon className="w-8 h-8 text-[var(--primary)] opacity-60" />
                    </div>
                  )}
                </div>

                {/* Detalles y Metadatos */}
                <div className="flex-1 flex flex-col justify-between min-w-0">
                  <div className="flex flex-col gap-0.5">
                    <h4 className="font-bold text-sm text-[var(--text-main)] truncate pr-28" title={item.title}>
                      {item.title}
                    </h4>
                    {item.author && (
                      <p className="text-xs text-[var(--text-muted)] truncate">
                        {item.author}
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-[11px] text-[var(--text-muted)]">
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5 shrink-0" />
                        Eliminado: {formatDate(item.deletedAt)}
                      </span>
                    </div>
                  </div>

                  {/* Botones de acción */}
                  <div className="flex items-center gap-2 mt-3 z-10 relative">
                    <button
                      onClick={() => restoreItem(item.id)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-[var(--primary)]/10 text-[var(--primary)] hover:bg-[var(--primary)] hover:text-white transition-all duration-200"
                      title="Restaurar elemento a la biblioteca activa"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Restaurar
                    </button>
                    <button
                      onClick={() => handlePermanentDelete(item.id, item.title)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-rose-500/10 text-rose-600 hover:bg-rose-600 hover:text-white transition-all duration-200"
                      title="Eliminar permanentemente del servidor"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Eliminar
                    </button>
                  </div>
                </div>

                {/* Badge de Días Restantes */}
                <div className="absolute top-3 right-3 shrink-0">
                  <span className={cn(
                    "text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider border",
                    isCritical 
                      ? "bg-rose-500/10 text-rose-500 border-rose-500/20 animate-pulse" 
                      : "bg-amber-500/10 text-amber-600 border-amber-500/20"
                  )}>
                    {remainingDays === 0 
                      ? 'Expirando hoy' 
                      : remainingDays === 1 
                        ? 'Queda 1 día' 
                        : `Quedan ${remainingDays} días`
                    }
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
