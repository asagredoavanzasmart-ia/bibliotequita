// =============================================================================
// AuditorModal.tsx — Auditoría científica de estudios y artículos
// =============================================================================

import { useState } from 'react';
import { X, FlaskConical, AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, BookOpen, Lightbulb, Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';
import type { BookItem } from '../types';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------
interface AuditResult {
  titulo_del_estudio: string;
  veredicto_general: string;
  nivel_credibilidad: 'alto' | 'medio' | 'bajo' | string;
  auditoria_epistemologica: {
    grado_de_corroboracion_objetiva: string;
    infradeterminacion_explicaciones_alternativas: string;
  };
  diseccion_teorica_y_conceptual: {
    falsabilidad_y_riesgo_popperiano: string;
    brecha_de_validez_de_constructo: string;
    hipotesis_ad_hoc_lakatosianas: string;
  };
  escrutinio_metodologico_y_estadistico: {
    adecuacion_y_omision_de_controles: string;
    robustez_y_relevancia_real: string;
    rastros_de_p_hacking: string;
  };
  auditoria_de_sesgos_y_datos_faltantes: {
    sesgo_de_reporte_interno: string;
    alineacion_de_incentivos: string;
  };
  detector_de_cientificismo_y_banderas_rojas: {
    brecha_causal_y_extrapolacion: string;
    cherry_picking_contextual: string;
    opacidad_para_refutacion: string;
  };
  sintesis_para_el_pensamiento_critico: {
    la_realidad_de_los_datos_crudos: string;
    traduccion_de_la_incertidumbre_al_mundo_real: string;
  };
  guia_de_aprendizaje: {
    que_aprender_de_este_documento: string;
    conceptos_clave_verificados: string;
    conexiones_con_otros_campos: string;
    preguntas_para_reflexion: string;
    conclusion_para_el_lector: string;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function credibilityConfig(level: string) {
  const l = level.toLowerCase();
  if (l.includes('alto') || l.includes('high')) {
    return { label: 'Alto', color: 'bg-emerald-100 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500', icon: <CheckCircle2 className="w-4 h-4" /> };
  }
  if (l.includes('medio') || l.includes('medium') || l.includes('moderate')) {
    return { label: 'Medio', color: 'bg-amber-100 text-amber-700 border-amber-200', dot: 'bg-amber-500', icon: <AlertTriangle className="w-4 h-4" /> };
  }
  return { label: 'Bajo', color: 'bg-red-100 text-red-700 border-red-200', dot: 'bg-red-500', icon: <AlertTriangle className="w-4 h-4" /> };
}

function Section({ title, icon, children, defaultOpen = false }: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-colors text-left"
      >
        <div className="flex items-center gap-2 font-semibold text-slate-700 text-sm">
          {icon}
          {title}
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
      </button>
      {open && (
        <div className="px-4 py-3 bg-white space-y-3 text-sm text-slate-700 leading-relaxed">
          {children}
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">{label}</p>
      <p className="text-slate-700 leading-relaxed">{value}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------
interface AuditorModalProps {
  item: BookItem;
  onClose: () => void;
}

export function AuditorModal({ item, onClose }: AuditorModalProps) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AuditResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canAudit = item.type === 'pdf' && item.source?.startsWith('/api/files/');

  const handleAudit = async () => {
    if (!canAudit) return;
    const fileName = item.source.replace('/api/files/', '');
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/audit-resource', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ fileName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error desconocido');
      setResult(data.result as AuditResult);
    } catch (e: any) {
      setError(e.message || 'Error al conectar con el servidor.');
    } finally {
      setLoading(false);
    }
  };

  const cred = result ? credibilityConfig(result.nivel_credibilidad) : null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-2">
            <FlaskConical className="w-5 h-5 text-[#00558F]" />
            <h2 className="font-bold text-slate-800 text-base">Auditor Científico</h2>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Info del documento */}
          <div className="bg-slate-50 rounded-xl p-3 border border-slate-200">
            <p className="text-xs text-slate-500 font-medium mb-0.5">Documento a auditar</p>
            <p className="font-semibold text-slate-800 text-sm line-clamp-2">{item.title}</p>
            {item.author && <p className="text-xs text-[#00558F] mt-0.5">{item.author}</p>}
          </div>

          {/* Estado: no compatible */}
          {!canAudit && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-amber-800 text-sm">
              <p className="font-semibold mb-1">No disponible para este recurso</p>
              <p className="text-amber-700">La auditoría solo funciona con archivos PDF subidos al servidor. Los recursos externos o EPUB no son compatibles actualmente.</p>
            </div>
          )}

          {/* Botón iniciar */}
          {canAudit && !result && !loading && (
            <div className="flex flex-col items-center gap-3 py-6">
              <p className="text-sm text-slate-500 text-center max-w-sm">
                Gemini analizará el rigor científico, metodología, sesgos y extraerá los aprendizajes clave del documento.
              </p>
              <button
                onClick={handleAudit}
                className="flex items-center gap-2 px-6 py-3 bg-[#00558F] hover:bg-[#004270] text-white font-semibold rounded-xl shadow-md transition-all hover:-translate-y-0.5 active:scale-95"
              >
                <FlaskConical className="w-5 h-5" />
                Iniciar Auditoría
              </button>
              <p className="text-xs text-slate-400">Puede tardar 30–60 segundos</p>
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div className="flex flex-col items-center gap-4 py-10">
              <Loader2 className="w-10 h-10 text-[#00558F] animate-spin" />
              <p className="text-slate-600 font-medium">Analizando el documento...</p>
              <p className="text-xs text-slate-400 text-center max-w-xs">Gemini está leyendo el paper completo y evaluando su rigor científico</p>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">
              <p className="font-semibold mb-1">Error al auditar</p>
              <p>{error}</p>
              <button onClick={handleAudit} className="mt-3 text-xs underline text-red-600">Reintentar</button>
            </div>
          )}

          {/* Resultados */}
          {result && cred && (
            <div className="space-y-3">
              {/* Veredicto */}
              <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-xl p-4 text-white">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Veredicto General</p>
                  <span className={cn("flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full border", cred.color)}>
                    <span className={cn("w-2 h-2 rounded-full", cred.dot)} />
                    Credibilidad {cred.label}
                  </span>
                </div>
                <p className="text-sm leading-relaxed text-slate-200">{result.veredicto_general}</p>
              </div>

              {/* 6 secciones de auditoría */}
              <Section title="Auditoría Epistemológica" icon={<span className="text-base">🔬</span>} defaultOpen={true}>
                <Field label="Grado de corroboración objetiva" value={result.auditoria_epistemologica.grado_de_corroboracion_objetiva} />
                <Field label="Infradeterminación y explicaciones alternativas" value={result.auditoria_epistemologica.infradeterminacion_explicaciones_alternativas} />
              </Section>

              <Section title="Disección Teórica y Conceptual" icon={<span className="text-base">📐</span>}>
                <Field label="Falsabilidad y riesgo popperiano" value={result.diseccion_teorica_y_conceptual.falsabilidad_y_riesgo_popperiano} />
                <Field label="Brecha de validez de constructo" value={result.diseccion_teorica_y_conceptual.brecha_de_validez_de_constructo} />
                <Field label="Hipótesis ad hoc lakatosianas" value={result.diseccion_teorica_y_conceptual.hipotesis_ad_hoc_lakatosianas} />
              </Section>

              <Section title="Escrutinio Metodológico y Estadístico" icon={<span className="text-base">📊</span>}>
                <Field label="Adecuación y omisión de controles" value={result.escrutinio_metodologico_y_estadistico.adecuacion_y_omision_de_controles} />
                <Field label="Robustez y relevancia real" value={result.escrutinio_metodologico_y_estadistico.robustez_y_relevancia_real} />
                <Field label="Rastros de p-hacking" value={result.escrutinio_metodologico_y_estadistico.rastros_de_p_hacking} />
              </Section>

              <Section title="Auditoría de Sesgos y Datos Faltantes" icon={<span className="text-base">⚖️</span>}>
                <Field label="Sesgo de reporte interno" value={result.auditoria_de_sesgos_y_datos_faltantes.sesgo_de_reporte_interno} />
                <Field label="Alineación de incentivos" value={result.auditoria_de_sesgos_y_datos_faltantes.alineacion_de_incentivos} />
              </Section>

              <Section title="Detector de Cientificismo y Banderas Rojas" icon={<AlertTriangle className="w-4 h-4 text-red-500" />}>
                <Field label="Brecha causal y extrapolación" value={result.detector_de_cientificismo_y_banderas_rojas.brecha_causal_y_extrapolacion} />
                <Field label="Cherry picking contextual" value={result.detector_de_cientificismo_y_banderas_rojas.cherry_picking_contextual} />
                <Field label="Opacidad para refutación" value={result.detector_de_cientificismo_y_banderas_rojas.opacidad_para_refutacion} />
              </Section>

              <Section title="Síntesis para el Pensamiento Crítico" icon={<span className="text-base">💡</span>}>
                <Field label="La realidad de los datos crudos" value={result.sintesis_para_el_pensamiento_critico.la_realidad_de_los_datos_crudos} />
                <Field label="Traducción de la incertidumbre al mundo real" value={result.sintesis_para_el_pensamiento_critico.traduccion_de_la_incertidumbre_al_mundo_real} />
              </Section>

              {/* Guía de aprendizaje — sección destacada */}
              <div className="border-2 border-[#00558F]/20 rounded-xl overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 bg-[#00558F]/5 border-b border-[#00558F]/10">
                  <BookOpen className="w-4 h-4 text-[#00558F]" />
                  <span className="font-bold text-[#00558F] text-sm">Guía de Aprendizaje</span>
                </div>
                <div className="px-4 py-3 bg-white space-y-3 text-sm text-slate-700 leading-relaxed">
                  <Field label="¿Qué aprender de este documento?" value={result.guia_de_aprendizaje.que_aprender_de_este_documento} />
                  <Field label="Conceptos clave verificados" value={result.guia_de_aprendizaje.conceptos_clave_verificados} />
                  <Field label="Conexiones con otros campos" value={result.guia_de_aprendizaje.conexiones_con_otros_campos} />
                  <Field label="Preguntas para reflexión" value={result.guia_de_aprendizaje.preguntas_para_reflexion} />
                  <div className="bg-[#00558F]/5 rounded-lg p-3 border border-[#00558F]/10">
                    <div className="flex items-start gap-2">
                      <Lightbulb className="w-4 h-4 text-[#00558F] mt-0.5 shrink-0" />
                      <div>
                        <p className="text-xs font-bold text-[#00558F] uppercase tracking-wider mb-1">Conclusión para el lector</p>
                        <p className="text-slate-700">{result.guia_de_aprendizaje.conclusion_para_el_lector}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Botón nueva auditoría */}
              <button
                onClick={handleAudit}
                className="w-full py-2.5 text-sm text-slate-500 hover:text-[#00558F] border border-slate-200 hover:border-[#00558F]/30 rounded-xl transition-colors"
              >
                Volver a auditar
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
