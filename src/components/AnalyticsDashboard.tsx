import React, { useMemo, useState, useEffect } from 'react';
import { useLibrary } from '../hooks/useLibrary';
import { getReadingTimeLog } from '../hooks/useReadingTime';
import { formatMinutes } from '../lib/utils';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid, PieChart, Pie, Cell, Legend } from 'recharts';
import { BookOpen, TrendingUp, Layers, Clock, Book, Laptop, Tag as TagIcon, FileType, Timer } from 'lucide-react';

// Paleta para gráficos de pastel/distribución — coherente con los acentos usados en el resto de la UI.
const PIE_COLORS = ['#00558F', '#FFA300', '#10b981', '#ef4444', '#8b5cf6', '#f59e0b', '#06b6d4', '#ec4899', '#64748b'];

// Insignia circular de ícono para las tarjetas de estadísticas. Usa
// color-mix sobre el color de acento para generar el fondo, en vez de
// clases Tailwind fijas (bg-emerald-100/dark:bg-emerald-950) que no se
// adaptan a los temas personalizados de la app (sunset, purple, hc, etc.)
// y terminaban viéndose como un bloque gris que tapaba el ícono.
function StatIconBadge({ icon, color }: { icon: React.ReactNode; color: string }) {
  return (
    <div
      className="w-10 h-10 rounded-full flex items-center justify-center mx-auto mb-2"
      style={{
        backgroundColor: `color-mix(in srgb, ${color} 18%, transparent)`,
        color,
      }}
    >
      {icon}
    </div>
  );
}

const RESOURCE_TYPE_LABELS: Record<string, string> = {
  pdf: 'PDF',
  epub: 'EPUB',
  txt: 'Texto',
  externa: 'Enlace externo',
};

// Mismas reglas que en BookGrid → SortableItem.progState, para que las
// estadísticas coincidan con lo que se ve en cada tarjeta.
function getProgressStatus(item: { read?: boolean; progress?: number }): string {
  if (item.read) return 'Leído';
  const p = item.progress || 0;
  // 0% Sin leer · 1–25% Consultado · 26–50% En proceso · 51–99% Revisado · 100% Leído
  if (p === 0) return 'Sin leer';
  if (p <= 25) return 'Consultado';
  if (p <= 50) return 'En proceso';
  if (p < 100) return 'Revisado';
  return 'Leído';
}

const STATUS_ORDER = ['Sin leer', 'Consultado', 'En proceso', 'Revisado', 'Leído'];

export function AnalyticsDashboard() {
  const { items, categories } = useLibrary();

  // El registro de tiempo de lectura vive en localStorage y se actualiza desde
  // ReaderView mientras el panel de estadísticas puede estar abierto en otra
  // pestaña/vista — lo releemos al montar y periódicamente.
  const [readingLog, setReadingLog] = useState<Record<string, number>>({});

  useEffect(() => {
    const refresh = () => setReadingLog(getReadingTimeLog());
    refresh();
    const interval = setInterval(refresh, 30000);
    return () => clearInterval(interval);
  }, []);

  const stats = useMemo(() => {
    let readCount = 0;
    let totalItems = items.length;
    let physicalCount = 0;
    let digitalCount = 0;
    let categoryDist = categories.map(c => ({ name: c.name, count: 0, id: c.id }));

    const monthlyFinished: Record<string, number> = {};
    const resourceTypeCounts: Record<string, number> = {};
    const tagCounts: Record<string, number> = {};
    const statusCounts: Record<string, number> = { 'Sin leer': 0, 'Consultado': 0, 'En proceso': 0, 'Revisado': 0, 'Leído': 0 };

    items.forEach(item => {
      if (item.read) readCount++;
      if (item.ownedPhysical) physicalCount++;
      if (item.ownedDigital) digitalCount++;
      const cat = categoryDist.find(c => c.id === item.category);
      if (cat) cat.count++;

      // Distribución por tipo de archivo (PDF, EPUB, etc.)
      const typeLabel = RESOURCE_TYPE_LABELS[item.type] || item.type || 'Otro';
      resourceTypeCounts[typeLabel] = (resourceTypeCounts[typeLabel] || 0) + 1;

      // Distribución por etiqueta
      (item.tags || []).forEach(tag => {
        const t = tag.trim();
        if (!t) return;
        tagCounts[t] = (tagCounts[t] || 0) + 1;
      });

      // Distribución por estado de avance
      statusCounts[getProgressStatus(item)]++;

      // Reading velocity proxy (books added/finished per month based on timestamp)
      if (item.read && item.timestamp) {
         const date = new Date(item.timestamp);
         const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
         monthlyFinished[monthKey] = (monthlyFinished[monthKey] || 0) + 1;
      }
    });

    const velocityData = Object.entries(monthlyFinished)
      .map(([month, count]) => ({ month, count }))
      .sort((a, b) => a.month.localeCompare(b.month));

    const resourceTypeDist = Object.entries(resourceTypeCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    const tagDist = Object.entries(tagCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);

    const statusDist = STATUS_ORDER
      .map(name => ({ name, count: statusCounts[name] || 0 }))
      .filter(s => s.count > 0);

    return {
       readCount,
       totalItems,
       physicalCount,
       digitalCount,
       categoryDist: categoryDist.filter(c => c.count > 0),
       velocityData,
       resourceTypeDist,
       tagDist,
       statusDist,
    };
  }, [items, categories]);

  // --- Lectura diaria ---------------------------------------------------------
  const dailyReading = useMemo(() => {
    const today = new Date();
    const days: { key: string; label: string; seconds: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const label = d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' });
      days.push({ key, label, seconds: readingLog[key] || 0 });
    }
    const todayKey = days[days.length - 1].key;
    const todaySeconds = readingLog[todayKey] || 0;
    const totalSeconds = days.reduce((acc, d) => acc + d.seconds, 0);
    return {
      chartData: days.map(d => ({ label: d.label, minutes: Math.round(d.seconds / 60) })),
      todaySeconds,
      totalSeconds,
    };
  }, [readingLog]);

  return (
    <div className="p-8 h-full overflow-y-auto bg-[var(--bg-app)]">
      <div className="max-w-6xl mx-auto space-y-8">
        <h2 className="text-2xl font-bold text-[var(--text-main)] flex items-center gap-3">
          <TrendingUp className="w-6 h-6 text-[var(--primary)]" />
          Insights Personales y Estadísticas
        </h2>

        {/* Stats Row */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
          <div className="bg-[var(--bg-card)] border border-slate-200/50 p-5 rounded-2xl shadow-sm text-center flex flex-col justify-between">
             <div>
                <StatIconBadge icon={<BookOpen className="w-5 h-5" />} color="#10b981" />
                <p className="text-2xl font-black text-[var(--text-main)]">{stats.readCount}</p>
             </div>
             <p className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wide mt-1">Libros Terminados</p>
          </div>
          <div className="bg-[var(--bg-card)] border border-slate-200/50 p-5 rounded-2xl shadow-sm text-center flex flex-col justify-between">
             <div>
                <StatIconBadge icon={<Layers className="w-5 h-5" />} color="#3b82f6" />
                <p className="text-2xl font-black text-[var(--text-main)]">{stats.totalItems}</p>
             </div>
             <p className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wide mt-1">Total en Colección</p>
          </div>
          <div className="bg-[var(--bg-card)] border border-slate-200/50 p-5 rounded-2xl shadow-sm text-center flex flex-col justify-between">
             <div>
                <StatIconBadge icon={<TrendingUp className="w-5 h-5" />} color="#f97316" />
                <p className="text-2xl font-black text-[var(--text-main)]">{stats.totalItems > 0 ? Math.round((stats.readCount/stats.totalItems)*100) : 0}%</p>
             </div>
             <p className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wide mt-1">Tasa de Finalización</p>
          </div>
          <div className="bg-[var(--bg-card)] border border-slate-200/50 p-5 rounded-2xl shadow-sm text-center flex flex-col justify-between">
             <div>
                <StatIconBadge icon={<Book className="w-5 h-5" />} color="#f59e0b" />
                <p className="text-2xl font-black text-[var(--text-main)]">{stats.physicalCount}</p>
             </div>
             <p className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wide mt-1">Libros Físicos</p>
          </div>
          <div className="bg-[var(--bg-card)] border border-slate-200/50 p-5 rounded-2xl shadow-sm text-center flex flex-col justify-between">
             <div>
                <StatIconBadge icon={<Laptop className="w-5 h-5" />} color="#8b5cf6" />
                <p className="text-2xl font-black text-[var(--text-main)]">{stats.digitalCount}</p>
             </div>
             <p className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wide mt-1">Libros Digitales</p>
          </div>
          <div className="bg-[var(--bg-card)] border border-slate-200/50 p-5 rounded-2xl shadow-sm text-center flex flex-col justify-between col-span-2 md:col-span-1">
             <div>
                <StatIconBadge icon={<Timer className="w-5 h-5" />} color="#f43f5e" />
                <p className="text-2xl font-black text-[var(--text-main)]">{formatMinutes(dailyReading.todaySeconds)}</p>
             </div>
             <p className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wide mt-1">Lectura Hoy</p>
          </div>
        </div>

        {/* Lectura diaria */}
        <div className="bg-[var(--bg-card)] border border-slate-200/50 p-6 rounded-2xl shadow-sm flex flex-col h-72">
          <h3 className="text-sm font-bold text-[var(--text-muted)] uppercase tracking-wide mb-6 text-center flex items-center justify-center gap-2">
            <Clock className="w-4 h-4 text-rose-500" /> Lectura diaria (últimos 14 días) — Total: {formatMinutes(dailyReading.totalSeconds)}
          </h3>
          <div className="flex-1 min-h-0 text-[var(--text-main)]">
            {dailyReading.totalSeconds > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dailyReading.chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-card)" />
                  <XAxis dataKey="label" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                  <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} unit=" min" />
                  <Tooltip
                    formatter={(value: number) => [`${value} min`, 'Lectura']}
                    contentStyle={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-card)', borderRadius: '0.5rem', color: 'var(--text-main)' }}
                  />
                  <Bar dataKey="minutes" fill="#f43f5e" radius={[4, 4, 0, 0]} name="Minutos" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="w-full h-full flex items-center justify-center text-slate-400 italic text-sm">
                Aún no se registró tiempo de lectura. Abre un libro para empezar a medir.
              </div>
            )}
          </div>
        </div>

        {/* Insights Row 1 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-80">
          <div className="bg-[var(--bg-card)] border border-slate-200/50 p-6 rounded-2xl shadow-sm flex flex-col">
             <h3 className="text-sm font-bold text-[var(--text-muted)] uppercase tracking-wide mb-6 text-center flex items-center justify-center gap-2">
                <Layers className="w-4 h-4 text-[var(--primary)]" /> Distribución por categoría
             </h3>
             <div className="flex-1 min-h-0 text-[var(--text-main)]">
                {stats.categoryDist.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={stats.categoryDist} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                      <XAxis type="number" tick={{fill: 'var(--text-muted)'}} />
                      <YAxis dataKey="name" type="category" tick={{fill: 'var(--text-muted)'}} width={80} />
                      <Tooltip cursor={{fill: 'var(--bg-card-hover)'}} contentStyle={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-card)', borderRadius: '0.5rem', color: 'var(--text-main)' }} />
                      <Bar dataKey="count" fill="var(--primary)" radius={[0, 4, 4, 0]} name="Recursos" />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-slate-400 italic text-sm">Aún no hay recursos categorizados</div>
                )}
              </div>
          </div>

          <div className="bg-[var(--bg-card)] border border-slate-200/50 p-6 rounded-2xl shadow-sm flex flex-col">
             <h3 className="text-sm font-bold text-[var(--text-muted)] uppercase tracking-wide mb-6 text-center flex items-center justify-center gap-2">
                <Clock className="w-4 h-4 text-emerald-500" /> Velocidad de Lectura
             </h3>
             <div className="flex-1 min-h-0 text-[var(--text-main)]">
                {stats.velocityData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={stats.velocityData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-card)" />
                        <XAxis dataKey="month" tick={{fill: 'var(--text-muted)'}} />
                        <YAxis tick={{fill: 'var(--text-muted)'}} />
                        <Tooltip contentStyle={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-card)', borderRadius: '0.5rem', color: 'var(--text-main)' }} />
                        <Line type="monotone" dataKey="count" stroke="var(--primary)" strokeWidth={3} dot={{ r: 4, fill: 'var(--primary)' }} name="Completados" />
                      </LineChart>
                    </ResponsiveContainer>
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-slate-400 italic text-sm">Insuficientes datos de lectura mensual</div>
                )}
             </div>
          </div>
        </div>

        {/* Insights Row 2: estado de avance + tipo de archivo */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-80">
          <div className="bg-[var(--bg-card)] border border-slate-200/50 p-6 rounded-2xl shadow-sm flex flex-col">
             <h3 className="text-sm font-bold text-[var(--text-muted)] uppercase tracking-wide mb-6 text-center flex items-center justify-center gap-2">
                <BookOpen className="w-4 h-4 text-emerald-500" /> Avance de lectura
             </h3>
             <div className="flex-1 min-h-0 text-[var(--text-main)]">
                {stats.statusDist.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={stats.statusDist}
                        dataKey="count"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={90}
                        label={({ name, value }) => `${name}: ${value}`}
                      >
                        {stats.statusDist.map((_, idx) => (
                          <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-card)', borderRadius: '0.5rem', color: 'var(--text-main)' }} />
                      <Legend wrapperStyle={{ color: 'var(--text-muted)', fontSize: 12 }} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-slate-400 italic text-sm">Aún no hay recursos para mostrar avance</div>
                )}
             </div>
          </div>

          <div className="bg-[var(--bg-card)] border border-slate-200/50 p-6 rounded-2xl shadow-sm flex flex-col">
             <h3 className="text-sm font-bold text-[var(--text-muted)] uppercase tracking-wide mb-6 text-center flex items-center justify-center gap-2">
                <FileType className="w-4 h-4 text-blue-500" /> Distribución por tipo de archivo
             </h3>
             <div className="flex-1 min-h-0 text-[var(--text-main)]">
                {stats.resourceTypeDist.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={stats.resourceTypeDist} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                      <XAxis dataKey="name" tick={{ fill: 'var(--text-muted)', fontSize: 12 }} />
                      <YAxis tick={{ fill: 'var(--text-muted)' }} allowDecimals={false} />
                      <Tooltip cursor={{ fill: 'var(--bg-card-hover)' }} contentStyle={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-card)', borderRadius: '0.5rem', color: 'var(--text-main)' }} />
                      <Bar dataKey="count" fill="#0ea5e9" radius={[4, 4, 0, 0]} name="Recursos" />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-slate-400 italic text-sm">Aún no hay recursos</div>
                )}
             </div>
          </div>
        </div>

        {/* Insights Row 3: etiquetas */}
        <div className="bg-[var(--bg-card)] border border-slate-200/50 p-6 rounded-2xl shadow-sm flex flex-col h-80">
           <h3 className="text-sm font-bold text-[var(--text-muted)] uppercase tracking-wide mb-6 text-center flex items-center justify-center gap-2">
              <TagIcon className="w-4 h-4 text-purple-500" /> Distribución por etiqueta
           </h3>
           <div className="flex-1 min-h-0 text-[var(--text-main)]">
              {stats.tagDist.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stats.tagDist} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                    <XAxis type="number" allowDecimals={false} tick={{ fill: 'var(--text-muted)' }} />
                    <YAxis dataKey="name" type="category" tick={{ fill: 'var(--text-muted)', fontSize: 12 }} width={120} />
                    <Tooltip cursor={{ fill: 'var(--bg-card-hover)' }} contentStyle={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-card)', borderRadius: '0.5rem', color: 'var(--text-main)' }} />
                    <Bar dataKey="count" fill="#8b5cf6" radius={[0, 4, 4, 0]} name="Recursos" />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="w-full h-full flex items-center justify-center text-slate-400 italic text-sm">Aún no hay etiquetas asignadas a tus recursos</div>
              )}
           </div>
        </div>

      </div>
    </div>
  );
}
