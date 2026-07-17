// =============================================================================
// AuditorPanel.tsx — Panel de auditoría científica (inline en ReaderView)
// -----------------------------------------------------------------------------
// v2 (schema_version === 2): marco epistemológico con semáforo de 5 estados
// (verde/amarillo/rojo/gris/no_aplica), tabla afirmación→dato, veredicto global
// CALCULADO en el servidor, auditoría bibliográfica y de retórica. El resultado
// NO da recomendaciones: describe qué soporta el estudio y qué no, y el lector
// concluye. Resultados viejos (sin schema_version) se muestran con la vista
// legacy intacta (feature-detect).
// =============================================================================

import { useState, useEffect } from 'react';
import {
  X, FlaskConical, BookOpen, Lightbulb, Microscope, Target, Activity,
  ShieldAlert, Shield, EyeOff, Search, ScrollText, Scale, Quote, ListChecks,
  Copy, Check, Download, FileSpreadsheet, Printer, AlertTriangle, MinusCircle, HelpCircle,
  Volume2, VolumeX,
} from 'lucide-react';
import { cn } from '../lib/utils';
import type { BookItem } from '../types';
import { exportToDocx, exportToPrintPdf } from '../utils/exportUtils';

// ---------------------------------------------------------------------------
// Tipos v2
// ---------------------------------------------------------------------------
export type NivelCriterio = 'verde' | 'amarillo' | 'rojo' | 'gris' | 'no_aplica';
type NivelAfirmacion = 'verde' | 'amarillo' | 'rojo' | 'gris';

interface Criterio { analisis: string; nivel: NivelCriterio; evidencia: string; regla_automatica?: string }
// v3: el nivel de una afirmación NO lo declara la IA — lo deriva el servidor
// como el peor de sus tres dimensiones (apoyo / seguridad independiente,
// derivada del anclaje / comprensividad). Modelo de Susan Haack: la
// justificación no es aditiva, una afirmación vale lo que su eslabón más débil.
type AnclajeEvidencia =
  | 'datos_propios_reportados' | 'estudio_empirico_citado' | 'obra_teorica_citada'
  | 'cita_de_cita' | 'interpretacion_del_autor' | 'sin_anclaje';
interface Afirmacion {
  afirmacion: string;
  soporte_en_los_datos: string;
  nivel: NivelAfirmacion;
  es_central?: boolean;
  anclaje_de_la_evidencia?: AnclajeEvidencia;
  apoyo?: NivelAfirmacion;
  comprensividad?: NivelAfirmacion;
  seguridad_independiente?: NivelAfirmacion;
  regla_automatica?: string;
}
interface CriterioDiseno { familia: string; nombre: string; analisis: string; nivel: NivelCriterio; evidencia: string; regla_automatica?: string }

type CriterioMap = Record<string, Criterio>;

// Etiquetas de anclaje: las "sin suelo" (ámbar) son las que el servidor
// castiga automáticamente — circularidad y lavado de citas.
const ANCLAJE_LABEL: Record<AnclajeEvidencia, { texto: string; alerta: boolean }> = {
  datos_propios_reportados: { texto: 'datos del propio estudio', alerta: false },
  estudio_empirico_citado: { texto: 'estudio empírico citado', alerta: false },
  obra_teorica_citada: { texto: 'obra teórica citada como prueba empírica', alerta: true },
  cita_de_cita: { texto: 'cita de cita: la cadena no toca datos', alerta: true },
  interpretacion_del_autor: { texto: 'solo la interpretación del autor', alerta: true },
  sin_anclaje: { texto: 'sin respaldo localizable', alerta: true },
};

interface AuditResultV2 {
  schema_version: 2;
  titulo_del_estudio: string;
  veredicto_general: string;
  veredicto_calculado?: {
    nivel: 'solido' | 'con_reservas' | 'debil' | 'insuficiente';
    conteos: { verde: number; amarillo: number; rojo: number; gris: number; no_aplica: number };
    regla_aplicada: string;
  };
  criterios_del_diseno?: CriterioDiseno[];
  reglas_automaticas_aplicadas?: string[];
  identificacion_y_tipologia: {
    tipo_de_documento: string;
    pregunta_o_afirmacion_central: string;
    poblacion_y_muestra: string;
    n_total?: number;
    subgrupos_analiticos?: { etiqueta: string; n: number }[];
    hace_comparaciones_entre_subgrupos?: boolean;
    n_weird?: number;
    n_no_weird?: number;
    afirma_generalidad_transcultural?: boolean;
    adecuacion_del_diseno: Criterio;
  };
  coherencia_datos_conclusiones: {
    afirmaciones: Afirmacion[];
    coherencia_global_datos_conclusiones: Criterio;
    spin_y_enfasis: Criterio;
  };
  escrutinio_metodologico_y_estadistico: CriterioMap;
  transparencia_y_datos: CriterioMap;
  sesgos_e_incentivos: CriterioMap;
  retorica_e_ideologia: CriterioMap;
  auditoria_bibliografica: CriterioMap;
  epistemologia: CriterioMap;
  sintesis_critica: {
    lo_que_dicen_los_datos: string;
    lo_que_el_estudio_si_soporta: string;
    lo_que_el_estudio_no_soporta: string;
    precauciones_de_lectura: string;
    incertidumbres_abiertas: string;
    conceptos_para_profundizar: string;
    preguntas_para_el_lector: string;
  };
}

// Configuración data-driven de las secciones de criterios v2. El render itera
// esta config: añadir/renombrar criterios en el futuro no exige tocar el JSX.
interface CriterioDef { key: string; label: string; critico?: boolean }
interface SeccionDef { key: keyof AuditResultV2; titulo: string; Icon: any; criterios: CriterioDef[] }

const AUDIT_SECTIONS: SeccionDef[] = [
  {
    key: 'escrutinio_metodologico_y_estadistico', titulo: 'Escrutinio metodológico y estadístico', Icon: Activity,
    criterios: [
      { key: 'controles_y_confusores', label: 'Controles y confusores', critico: true },
      { key: 'potencia_y_tamano_muestral', label: 'Potencia y tamaño muestral' },
      { key: 'magnitud_del_efecto_e_incertidumbre', label: 'Magnitud del efecto e incertidumbre' },
      { key: 'senales_de_p_hacking', label: 'Señales de p-hacking', critico: true },
    ],
  },
  {
    key: 'transparencia_y_datos', titulo: 'Transparencia y datos', Icon: Search,
    criterios: [
      { key: 'preregistro_y_protocolo', label: 'Preregistro y protocolo' },
      { key: 'disponibilidad_de_datos_y_codigo', label: 'Disponibilidad de datos y código' },
      { key: 'reporte_selectivo_de_resultados', label: 'Reporte selectivo de resultados', critico: true },
    ],
  },
  {
    key: 'sesgos_e_incentivos', titulo: 'Sesgos e incentivos', Icon: EyeOff,
    criterios: [
      { key: 'financiacion_y_conflictos', label: 'Financiación y conflictos de interés' },
      { key: 'sesgo_de_seleccion_y_muestreo', label: 'Sesgo de selección y muestreo' },
      { key: 'independencia_del_analisis', label: 'Independencia del análisis' },
    ],
  },
  {
    key: 'retorica_e_ideologia', titulo: 'Retórica e ideología (patrón textual)', Icon: Scale,
    criterios: [
      { key: 'lenguaje_cargado_y_normativo', label: 'Lenguaje cargado y normativo' },
      { key: 'salto_del_es_al_debe', label: 'Salto del «es» al «debe»' },
      { key: 'encuadre_y_alternativas_silenciadas', label: 'Encuadre y alternativas silenciadas' },
      { key: 'asimetria_de_exigencia_probatoria', label: 'Asimetría de exigencia probatoria' },
    ],
  },
  {
    key: 'auditoria_bibliografica', titulo: 'Auditoría bibliográfica', Icon: Quote,
    criterios: [
      { key: 'uso_real_de_las_fuentes', label: 'Uso real de las fuentes' },
      { key: 'calidad_de_fuentes_en_afirmaciones_clave', label: 'Calidad de fuentes en afirmaciones clave' },
      { key: 'autocitacion_y_endogamia', label: 'Autocitación y endogamia' },
      { key: 'afirmaciones_fuertes_sin_fuente', label: 'Afirmaciones fuertes sin fuente' },
      { key: 'inflacion_atributiva', label: 'Inflación atributiva («demostró» vs «argumenta»)' },
    ],
  },
  {
    key: 'epistemologia', titulo: 'Epistemología', Icon: Shield,
    criterios: [
      { key: 'falsabilidad', label: 'Falsabilidad (¿qué observación la refutaría?)' },
      { key: 'explicaciones_alternativas', label: 'Explicaciones alternativas' },
      { key: 'hipotesis_ad_hoc', label: 'Hipótesis ad hoc' },
      { key: 'validez_de_constructo', label: 'Definición y validez de constructo' },
      { key: 'salto_causal_y_extrapolacion', label: 'Salto causal, transporte y factores de soporte', critico: true },
      { key: 'corroboracion_externa', label: 'Corroboración externa y tasa base del campo' },
      { key: 'mecanismo_medido_o_narrado', label: '¿Mecanismo medido o narrado?', critico: true },
      { key: 'compatibilidad_con_el_conocimiento_establecido', label: 'Compatibilidad con el conocimiento establecido' },
      { key: 'modelo_causal_explicito', label: 'Modelo causal explícito' },
    ],
  },
];

// ---------------------------------------------------------------------------
// Semáforo de 5 estados: icono + estilos + emoji (export)
// ---------------------------------------------------------------------------
const NIVEL_META: Record<NivelCriterio, { emoji: string; label: string; dot: string; text: string; border: string }> = {
  verde:     { emoji: '🟢', label: 'Sin problema',  dot: 'bg-emerald-500', text: 'text-emerald-700', border: 'border-emerald-200' },
  amarillo:  { emoji: '🟡', label: 'Cautela',       dot: 'bg-amber-500',   text: 'text-amber-700',   border: 'border-amber-200' },
  rojo:      { emoji: '🔴', label: 'Problema',      dot: 'bg-rose-500',    text: 'text-rose-700',    border: 'border-rose-200' },
  gris:      { emoji: '⚪', label: 'No evaluable',  dot: 'bg-slate-400',   text: 'text-slate-600',   border: 'border-slate-200' },
  no_aplica: { emoji: '➖', label: 'No aplica',     dot: 'bg-slate-300',   text: 'text-slate-500',   border: 'border-slate-200' },
};

export function NivelIcon({ nivel }: { nivel?: NivelCriterio }) {
  const n = nivel && NIVEL_META[nivel] ? nivel : 'gris';
  if (n === 'verde') return <IconDot cls="bg-emerald-600"><Check className="w-2.5 h-2.5 text-white" strokeWidth={3} /></IconDot>;
  if (n === 'amarillo') return <IconDot cls="bg-amber-500"><AlertTriangle className="w-2.5 h-2.5 text-white" strokeWidth={3} /></IconDot>;
  if (n === 'rojo') return <IconDot cls="bg-rose-600"><X className="w-2.5 h-2.5 text-white" strokeWidth={3} /></IconDot>;
  if (n === 'no_aplica') return <IconDot cls="bg-slate-300"><MinusCircle className="w-2.5 h-2.5 text-white" strokeWidth={3} /></IconDot>;
  return <IconDot cls="bg-slate-400"><HelpCircle className="w-2.5 h-2.5 text-white" strokeWidth={3} /></IconDot>;
}
function IconDot({ cls, children }: { cls: string; children: React.ReactNode }) {
  return <span className={cn('inline-flex items-center justify-center w-4 h-4 rounded-full shrink-0', cls)} title="">{children}</span>;
}

const VEREDICTO_META = {
  solido:       { label: 'Sólido en lo evaluable',       cls: 'bg-emerald-500/20 border-emerald-400/50 text-emerald-200' },
  con_reservas: { label: 'Fiable con reservas',          cls: 'bg-amber-500/20 border-amber-400/50 text-amber-200' },
  debil:        { label: 'Débil para sus conclusiones',  cls: 'bg-rose-500/20 border-rose-400/50 text-rose-200' },
  insuficiente: { label: 'No evaluable con el documento', cls: 'bg-slate-500/25 border-slate-400/50 text-slate-200' },
} as const;

// ---------------------------------------------------------------------------
// Sub-render v2
// ---------------------------------------------------------------------------
function CriterioRow({ label, criterio, critico }: { label: string; criterio?: Criterio; critico?: boolean }) {
  const nivel = criterio?.nivel ?? 'gris';
  return (
    <div className="py-2.5">
      <p className="text-[13px] font-bold text-slate-700 mb-1 flex items-center gap-1.5 flex-wrap">
        <NivelIcon nivel={nivel} />
        <span>{label}</span>
        {critico && <span className="text-[9px] font-black uppercase tracking-wider text-rose-500 bg-rose-50 border border-rose-200 px-1.5 py-px rounded">crítico</span>}
        {criterio?.regla_automatica && (
          <span
            className="text-[9px] font-bold uppercase bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded"
            title="Nivel impuesto por una regla determinista del sistema (aritmética muestral), no por juicio de la IA."
          >
            ⚙ Regla automática
          </span>
        )}
        <span className={cn('text-[10px] font-semibold', NIVEL_META[nivel].text)}>· {NIVEL_META[nivel].label}</span>
      </p>
      <p className="text-sm text-slate-700 leading-relaxed">{criterio?.analisis || '—'}</p>
      {criterio?.evidencia && criterio.evidencia.trim() && (
        <p className="mt-1 text-xs text-slate-500 italic border-l-2 border-slate-200 pl-2 leading-snug">{criterio.evidencia}</p>
      )}
    </div>
  );
}

function SeccionCard({ def, data }: { def: SeccionDef; data: CriterioMap }) {
  const { Icon } = def;
  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 bg-slate-50 border-b border-slate-200 font-bold text-slate-700 text-sm">
        <Icon className="w-4 h-4 text-[#00558F]" />
        {def.titulo}
      </div>
      <div className="px-4 py-2 bg-white divide-y divide-slate-100">
        {def.criterios.map(c => <CriterioRow key={c.key} label={c.label} criterio={data?.[c.key]} critico={c.critico} />)}
      </div>
    </div>
  );
}

function afirmacionDot(nivel: NivelAfirmacion): string {
  return NIVEL_META[nivel]?.dot ?? 'bg-slate-400';
}

function AuditorV2Result({ result }: { result: AuditResultV2 }) {
  const tipo = result.identificacion_y_tipologia;
  const coh = result.coherencia_datos_conclusiones;
  const ver = result.veredicto_calculado;
  const vMeta = ver ? VEREDICTO_META[ver.nivel] : null;
  const sint = result.sintesis_critica;
  // Misma condición que la regla dura del servidor (applyHardRules), para que
  // el chip y el rojo automático nunca se contradigan.
  const nW = tipo?.n_weird ?? 0;
  const nNW = tipo?.n_no_weird ?? 0;
  const weirdAlerta = tipo?.afirma_generalidad_transcultural === true
    && (nNW === 0 ? nW > 0 : nW / nNW > 2);

  return (
    <div className="space-y-5">
      {/* Cabecera: veredicto calculado + conteos + tipo */}
      <div className="bg-gradient-to-br from-[#00558F] to-[#003a66] text-white rounded-2xl overflow-hidden shadow-lg">
        <div className="p-5 sm:p-6">
          {result.titulo_del_estudio && (
            <p className="text-[#A0CFEB] text-xs font-bold uppercase tracking-widest mb-2 line-clamp-2">{result.titulo_del_estudio}</p>
          )}
          <div className="flex flex-wrap items-center gap-2 mb-3">
            {vMeta && (
              <span className={cn('text-sm font-black px-3 py-1.5 rounded-full border', vMeta.cls)}>{vMeta.label}</span>
            )}
            {tipo?.tipo_de_documento && (
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-white/10 border border-white/20 text-blue-100">{tipo.tipo_de_documento}</span>
            )}
          </div>
          {ver && (
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <ConteoChip n={ver.conteos.verde} label="sin problema" dot="bg-emerald-400" />
              <ConteoChip n={ver.conteos.amarillo} label="cautela" dot="bg-amber-400" />
              <ConteoChip n={ver.conteos.rojo} label="problema" dot="bg-rose-400" />
              <ConteoChip n={ver.conteos.gris} label="no evaluable" dot="bg-slate-300" />
              {ver.conteos.no_aplica > 0 && <ConteoChip n={ver.conteos.no_aplica} label="no aplica" dot="bg-slate-400" />}
            </div>
          )}
          {ver?.regla_aplicada && (
            <p className="text-[11px] text-blue-200/90 italic mb-3">Regla aplicada: {ver.regla_aplicada}</p>
          )}
          <p className="text-sm text-blue-50 leading-relaxed">{result.veredicto_general}</p>
        </div>
        {/* Leyenda de la escala */}
        <div className="bg-white/10 border-t border-white/10 px-5 sm:px-6 py-2.5">
          <p className="text-[11px] text-blue-100 leading-relaxed">
            🟢 sin problema · 🟡 cautela · 🔴 problema · ⚪ <b>no evaluable</b> (el documento no da la información — no es aprobación) · ➖ no aplica a este tipo de documento
          </p>
        </div>
      </div>

      {/* Identificación */}
      {(tipo?.pregunta_o_afirmacion_central || tipo?.poblacion_y_muestra) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {tipo?.pregunta_o_afirmacion_central && (
            <InfoCard label="Pregunta o afirmación central" value={tipo.pregunta_o_afirmacion_central} />
          )}
          {tipo?.poblacion_y_muestra && (
            <InfoCard label="Población y muestra" value={tipo.poblacion_y_muestra} />
          )}
        </div>
      )}
      {/* Composición de la muestra: es lo que alimenta las reglas duras, así
          que se muestra explícito para que el lector pueda comprobarlas. */}
      {(tipo?.subgrupos_analiticos?.length || weirdAlerta) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {!!tipo?.n_total && (
            <span className="text-[11px] font-mono font-bold bg-slate-100 text-slate-600 border border-slate-200 px-2 py-0.5 rounded">n={tipo.n_total}</span>
          )}
          {(tipo?.subgrupos_analiticos || []).map((s, i) => (
            <span key={i} className={cn(
              'text-[11px] font-mono px-2 py-0.5 rounded border',
              s.n > 0 && s.n < 12 ? 'bg-amber-50 text-amber-700 border-amber-200 font-bold' : 'bg-slate-50 text-slate-500 border-slate-200'
            )}>
              {s.etiqueta} n={s.n > 0 ? s.n : '?'}
            </span>
          ))}
          {weirdAlerta && (
            <span
              className="text-[11px] font-mono font-bold bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded"
              title="Conclusiones con pretensión transcultural sobre una muestra predominantemente occidental (Henrich, Heine & Norenzayan 2010)."
            >
              ⚠ WEIRD {tipo?.n_weird ?? 0}:{tipo?.n_no_weird ?? 0}
            </span>
          )}
        </div>
      )}
      {tipo?.adecuacion_del_diseno && (
        <div className="border border-slate-200 rounded-xl px-4 py-2 bg-white">
          <CriterioRow label="Adecuación del diseño a la pregunta" criterio={tipo.adecuacion_del_diseno} />
        </div>
      )}

      {/* Tabla de afirmaciones (la sección estrella) */}
      <div className="border-2 border-[#00558F]/25 rounded-2xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 bg-[#00558F]/8 border-b border-[#00558F]/15">
          <ListChecks className="w-4 h-4 text-[#00558F]" />
          <span className="font-black text-[#00558F] text-sm uppercase tracking-wider">¿Los datos soportan las conclusiones?</span>
        </div>
        <div className="divide-y divide-slate-100 bg-white">
          {(coh?.afirmaciones || []).map((a, i) => (
            <div key={i} className="p-4">
              <div className="flex items-start gap-2.5">
                <span className={cn('mt-1.5 w-2.5 h-2.5 rounded-full shrink-0', afirmacionDot(a.nivel))} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-800 leading-snug">
                    {a.es_central && (
                      <span className="mr-1.5 text-[9px] font-black uppercase tracking-wider text-[#00558F] bg-[#00558F]/10 border border-[#00558F]/20 px-1.5 py-px rounded align-middle">
                        central
                      </span>
                    )}
                    {a.afirmacion}
                  </p>
                  <p className="text-xs text-slate-600 leading-relaxed mt-1">
                    <span className="font-bold text-slate-400 uppercase tracking-wider text-[10px]">Soporte en los datos: </span>
                    {a.soporte_en_los_datos}
                  </p>
                  {/* Dónde toca el suelo la evidencia: lo ámbar es lo que el
                      servidor castiga solo (circularidad / lavado de citas). */}
                  {a.anclaje_de_la_evidencia && ANCLAJE_LABEL[a.anclaje_de_la_evidencia] && (
                    <span
                      className={cn(
                        'inline-block mt-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded border',
                        ANCLAJE_LABEL[a.anclaje_de_la_evidencia].alerta
                          ? 'bg-amber-50 text-amber-700 border-amber-200'
                          : 'bg-slate-50 text-slate-500 border-slate-200'
                      )}
                      title="De dónde proviene, en última instancia, el respaldo de esta afirmación."
                    >
                      {ANCLAJE_LABEL[a.anclaje_de_la_evidencia].alerta ? '⚠ ' : ''}
                      {ANCLAJE_LABEL[a.anclaje_de_la_evidencia].texto}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
          {(!coh?.afirmaciones || coh.afirmaciones.length === 0) && (
            <p className="p-4 text-sm text-slate-400">No se extrajeron afirmaciones.</p>
          )}
        </div>
        <div className="px-4 py-2 bg-white border-t border-slate-100 divide-y divide-slate-100">
          <CriterioRow label="Coherencia global datos ↔ conclusiones" criterio={coh?.coherencia_global_datos_conclusiones} critico />
          <CriterioRow label="Spin y énfasis" criterio={coh?.spin_y_enfasis} />
        </div>
      </div>

      {/* Secciones de criterios (config-driven) */}
      {AUDIT_SECTIONS.map(def => (
        <SeccionCard key={def.key as string} def={def} data={result[def.key] as CriterioMap} />
      ))}

      {/* Criterios propios del diseño: los exige el tipo de estudio concreto
          (un cualitativo no se audita con la vara de un ensayo clínico). */}
      {!!result.criterios_del_diseno?.length && (
        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 bg-slate-50 border-b border-slate-200 font-bold text-slate-700 text-sm">
            <ListChecks className="w-4 h-4 text-[#00558F]" />
            Criterios propios de este diseño
            <span className="ml-auto text-[10px] font-mono font-normal text-slate-400 uppercase tracking-wider">
              {result.criterios_del_diseno[0]?.familia?.replace(/_/g, ' ')}
            </span>
          </div>
          <div className="px-4 py-2 bg-white divide-y divide-slate-100">
            {result.criterios_del_diseno.map((c, i) => (
              <CriterioRow key={i} label={c.nombre} criterio={c} />
            ))}
          </div>
        </div>
      )}

      {/* Síntesis crítica — declarativa, SIN recomendaciones */}
      <div className="border-2 border-slate-300 rounded-2xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 bg-slate-100 border-b border-slate-200">
          <ScrollText className="w-4 h-4 text-slate-600" />
          <span className="font-black text-slate-700 text-sm uppercase tracking-wider">Síntesis crítica</span>
        </div>
        <div className="px-4 py-4 bg-white space-y-3">
          <SintCard Icon={Target} accent="emerald" label="Lo que dicen los datos" value={sint?.lo_que_dicen_los_datos} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <SintCard Icon={Check} accent="emerald" label="Lo que el estudio SÍ soporta" value={sint?.lo_que_el_estudio_si_soporta} />
            <SintCard Icon={X} accent="rose" label="Lo que el estudio NO soporta" value={sint?.lo_que_el_estudio_no_soporta} />
          </div>
          <SintCard Icon={ShieldAlert} accent="amber" label="Precauciones de lectura" value={sint?.precauciones_de_lectura} />
          <SintCard Icon={HelpCircle} accent="slate" label="Incertidumbres abiertas" value={sint?.incertidumbres_abiertas} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <SintCard Icon={BookOpen} accent="slate" label="Conceptos para profundizar" value={sint?.conceptos_para_profundizar} />
            <SintCard Icon={Lightbulb} accent="slate" label="Preguntas para el lector" value={sint?.preguntas_para_el_lector} />
          </div>
        </div>
      </div>
    </div>
  );
}

function ConteoChip({ n, label, dot }: { n: number; label: string; dot: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-50 bg-white/10 border border-white/15 rounded-full px-2.5 py-1">
      <span className={cn('w-2 h-2 rounded-full', dot)} /> {n} {label}
    </span>
  );
}
function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-slate-50 rounded-xl p-3 border border-slate-200">
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">{label}</p>
      <p className="text-sm text-slate-700 leading-relaxed">{value}</p>
    </div>
  );
}
function SintCard({ Icon, accent, label, value }: { Icon: any; accent: 'emerald' | 'rose' | 'amber' | 'slate'; label: string; value?: string }) {
  const a = {
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    rose: 'bg-rose-50 border-rose-200 text-rose-700',
    amber: 'bg-amber-50 border-amber-200 text-amber-700',
    slate: 'bg-slate-50 border-slate-200 text-slate-600',
  }[accent];
  return (
    <div className={cn('rounded-xl p-3 border', a)}>
      <p className="text-[10px] font-black uppercase tracking-wider mb-1 flex items-center gap-1.5"><Icon className="w-3.5 h-3.5" /> {label}</p>
      <p className="text-sm text-slate-700 leading-relaxed">{value || '—'}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Legacy (schema v1): render mínimo pero completo de resultados guardados viejos
// ---------------------------------------------------------------------------
interface AuditResultLegacy {
  titulo_del_estudio?: string;
  veredicto_general?: string;
  nivel_credibilidad?: string;
  [k: string]: any;
}
function LegacyField({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">{label}</p>
      <p className="text-slate-700 leading-relaxed text-sm">{value}</p>
    </div>
  );
}
function AuditorLegacyResult({ result }: { result: AuditResultLegacy }) {
  const epi = result.auditoria_epistemologica || {};
  const teo = result.diseccion_teorica_y_conceptual || {};
  const met = result.escrutinio_metodologico_y_estadistico || {};
  const ses = result.auditoria_de_sesgos_y_datos_faltantes || {};
  const flags = result.detector_de_cientificismo_y_banderas_rojas || {};
  const sint = result.sintesis_para_el_pensamiento_critico || {};
  const guia = result.guia_de_aprendizaje || {};
  return (
    <div className="space-y-4">
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800">
        Análisis con el formato anterior. Vuelve a auditar para el nuevo marco (semáforo de 5 estados, tabla de afirmaciones y auditoría bibliográfica).
      </div>
      <div className="bg-gradient-to-br from-[#00558F] to-[#003a66] text-white rounded-2xl p-5">
        {result.titulo_del_estudio && <p className="text-[#A0CFEB] text-xs font-bold uppercase tracking-widest mb-2">{result.titulo_del_estudio}</p>}
        <p className="text-sm text-blue-50 leading-relaxed">{result.veredicto_general}</p>
        {result.nivel_credibilidad && <p className="mt-2 text-xs text-blue-200">Credibilidad: {result.nivel_credibilidad}</p>}
      </div>
      <div className="border border-slate-200 rounded-xl p-4 bg-white space-y-3">
        <LegacyField label="La realidad de los datos" value={sint.la_realidad_de_los_datos_crudos} />
        <LegacyField label="Traducción al mundo real" value={sint.traduccion_de_la_incertidumbre_al_mundo_real} />
        <LegacyField label="Brecha causal y extrapolación" value={flags.brecha_causal_y_extrapolacion} />
        <LegacyField label="Cherry-picking contextual" value={flags.cherry_picking_contextual} />
        <LegacyField label="Opacidad para refutación" value={flags.opacidad_para_refutacion} />
        <LegacyField label="Adecuación de controles" value={met.adecuacion_y_omision_de_controles} />
        <LegacyField label="Robustez y relevancia real" value={met.robustez_y_relevancia_real} />
        <LegacyField label="Rastros de p-hacking" value={met.rastros_de_p_hacking} />
        <LegacyField label="Falsabilidad" value={teo.falsabilidad_y_riesgo_popperiano} />
        <LegacyField label="Validez de constructo" value={teo.brecha_de_validez_de_constructo} />
        <LegacyField label="Hipótesis ad hoc" value={teo.hipotesis_ad_hoc_lakatosianas} />
        <LegacyField label="Sesgo de reporte interno" value={ses.sesgo_de_reporte_interno} />
        <LegacyField label="Alineación de incentivos" value={ses.alineacion_de_incentivos} />
        <LegacyField label="Corroboración objetiva" value={epi.grado_de_corroboracion_objetiva} />
        <LegacyField label="Qué aprender" value={guia.que_aprender_de_este_documento} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Export markdown
// ---------------------------------------------------------------------------
function buildMarkdownV2(r: AuditResultV2): string {
  const em = (n?: NivelCriterio) => (n && NIVEL_META[n] ? NIVEL_META[n].emoji : '⚪');
  const crit = (m: CriterioMap | undefined, key: string, label: string) => {
    const c = m?.[key];
    return `- ${em(c?.nivel)} **${label}:** ${c?.analisis || '—'}${c?.evidencia ? `\n  > ${c.evidencia}` : ''}`;
  };
  const ver = r.veredicto_calculado;
  const lines: string[] = [];
  lines.push(`# Auditoría Científica: ${r.titulo_del_estudio || ''}`);
  if (ver) {
    lines.push(`\n**Veredicto:** ${VEREDICTO_META[ver.nivel]?.label ?? ver.nivel}`);
    lines.push(`> ${ver.conteos.verde}🟢 · ${ver.conteos.amarillo}🟡 · ${ver.conteos.rojo}🔴 · ${ver.conteos.gris}⚪ · ${ver.conteos.no_aplica}➖ — ${ver.regla_aplicada}`);
  }
  lines.push(`\n${r.veredicto_general}`);
  const t = r.identificacion_y_tipologia;
  lines.push(`\n## Identificación\n- **Tipo:** ${t?.tipo_de_documento || '—'}\n- **Pregunta central:** ${t?.pregunta_o_afirmacion_central || '—'}\n- **Población/muestra:** ${t?.poblacion_y_muestra || '—'}`);
  lines.push(crit({ x: t?.adecuacion_del_diseno } as any, 'x', 'Adecuación del diseño'));
  if (t?.subgrupos_analiticos?.length) {
    lines.push(`- **Subgrupos:** ${t.subgrupos_analiticos.map(s => `${s.etiqueta} n=${s.n > 0 ? s.n : '?'}`).join(' · ')}`);
  }
  lines.push(`\n## ¿Los datos soportan las conclusiones?`);
  for (const a of r.coherencia_datos_conclusiones?.afirmaciones || []) {
    const central = a.es_central ? '**[CENTRAL]** ' : '';
    const anclaje = a.anclaje_de_la_evidencia && ANCLAJE_LABEL[a.anclaje_de_la_evidencia]
      ? `\n  > Anclaje: ${ANCLAJE_LABEL[a.anclaje_de_la_evidencia].alerta ? '⚠ ' : ''}${ANCLAJE_LABEL[a.anclaje_de_la_evidencia].texto}`
      : '';
    lines.push(`- ${em(a.nivel as NivelCriterio)} ${central}**${a.afirmacion}**\n  > Soporte: ${a.soporte_en_los_datos}${anclaje}`);
  }
  lines.push(crit(r.coherencia_datos_conclusiones as any, 'coherencia_global_datos_conclusiones', 'Coherencia global'));
  lines.push(crit(r.coherencia_datos_conclusiones as any, 'spin_y_enfasis', 'Spin y énfasis'));
  for (const def of AUDIT_SECTIONS) {
    lines.push(`\n## ${def.titulo}`);
    for (const c of def.criterios) lines.push(crit(r[def.key] as CriterioMap, c.key, c.label));
  }
  if (r.criterios_del_diseno?.length) {
    lines.push(`\n## Criterios propios de este diseño (${r.criterios_del_diseno[0]?.familia?.replace(/_/g, ' ') || ''})`);
    for (const c of r.criterios_del_diseno) {
      lines.push(`- ${em(c.nivel)} **${c.nombre}:** ${c.analisis || '—'}${c.evidencia ? `\n  > ${c.evidencia}` : ''}`);
    }
  }
  const s = r.sintesis_critica;
  lines.push(`\n## Síntesis crítica`);
  lines.push(`**Lo que dicen los datos:** ${s?.lo_que_dicen_los_datos || '—'}`);
  lines.push(`\n**Lo que el estudio SÍ soporta:** ${s?.lo_que_el_estudio_si_soporta || '—'}`);
  lines.push(`\n**Lo que el estudio NO soporta:** ${s?.lo_que_el_estudio_no_soporta || '—'}`);
  lines.push(`\n**Precauciones de lectura:** ${s?.precauciones_de_lectura || '—'}`);
  lines.push(`\n**Incertidumbres abiertas:** ${s?.incertidumbres_abiertas || '—'}`);
  lines.push(`\n**Conceptos para profundizar:** ${s?.conceptos_para_profundizar || '—'}`);
  lines.push(`\n**Preguntas para el lector:** ${s?.preguntas_para_el_lector || '—'}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------
interface AuditorPanelProps { item: BookItem; onClose: () => void }

function isV2(r: any): r is AuditResultV2 {
  return !!r && r.schema_version === 2;
}

export function AuditorPanel({ item, onClose }: AuditorPanelProps) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [speakingError, setSpeakingError] = useState(false);
  const [speakingResult, setSpeakingResult] = useState(false);

  const fileName = item.source?.replace('/api/files/', '') ?? '';

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/documents/${item.id}/settings`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => { if (!cancelled && d.settings?.auditResult) setResult(d.settings.auditResult); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [item.id]);

  const saveAuditResult = async (auditResult: any | null) => {
    try {
      await fetch(`/api/documents/${item.id}/settings`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auditResult }),
      });
    } catch (e) { console.error('No se pudo guardar la auditoría:', e); }
  };

  const handleAudit = async () => {
    setLoading(true); setError(null); setResult(null);
    try {
      const res = await fetch('/api/audit-resource', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'include', body: JSON.stringify({ fileName }),
      });
      const text = await res.text();
      let data: any;
      try { data = JSON.parse(text); } catch { throw new Error(`Respuesta inesperada del servidor: ${text.slice(0, 200)}`); }
      // El servidor manda `details` con el mensaje real (p.ej. el error crudo
      // de la API de Gemini) además de `error` (genérico, para mostrar en la
      // UI); antes se descartaba `details` y el usuario nunca veía la causa.
      if (!res.ok) throw new Error(data.details ? `${data.error} — ${data.details}` : (data.error || `Error ${res.status}`));
      setResult(data.result);
      saveAuditResult(data.result);
    } catch (e: any) {
      setError(e.message || 'Error desconocido.');
    } finally { setLoading(false); }
  };

  const canExport = result && isV2(result);
  const handleCopy = () => {
    if (!canExport) return;
    navigator.clipboard.writeText(buildMarkdownV2(result));
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };
  const handleExport = (format: 'pdf' | 'docx') => {
    if (!canExport) return;
    setShowExportMenu(false);
    const md = buildMarkdownV2(result);
    const title = `Auditoría Científica - ${result.titulo_del_estudio || item.title}`;
    if (format === 'pdf') exportToPrintPdf(title, md);
    else exportToDocx(`Auditoria_Cientifica_${item.id}.docx`, md);
  };

  const handleSpeakError = () => {
    if (speakingError) {
      window.speechSynthesis.cancel();
      setSpeakingError(false);
      return;
    }
    if (!error) return;
    setSpeakingError(true);
    const utterance = new SpeechSynthesisUtterance(error);
    utterance.lang = 'es-ES';
    utterance.onend = () => setSpeakingError(false);
    window.speechSynthesis.speak(utterance);
  };

  const handleSpeakResult = () => {
    if (speakingResult) {
      window.speechSynthesis.cancel();
      setSpeakingResult(false);
      return;
    }
    if (!result) return;
    setSpeakingResult(true);
    const text = result.veredicto_general || 'Resultado de auditoría disponible';
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'es-ES';
    utterance.onend = () => setSpeakingResult(false);
    window.speechSynthesis.speak(utterance);
  };

  return (
    <div className="flex flex-col min-h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-slate-200 shrink-0 sticky top-0 bg-white z-10 shadow-sm">
        <div className="flex items-center gap-2">
          <FlaskConical className="w-5 h-5 text-[#00558F]" />
          <h2 className="font-bold text-slate-800 text-base">Auditoría Científica</h2>
        </div>
        <div className="flex items-center gap-2">
          {canExport && (
            <button onClick={handleCopy} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-200 bg-white text-slate-600 hover:text-[#00558F] hover:border-[#00558F]/30 rounded-lg transition-colors shadow-sm" title="Copiar análisis">
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">{copied ? 'Copiado' : 'Copiar'}</span>
            </button>
          )}
          {canExport && (
            <div className="relative">
              <button onClick={() => setShowExportMenu(p => !p)} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-200 bg-white text-slate-600 hover:text-[#00558F] hover:border-[#00558F]/30 rounded-lg transition-colors shadow-sm" title="Exportar análisis">
                <Download className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Exportar</span>
              </button>
              {showExportMenu && (
                <div className="absolute right-0 top-10 z-50 w-56 bg-white border border-slate-200/90 shadow-2xl rounded-2xl p-2 flex flex-col gap-1" onMouseLeave={() => setShowExportMenu(false)}>
                  <button onClick={() => handleExport('docx')} className="w-full text-left text-xs font-semibold text-slate-700 hover:text-[#00558F] hover:bg-slate-50 p-2.5 rounded-xl transition-colors flex items-center gap-2.5">
                    <FileSpreadsheet className="w-4 h-4 text-emerald-600" /> <span>Descargar Word (.docx)</span>
                  </button>
                  <button onClick={() => handleExport('pdf')} className="w-full text-left text-xs font-semibold text-slate-700 hover:text-[#00558F] hover:bg-slate-50 p-2.5 rounded-xl transition-colors flex items-center gap-2.5">
                    <Printer className="w-4 h-4 text-rose-500" /> <span>Descargar / Imprimir PDF</span>
                  </button>
                </div>
              )}
            </div>
          )}
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="px-4 sm:px-6 py-5 space-y-5 max-w-3xl mx-auto w-full pb-10">
        <div className="bg-slate-50 rounded-xl p-3 border border-slate-200">
          <p className="text-xs text-slate-500 font-medium mb-0.5">Documento</p>
          <p className="font-semibold text-slate-800 text-sm line-clamp-2">{item.title}</p>
          {item.author && <p className="text-xs text-[#00558F] mt-0.5">{item.author}</p>}
        </div>

        {!result && !loading && (
          <div className="flex flex-col items-center gap-4 py-10">
            <div className="w-16 h-16 rounded-2xl bg-[#00558F]/10 flex items-center justify-center">
              <Microscope className="w-8 h-8 text-[#00558F]" />
            </div>
            <div className="text-center space-y-1 max-w-md">
              <p className="font-semibold text-slate-700">Auditoría epistemológica del documento</p>
              <p className="text-sm text-slate-500">
                Se evalúa si los datos soportan las conclusiones, el rigor metodológico y estadístico, sesgos e incentivos, la retórica, la bibliografía y la transparencia — con un semáforo honesto de 5 estados. No da recomendaciones: el criterio final es tuyo.
              </p>
            </div>
            <button onClick={handleAudit} className="flex items-center gap-2 px-6 py-3 bg-[#00558F] hover:bg-[#004270] text-white font-semibold rounded-xl shadow-md transition-all hover:-translate-y-0.5 active:scale-95">
              <FlaskConical className="w-5 h-5" /> Iniciar Auditoría
            </button>
            <p className="text-xs text-slate-400">Puede tardar 30–90 segundos</p>
          </div>
        )}

        {loading && (
          <div className="flex flex-col items-center gap-5 py-16">
            <div className="relative">
              <div className="w-16 h-16 border-4 border-slate-100 rounded-full" />
              <div className="w-16 h-16 border-4 border-[#00558F] rounded-full border-t-transparent animate-spin absolute top-0 left-0" />
            </div>
            <div className="text-center space-y-1">
              <p className="text-slate-700 font-semibold">Auditando el documento…</p>
              <p className="text-xs text-slate-400 max-w-xs text-center">Contrastando afirmaciones con datos, midiendo rigor, sesgos, retórica y bibliografía</p>
            </div>
          </div>
        )}

        {error && !loading && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">
            <p className="font-semibold mb-1">Error al auditar</p>
            <p>{error}</p>
            <div className="flex gap-2 mt-3">
              <button onClick={handleAudit} className="text-xs underline text-red-600">Reintentar</button>
              <button onClick={handleSpeakError} className="flex items-center gap-1.5 text-xs underline text-red-600 hover:text-red-700 transition-colors">
                {speakingError ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                {speakingError ? 'Pausar' : 'Leer'}
              </button>
            </div>
          </div>
        )}

        {result && !loading && (
          <>
            {isV2(result) ? <AuditorV2Result result={result} /> : <AuditorLegacyResult result={result} />}
            <div className="flex gap-2">
              <button onClick={handleAudit} className="flex-1 py-3 text-sm text-slate-500 hover:text-[#00558F] border border-slate-200 hover:border-[#00558F]/30 rounded-xl transition-colors font-medium">
                Volver a auditar
              </button>
              <button onClick={handleSpeakResult} className="px-4 py-3 text-sm text-slate-500 hover:text-[#00558F] border border-slate-200 hover:border-[#00558F]/30 rounded-xl transition-colors font-medium flex items-center gap-2 shrink-0" title="Leer veredicto">
                {speakingResult ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
