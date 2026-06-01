import { Copy, Check, Download, ShieldAlert, Target, Search, AlertCircle, Shield, EyeOff, Activity, FileWarning, Microscope } from 'lucide-react';
import { useState } from 'react';
import { motion } from 'motion/react';
import type { ScientificReview } from '../types';

interface SummaryResultProps {
  content: ScientificReview;
}

export function SummaryResult({ content }: SummaryResultProps) {
  const [copied, setCopied] = useState(false);

  const getMarkdownOutput = () => {
    return `# Auditoría Científica y Disección Metodológica

## Síntesis Crítica
**La Realidad de los Datos Crudos:** ${content.sintesis_para_el_pensamiento_critico.la_realidad_de_los_datos_crudos}
**Traducción al Mundo Real:** ${content.sintesis_para_el_pensamiento_critico.traduccion_de_la_incertidumbre_al_mundo_real}

## Auditoría Epistemológica
**Grado de Corroboración:** ${content.auditoria_epistemologica.grado_de_corroboracion_objetiva}
**Infradeterminación:** ${content.auditoria_epistemologica.infradeterminacion_explicaciones_alternativas}

## Disección Teórica y Conceptual
**Falsabilidad:** ${content.diseccion_teorica_y_conceptual.falsabilidad_y_riesgo_popperiano}
**Validez de Constructo:** ${content.diseccion_teorica_y_conceptual.brecha_de_validez_de_constructo}
**Hipótesis Ad Hoc:** ${content.diseccion_teorica_y_conceptual.hipotesis_ad_hoc_lakatosianas}

## Escrutinio Metodológico
**Controles:** ${content.escrutinio_metodologico_y_estadistico.adecuacion_y_omision_de_controles}
**Robustez:** ${content.escrutinio_metodologico_y_estadistico.robustez_y_relevancia_real}
**P-Hacking:** ${content.escrutinio_metodologico_y_estadistico.rastros_de_p_hacking}

## Sesgos y Datos Faltantes
**Sesgo Interno:** ${content.auditoria_de_sesgos_y_datos_faltantes.sesgo_de_reporte_interno}
**Incentivos:** ${content.auditoria_de_sesgos_y_datos_faltantes.alineacion_de_incentivos}

## Banderas Rojas y Cientificismo
**Brecha Causal:** ${content.detector_de_cientificismo_y_banderas_rojas.brecha_causal_y_extrapolacion}
**Cherry-Picking:** ${content.detector_de_cientificismo_y_banderas_rojas.cherry_picking_contextual}
**Opacidad:** ${content.detector_de_cientificismo_y_banderas_rojas.opacidad_para_refutacion}
`;
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(getMarkdownOutput());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([getMarkdownOutput()], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'analisis_cientifico.md';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const corroborationText = content.auditoria_epistemologica.grado_de_corroboracion_objetiva;
  const corroborationLower = corroborationText.toLowerCase();
  let statusLevel: 'alta' | 'moderada' | 'baja' = 'moderada';
  if (corroborationLower.includes('baja')) statusLevel = 'baja';
  if (corroborationLower.includes('alta')) statusLevel = 'alta';

  return (
    <div className="space-y-8 font-sans">
      <div className="flex justify-end gap-2">
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 rounded transition-colors shadow-sm"
        >
          {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
          <span className="hidden sm:inline">{copied ? 'Copiado' : 'Copiar Texto'}</span>
        </button>
        <button
          onClick={handleDownload}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 rounded transition-colors shadow-sm"
        >
          <Download className="w-4 h-4" />
          <span className="hidden sm:inline">Descargar .md</span>
        </button>
      </div>

      {/* Hero: La realidad de los datos crudos */}
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="bg-indigo-600 dark:bg-indigo-700 text-white p-8 sm:p-10 rounded-2xl shadow-lg relative overflow-hidden">
         <div className="absolute top-0 right-0 p-8 opacity-10">
           <Microscope className="w-48 h-48 sm:w-64 sm:h-64" />
         </div>
         <div className="relative z-10">
           <h2 className="text-indigo-200 font-bold tracking-widest uppercase text-xs sm:text-sm mb-4 flex items-center gap-2">
              <Target className="w-4 h-4" /> La Realidad de los Datos Crudos
           </h2>
           <p className="text-2xl sm:text-3xl lg:text-4xl font-black leading-tight mb-8">
              {content.sintesis_para_el_pensamiento_critico.la_realidad_de_los_datos_crudos}
           </p>
           <div className="bg-indigo-900/40 dark:bg-slate-900/40 backdrop-blur-sm p-5 rounded-xl border border-indigo-500/30">
              <h3 className="text-indigo-300 font-bold uppercase tracking-widest text-xs mb-2">Traducción al mundo real</h3>
              <p className="font-medium text-lg text-indigo-50 leading-relaxed">
                {content.sintesis_para_el_pensamiento_critico.traduccion_de_la_incertidumbre_al_mundo_real}
              </p>
           </div>
         </div>
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
         {/* Semáforo de Corroboración */}
         <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="col-span-1 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-2xl p-6 sm:p-8 flex flex-col items-center justify-center relative shadow-sm">
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-6 text-center">Grado de Corroboración<br/>Objetiva</h3>
            <div className="bg-slate-900 dark:bg-slate-950 p-4 rounded-full border border-slate-800 flex flex-col gap-3 shadow-inner mt-2 mb-6">
               <div className={`w-12 h-12 rounded-full border-2 ${statusLevel === 'alta' ? 'bg-emerald-500 border-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.8)] scale-110' : 'bg-emerald-950 border-emerald-900/50 opacity-30'} transition-all duration-500`} />
               <div className={`w-12 h-12 rounded-full border-2 ${statusLevel === 'moderada' ? 'bg-amber-400 border-amber-300 shadow-[0_0_20px_rgba(251,191,36,0.8)] scale-110' : 'bg-amber-950 border-amber-900/50 opacity-30'} transition-all duration-500`} />
               <div className={`w-12 h-12 rounded-full border-2 ${statusLevel === 'baja' ? 'bg-rose-500 border-rose-400 shadow-[0_0_20px_rgba(225,29,72,0.8)] scale-110' : 'bg-rose-950 border-rose-900/50 opacity-30'} transition-all duration-500`} />
            </div>
            <p className="text-center font-bold text-slate-800 dark:text-slate-100 text-lg uppercase tracking-wider mb-2">
              {statusLevel === 'alta' ? 'Alta' : statusLevel === 'moderada' ? 'Moderada' : 'Baja'}
            </p>
            <p className="text-center font-medium text-slate-500 dark:text-slate-400 text-sm leading-relaxed">
              {corroborationText}
            </p>
         </motion.div>

         {/* Escrutinio Metodológico */}
         <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="col-span-1 lg:col-span-2 flex flex-col gap-4">
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm rounded-2xl p-6 sm:p-8 h-full">
               <h3 className="text-slate-800 dark:text-slate-100 font-black uppercase tracking-widest text-sm flex items-center gap-2 mb-8">
                 <Activity className="w-5 h-5 text-indigo-500" />
                 Escrutinio Metodológico y Estadístico
               </h3>
               
               <div className="space-y-8">
                 <div className="flex gap-4">
                   <div className="w-10 h-10 shrink-0 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-black rounded-lg">C</div>
                   <div>
                     <h4 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1.5">Adecuación de Controles</h4>
                     <p className="font-medium text-slate-800 dark:text-slate-200 text-base leading-relaxed">
                        {content.escrutinio_metodologico_y_estadistico.adecuacion_y_omision_de_controles}
                     </p>
                   </div>
                 </div>
                 
                 <div className="h-px bg-slate-100 dark:bg-slate-800/50 w-full" />
                 
                 <div className="flex gap-4">
                   <div className="w-10 h-10 shrink-0 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-black rounded-lg">R</div>
                   <div>
                     <h4 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1.5">Robustez y Relevancia</h4>
                     <p className="text-slate-700 dark:text-slate-300font-medium text-base leading-relaxed">
                        {content.escrutinio_metodologico_y_estadistico.robustez_y_relevancia_real}
                     </p>
                   </div>
                 </div>

                 <div className="h-px bg-slate-100 dark:bg-slate-800/50 w-full" />
                 
                 <div className="flex gap-4">
                   <div className="w-10 h-10 shrink-0 bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-500 flex items-center justify-center font-black rounded-lg"><Search className="w-5 h-5" /></div>
                   <div>
                     <h4 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1.5">Rastros de P-Hacking</h4>
                     <p className="text-slate-800 dark:text-slate-200 font-bold bg-amber-100/50 dark:bg-amber-900/20 p-4 rounded-xl border border-amber-200 dark:border-amber-800/50">
                       {content.escrutinio_metodologico_y_estadistico.rastros_de_p_hacking}
                     </p>
                   </div>
                 </div>
               </div>
            </div>
         </motion.div>
      </div>

      {/* Banderas Rojas y Opacidad */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="bg-rose-50 dark:bg-rose-950/20 border-2 border-rose-200 dark:border-rose-900/50 rounded-2xl p-6 sm:p-10 relative overflow-hidden">
         <div className="absolute top-0 right-0 p-4 opacity-5">
            <ShieldAlert className="w-32 h-32 text-rose-900" />
         </div>
         <h3 className="text-rose-700 dark:text-rose-400 font-black uppercase tracking-widest text-sm flex items-center gap-2 mb-8 relative z-10">
            <ShieldAlert className="w-5 h-5" />
            Detector de Cientificismo y Banderas Rojas
         </h3>
         
         <div className="grid grid-cols-1 md:grid-cols-3 gap-6 relative z-10">
            <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm p-6 rounded-xl border border-rose-100 dark:border-rose-900/30 shadow-sm transition-transform hover:-translate-y-1 duration-300">
               <h4 className="text-xs font-bold text-rose-800 dark:text-rose-300 uppercase tracking-wider mb-3 pb-3 border-b border-rose-100 dark:border-rose-900/50">Brecha Causal</h4>
               <p className="text-sm text-slate-800 dark:text-slate-200 font-bold leading-relaxed">
                  {content.detector_de_cientificismo_y_banderas_rojas.brecha_causal_y_extrapolacion}
               </p>
            </div>
            <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm p-6 rounded-xl border border-rose-100 dark:border-rose-900/30 shadow-sm transition-transform hover:-translate-y-1 duration-300">
               <h4 className="text-xs font-bold text-rose-800 dark:text-rose-300 uppercase tracking-wider mb-3 pb-3 border-b border-rose-100 dark:border-rose-900/50">Cherry-Picking</h4>
               <p className="text-sm text-slate-800 dark:text-slate-200 font-bold leading-relaxed">
                  {content.detector_de_cientificismo_y_banderas_rojas.cherry_picking_contextual}
               </p>
            </div>
            <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm p-6 rounded-xl border border-rose-100 dark:border-rose-900/30 shadow-sm transition-transform hover:-translate-y-1 duration-300">
               <h4 className="text-xs font-bold text-rose-800 dark:text-rose-300 uppercase tracking-wider mb-3 pb-3 border-b border-rose-100 dark:border-rose-900/50">Opacidad</h4>
               <p className="text-sm text-slate-800 dark:text-slate-200 font-bold leading-relaxed">
                  {content.detector_de_cientificismo_y_banderas_rojas.opacidad_para_refutacion}
               </p>
            </div>
         </div>
      </motion.div>

      {/* Disección Teórica & Sesgos Layout Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
         {/* Disección Teórica */}
         <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm rounded-2xl p-6 sm:p-8">
            <h3 className="text-slate-800 dark:text-slate-100 font-black uppercase tracking-widest text-sm flex items-center gap-2 mb-8">
               <Shield className="w-5 h-5 text-indigo-500" />
               Disección Teórica y Conceptual
            </h3>
            <ul className="space-y-8">
               <li>
                  <h4 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1.5">Falsabilidad (Riesgo Popperiano)</h4>
                  <p className="font-medium text-slate-800 dark:text-slate-200 border-l-4 border-indigo-500 pl-4 py-1.5">{content.diseccion_teorica_y_conceptual.falsabilidad_y_riesgo_popperiano}</p>
               </li>
               <div className="h-px w-full bg-slate-100 dark:bg-slate-700/50" />
               <li>
                  <h4 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1.5">Brecha de Validez de Constructo</h4>
                  <p className="font-medium text-slate-800 dark:text-slate-200 border-l-4 border-indigo-500 pl-4 py-1.5">{content.diseccion_teorica_y_conceptual.brecha_de_validez_de_constructo}</p>
               </li>
               <div className="h-px w-full bg-slate-100 dark:bg-slate-700/50" />
               <li className="bg-slate-50 dark:bg-slate-900/50 p-4 rounded-xl border border-slate-200 dark:border-slate-700/50">
                  <h4 className="text-xs font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-widest mb-2 flex items-center gap-2">Hipótesis Ad Hoc (Lakatosianas)</h4>
                  <p className="font-bold text-slate-700 dark:text-slate-300 italic text-sm">"{content.diseccion_teorica_y_conceptual.hipotesis_ad_hoc_lakatosianas}"</p>
               </li>
            </ul>
         </motion.div>

         {/* Auditoria de Sesgos */}
         <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }} className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 shadow-sm rounded-2xl p-6 sm:p-8 flex flex-col gap-6">
            <h3 className="text-slate-800 dark:text-slate-100 font-black uppercase tracking-widest text-sm flex items-center gap-2 mb-2">
               <EyeOff className="w-5 h-5 text-slate-500" />
               Auditoría de Sesgos y Datos Faltantes
            </h3>
            
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-6 shadow-sm hover:border-slate-300 dark:hover:border-slate-600 transition-colors">
               <h4 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-3 flex items-center gap-2"><FileWarning className="w-4 h-4 text-amber-500" /> Sesgo de Reporte Interno</h4>
               <p className="text-base text-slate-800 dark:text-slate-200 font-bold leading-relaxed">
                  {content.auditoria_de_sesgos_y_datos_faltantes.sesgo_de_reporte_interno}
               </p>
            </div>
            
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-6 shadow-sm hover:border-slate-300 dark:hover:border-slate-600 transition-colors">
               <h4 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-3 flex items-center gap-2"><AlertCircle className="w-4 h-4 text-indigo-500" /> Alineación de Incentivos</h4>
               <p className="text-base text-slate-800 dark:text-slate-200 font-bold leading-relaxed">
                  {content.auditoria_de_sesgos_y_datos_faltantes.alineacion_de_incentivos}
               </p>
            </div>
            
            <div className="mt-auto pt-6 border-t font-medium border-slate-200 dark:border-slate-700">
                <h4 className="text-xs font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-widest mb-3">Infradeterminación (Explicaciones Alternativas)</h4>
                <div className="bg-indigo-100 dark:bg-indigo-900/30 p-4 rounded-xl border border-indigo-200 dark:border-indigo-800 text-sm text-indigo-900 dark:text-indigo-200 leading-relaxed font-bold">
                  {content.auditoria_epistemologica.infradeterminacion_explicaciones_alternativas}
                </div>
            </div>
         </motion.div>
      </div>

    </div>
  );
}
