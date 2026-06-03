// =============================================================================
// AuditorPanel.tsx — Panel de auditoría científica (inline en ReaderView)
// =============================================================================

import { useState } from 'react';
import {
  X, FlaskConical, ChevronDown, ChevronUp,
  BookOpen, Lightbulb, Microscope, Target, Activity,
  ShieldAlert, Shield, EyeOff, FileWarning, AlertCircle, Search,
  Copy, Check
} from 'lucide-react';
import { cn } from '../lib/utils';
import type { BookItem } from '../types';

interface AuditResult {
  titulo_del_estudio: string;
  veredicto_general: string;
  nivel_credibilidad: string;
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

type CredLevel = 'alto' | 'medio' | 'bajo';

function getCredLevel(nivel: string): CredLevel {
  const l = nivel.toLowerCase();
  if (l.includes('alto') || l.includes('high')) return 'alto';
  if (l.includes('bajo') || l.includes('low')) return 'bajo';
  return 'medio';
}

function getCorroborationLevel(text: string): CredLevel {
  const l = text.toLowerCase();
  if (l.includes('alta') || l.includes('alto')) return 'alto';
  if (l.includes('baja') || l.includes('bajo')) return 'bajo';
  return 'medio';
}

function Semaforo({ level }: { level: CredLevel }) {
  return (
    <div className="bg-slate-900 p-3 rounded-full border border-slate-800 flex flex-col gap-2.5 shadow-inner">
      <div className={cn(
        "w-10 h-10 rounded-full border-2 transition-all duration-500",
        level === 'alto'
          ? 'bg-emerald-500 border-emerald-400 shadow-[0_0_18px_rgba(16,185,129,0.8)] scale-110'
          : 'bg-emerald-950 border-emerald-900/50 opacity-30'
      )} />
      <div className={cn(
        "w-10 h-10 rounded-full border-2 transition-all duration-500",
        level === 'medio'
          ? 'bg-amber-400 border-amber-300 shadow-[0_0_18px_rgba(251,191,36,0.8)] scale-110'
          : 'bg-amber-950 border-amber-900/50 opacity-30'
      )} />
      <div className={cn(
        "w-10 h-10 rounded-full border-2 transition-all duration-500",
        level === 'bajo'
          ? 'bg-rose-500 border-rose-400 shadow-[0_0_18px_rgba(225,29,72,0.8)] scale-110'
          : 'bg-rose-950 border-rose-900/50 opacity-30'
      )} />
    </div>
  );
}

function CollapsibleSection({ title, icon, children, defaultOpen = false }: {
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
        <div className="flex items-center gap-2 font-bold text-slate-700 text-sm">
          {icon}
          {title}
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
      </button>
      {open && (
        <div className="px-4 py-4 bg-white space-y-4 text-sm text-slate-700 leading-relaxed">
          {children}
        </div>
      )}
    </div>
  );
}

function Field({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">{label}</p>
      {accent
        ? <p className="font-semibold text-slate-800 border-l-4 border-[#00558F] pl-3 py-1 leading-relaxed">{value}</p>
        : <p className="text-slate-700 leading-relaxed">{value}</p>
      }
    </div>
  );
}

interface AuditorPanelProps {
  item: BookItem;
  onClose: () => void;
}

export function AuditorPanel({ item, onClose }: AuditorPanelProps) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AuditResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const fileName = item.source?.replace('/api/files/', '') ?? '';

  const handleAudit = async () => {
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
      const text = await res.text();
      let data: any;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`Respuesta inesperada del servidor: ${text.slice(0, 200)}`);
      }
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
      setResult(data.result as AuditResult);
    } catch (e: any) {
      setError(e.message || 'Error desconocido.');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    if (!result) return;
    const md = `# Auditoría Científica: ${result.titulo_del_estudio}

## Veredicto General
${result.veredicto_general}

## Síntesis Crítica
**La realidad de los datos crudos:** ${result.sintesis_para_el_pensamiento_critico.la_realidad_de_los_datos_crudos}
**Traducción al mundo real:** ${result.sintesis_para_el_pensamiento_critico.traduccion_de_la_incertidumbre_al_mundo_real}

## Auditoría Epistemológica
**Corroboración objetiva:** ${result.auditoria_epistemologica.grado_de_corroboracion_objetiva}
**Infradeterminación:** ${result.auditoria_epistemologica.infradeterminacion_explicaciones_alternativas}

## Disección Teórica
**Falsabilidad:** ${result.diseccion_teorica_y_conceptual.falsabilidad_y_riesgo_popperiano}
**Validez de constructo:** ${result.diseccion_teorica_y_conceptual.brecha_de_validez_de_constructo}
**Hipótesis ad hoc:** ${result.diseccion_teorica_y_conceptual.hipotesis_ad_hoc_lakatosianas}

## Escrutinio Metodológico
**Controles:** ${result.escrutinio_metodologico_y_estadistico.adecuacion_y_omision_de_controles}
**Robustez:** ${result.escrutinio_metodologico_y_estadistico.robustez_y_relevancia_real}
**P-Hacking:** ${result.escrutinio_metodologico_y_estadistico.rastros_de_p_hacking}

## Sesgos y Datos Faltantes
**Sesgo interno:** ${result.auditoria_de_sesgos_y_datos_faltantes.sesgo_de_reporte_interno}
**Incentivos:** ${result.auditoria_de_sesgos_y_datos_faltantes.alineacion_de_incentivos}

## Banderas Rojas
**Brecha causal:** ${result.detector_de_cientificismo_y_banderas_rojas.brecha_causal_y_extrapolacion}
**Cherry-picking:** ${result.detector_de_cientificismo_y_banderas_rojas.cherry_picking_contextual}
**Opacidad:** ${result.detector_de_cientificismo_y_banderas_rojas.opacidad_para_refutacion}

## Guía de Aprendizaje
**Qué aprender:** ${result.guia_de_aprendizaje.que_aprender_de_este_documento}
**Conceptos clave:** ${result.guia_de_aprendizaje.conceptos_clave_verificados}
**Conexiones:** ${result.guia_de_aprendizaje.conexiones_con_otros_campos}
**Preguntas:** ${result.guia_de_aprendizaje.preguntas_para_reflexion}
**Conclusión:** ${result.guia_de_aprendizaje.conclusion_para_el_lector}`;
    navigator.clipboard.writeText(md);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const credLevel = result ? getCredLevel(result.nivel_credibilidad) : null;
  const corroLevel = result ? getCorroborationLevel(result.auditoria_epistemologica.grado_de_corroboracion_objetiva) : null;

  return (
    <div className="flex flex-col min-h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-slate-200 shrink-0 sticky top-0 bg-white z-10 shadow-sm">
        <div className="flex items-center gap-2">
          <FlaskConical className="w-5 h-5 text-[#00558F]" />
          <h2 className="font-bold text-slate-800 text-base">Auditoría Científica</h2>
        </div>
        <div className="flex items-center gap-2">
          {result && (
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-200 bg-white text-slate-600 hover:text-[#00558F] hover:border-[#00558F]/30 rounded-lg transition-colors shadow-sm"
              title="Copiar análisis"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">{copied ? 'Copiado' : 'Copiar'}</span>
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="px-4 sm:px-6 py-5 space-y-5 max-w-3xl mx-auto w-full pb-10">

        {/* Info del documento */}
        <div className="bg-slate-50 rounded-xl p-3 border border-slate-200">
          <p className="text-xs text-slate-500 font-medium mb-0.5">Documento</p>
          <p className="font-semibold text-slate-800 text-sm line-clamp-2">{item.title}</p>
          {item.author && <p className="text-xs text-[#00558F] mt-0.5">{item.author}</p>}
        </div>

        {/* Estado: inicio */}
        {!result && !loading && (
          <div className="flex flex-col items-center gap-4 py-10">
            <div className="w-16 h-16 rounded-2xl bg-[#00558F]/10 flex items-center justify-center">
              <Microscope className="w-8 h-8 text-[#00558F]" />
            </div>
            <div className="text-center space-y-1 max-w-sm">
              <p className="font-semibold text-slate-700">Análisis científico completo</p>
              <p className="text-sm text-slate-500">
                Gemini evaluará el rigor metodológico, sesgos, p-hacking y extraerá los aprendizajes clave del documento completo.
              </p>
            </div>
            <button
              onClick={handleAudit}
              className="flex items-center gap-2 px-6 py-3 bg-[#00558F] hover:bg-[#004270] text-white font-semibold rounded-xl shadow-md transition-all hover:-translate-y-0.5 active:scale-95"
            >
              <FlaskConical className="w-5 h-5" />
              Iniciar Auditoría
            </button>
            <p className="text-xs text-slate-400">Puede tardar 30–90 segundos</p>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex flex-col items-center gap-5 py-16">
            <div className="relative">
              <div className="w-16 h-16 border-4 border-slate-100 rounded-full" />
              <div className="w-16 h-16 border-4 border-[#00558F] rounded-full border-t-transparent animate-spin absolute top-0 left-0" />
            </div>
            <div className="text-center space-y-1">
              <p className="text-slate-700 font-semibold">Auditando el documento...</p>
              <p className="text-xs text-slate-400 max-w-xs text-center">Gemini está diseccionando sesgos, fallos metodológicos y buscando p-hacking</p>
            </div>
          </div>
        )}

        {/* Error */}
        {error && !loading && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">
            <p className="font-semibold mb-1">Error al auditar</p>
            <p>{error}</p>
            <button onClick={handleAudit} className="mt-3 text-xs underline text-red-600">Reintentar</button>
          </div>
        )}

        {/* Resultados */}
        {result && credLevel && corroLevel && (
          <div className="space-y-5">

            {/* Hero: Síntesis + Semáforo */}
            <div className="bg-gradient-to-br from-[#00558F] to-[#003a66] text-white rounded-2xl overflow-hidden shadow-lg">
              <div className="p-5 sm:p-6 relative">
                <div className="absolute top-0 right-0 p-6 opacity-10 pointer-events-none">
                  <Microscope className="w-32 h-32 sm:w-40 sm:h-40" />
                </div>
                <div className="relative z-10">
                  {result.titulo_del_estudio && (
                    <p className="text-[#A0CFEB] text-xs font-bold uppercase tracking-widest mb-2 line-clamp-2">{result.titulo_del_estudio}</p>
                  )}
                  <div className="flex items-start gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-blue-200 font-bold uppercase tracking-widest mb-2 flex items-center gap-1.5">
                        <Target className="w-3.5 h-3.5" /> La Realidad de los Datos
                      </p>
                      <p className="text-lg sm:text-xl font-black leading-tight mb-4">
                        {result.sintesis_para_el_pensamiento_critico.la_realidad_de_los_datos_crudos}
                      </p>
                      <div className="bg-white/10 backdrop-blur-sm p-3 sm:p-4 rounded-xl border border-white/20">
                        <p className="text-blue-200 text-xs font-bold uppercase tracking-widest mb-1.5">Traducción al mundo real</p>
                        <p className="text-sm text-blue-50 leading-relaxed font-medium">
                          {result.sintesis_para_el_pensamiento_critico.traduccion_de_la_incertidumbre_al_mundo_real}
                        </p>
                      </div>
                    </div>
                    {/* Semáforo */}
                    <div className="shrink-0 flex flex-col items-center gap-2">
                      <Semaforo level={corroLevel} />
                      <p className={cn(
                        "text-xs font-black uppercase tracking-wider",
                        corroLevel === 'alto' ? 'text-emerald-400' : corroLevel === 'bajo' ? 'text-rose-400' : 'text-amber-400'
                      )}>
                        {corroLevel === 'alto' ? 'Alta' : corroLevel === 'bajo' ? 'Baja' : 'Moderada'}
                      </p>
                      <p className="text-[10px] text-blue-300 text-center leading-tight">Corroboración</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Veredicto + Credibilidad */}
              <div className="bg-white/10 border-t border-white/10 px-5 sm:px-6 py-3 flex items-center justify-between gap-3">
                <p className="text-sm text-blue-100 leading-relaxed flex-1 min-w-0">{result.veredicto_general}</p>
                <span className={cn(
                  "shrink-0 text-xs font-black px-3 py-1.5 rounded-full border",
                  credLevel === 'alto'
                    ? 'bg-emerald-500/20 border-emerald-400/40 text-emerald-300'
                    : credLevel === 'bajo'
                    ? 'bg-rose-500/20 border-rose-400/40 text-rose-300'
                    : 'bg-amber-500/20 border-amber-400/40 text-amber-300'
                )}>
                  Credibilidad {credLevel === 'alto' ? 'Alta' : credLevel === 'bajo' ? 'Baja' : 'Media'}
                </span>
              </div>
            </div>

            {/* Banderas Rojas — 3 columnas */}
            <div className="bg-rose-50 border-2 border-rose-200 rounded-2xl p-4 sm:p-5 relative overflow-hidden">
              <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
                <ShieldAlert className="w-24 h-24 text-rose-900" />
              </div>
              <h3 className="text-rose-700 font-black uppercase tracking-widest text-xs flex items-center gap-2 mb-4">
                <ShieldAlert className="w-4 h-4" /> Detector de Cientificismo y Banderas Rojas
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {[
                  { label: 'Brecha Causal', value: result.detector_de_cientificismo_y_banderas_rojas.brecha_causal_y_extrapolacion },
                  { label: 'Cherry-Picking', value: result.detector_de_cientificismo_y_banderas_rojas.cherry_picking_contextual },
                  { label: 'Opacidad', value: result.detector_de_cientificismo_y_banderas_rojas.opacidad_para_refutacion },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-white/80 p-4 rounded-xl border border-rose-100 shadow-sm">
                    <h4 className="text-xs font-bold text-rose-700 uppercase tracking-wider mb-2 pb-2 border-b border-rose-100">{label}</h4>
                    <p className="text-xs text-slate-800 leading-relaxed">{value}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Escrutinio Metodológico */}
            <CollapsibleSection
              title="Escrutinio Metodológico y Estadístico"
              icon={<Activity className="w-4 h-4 text-[#00558F]" />}
              defaultOpen={true}
            >
              <div className="flex gap-3">
                <div className="w-9 h-9 shrink-0 bg-[#00558F]/10 text-[#00558F] flex items-center justify-center font-black rounded-lg text-sm">C</div>
                <Field label="Adecuación de Controles" value={result.escrutinio_metodologico_y_estadistico.adecuacion_y_omision_de_controles} />
              </div>
              <div className="h-px bg-slate-100 w-full" />
              <div className="flex gap-3">
                <div className="w-9 h-9 shrink-0 bg-[#00558F]/10 text-[#00558F] flex items-center justify-center font-black rounded-lg text-sm">R</div>
                <Field label="Robustez y Relevancia Real" value={result.escrutinio_metodologico_y_estadistico.robustez_y_relevancia_real} />
              </div>
              <div className="h-px bg-slate-100 w-full" />
              <div className="flex gap-3">
                <div className="w-9 h-9 shrink-0 bg-amber-50 text-amber-600 flex items-center justify-center rounded-lg">
                  <Search className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Rastros de P-Hacking</p>
                  <p className="font-semibold bg-amber-50 p-3 rounded-xl border border-amber-200 text-slate-800 text-sm leading-relaxed">
                    {result.escrutinio_metodologico_y_estadistico.rastros_de_p_hacking}
                  </p>
                </div>
              </div>
            </CollapsibleSection>

            {/* Disección Teórica + Sesgos — grid 2 col en pantallas grandes */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Disección Teórica */}
              <CollapsibleSection
                title="Disección Teórica y Conceptual"
                icon={<Shield className="w-4 h-4 text-[#00558F]" />}
                defaultOpen={false}
              >
                <Field label="Falsabilidad (Riesgo Popperiano)" value={result.diseccion_teorica_y_conceptual.falsabilidad_y_riesgo_popperiano} accent />
                <div className="h-px bg-slate-100" />
                <Field label="Brecha de Validez de Constructo" value={result.diseccion_teorica_y_conceptual.brecha_de_validez_de_constructo} accent />
                <div className="h-px bg-slate-100" />
                <div>
                  <p className="text-xs font-bold text-[#00558F] uppercase tracking-wider mb-1.5">Hipótesis Ad Hoc (Lakatosianas)</p>
                  <p className="italic text-slate-700 bg-slate-50 p-3 rounded-xl border border-slate-200 text-sm leading-relaxed">
                    "{result.diseccion_teorica_y_conceptual.hipotesis_ad_hoc_lakatosianas}"
                  </p>
                </div>
              </CollapsibleSection>

              {/* Sesgos */}
              <CollapsibleSection
                title="Sesgos y Datos Faltantes"
                icon={<EyeOff className="w-4 h-4 text-slate-500" />}
                defaultOpen={false}
              >
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                    <FileWarning className="w-3.5 h-3.5 text-amber-500" /> Sesgo de Reporte Interno
                  </p>
                  <p className="text-slate-800 font-semibold text-sm leading-relaxed">{result.auditoria_de_sesgos_y_datos_faltantes.sesgo_de_reporte_interno}</p>
                </div>
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 text-[#00558F]" /> Alineación de Incentivos
                  </p>
                  <p className="text-slate-800 font-semibold text-sm leading-relaxed">{result.auditoria_de_sesgos_y_datos_faltantes.alineacion_de_incentivos}</p>
                </div>
                <div>
                  <p className="text-xs font-bold text-[#00558F] uppercase tracking-wider mb-1.5">Infradeterminación</p>
                  <div className="bg-[#00558F]/5 p-3 rounded-xl border border-[#00558F]/15 text-sm text-[#003a66] leading-relaxed">
                    {result.auditoria_epistemologica.infradeterminacion_explicaciones_alternativas}
                  </div>
                </div>
              </CollapsibleSection>
            </div>

            {/* Epistemológica */}
            <CollapsibleSection
              title="Auditoría Epistemológica"
              icon={<span className="text-sm">🔬</span>}
              defaultOpen={false}
            >
              <Field label="Grado de Corroboración Objetiva" value={result.auditoria_epistemologica.grado_de_corroboracion_objetiva} />
              <div className="h-px bg-slate-100" />
              <Field label="Infradeterminación y Explicaciones Alternativas" value={result.auditoria_epistemologica.infradeterminacion_explicaciones_alternativas} />
            </CollapsibleSection>

            {/* Guía de Aprendizaje */}
            <div className="border-2 border-[#00558F]/25 rounded-2xl overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 bg-[#00558F]/8 border-b border-[#00558F]/15">
                <BookOpen className="w-4 h-4 text-[#00558F]" />
                <span className="font-black text-[#00558F] text-sm uppercase tracking-wider">Guía de Aprendizaje</span>
              </div>
              <div className="px-4 py-4 bg-white space-y-4 text-sm">
                <Field label="¿Qué aprender de este documento?" value={result.guia_de_aprendizaje.que_aprender_de_este_documento} />
                <div className="h-px bg-slate-100" />
                <Field label="Conceptos clave verificados" value={result.guia_de_aprendizaje.conceptos_clave_verificados} />
                <div className="h-px bg-slate-100" />
                <Field label="Conexiones con otros campos" value={result.guia_de_aprendizaje.conexiones_con_otros_campos} />
                <div className="h-px bg-slate-100" />
                <Field label="Preguntas para reflexión" value={result.guia_de_aprendizaje.preguntas_para_reflexion} />
                <div className="h-px bg-slate-100" />
                <div className="bg-[#00558F]/5 rounded-xl p-4 border border-[#00558F]/15">
                  <div className="flex items-start gap-2">
                    <Lightbulb className="w-4 h-4 text-[#00558F] mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs font-bold text-[#00558F] uppercase tracking-wider mb-1.5">Conclusión para el lector</p>
                      <p className="text-slate-700 leading-relaxed font-medium">{result.guia_de_aprendizaje.conclusion_para_el_lector}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Auditar de nuevo */}
            <button
              onClick={handleAudit}
              className="w-full py-3 text-sm text-slate-500 hover:text-[#00558F] border border-slate-200 hover:border-[#00558F]/30 rounded-xl transition-colors font-medium"
            >
              Volver a auditar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
