import React, { useMemo } from 'react';
import { useLibrary } from '../hooks/useLibrary';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid } from 'recharts';
import { BookOpen, TrendingUp, Layers, Clock, Book, Laptop } from 'lucide-react';

export function AnalyticsDashboard() {
  const { items, categories } = useLibrary();

  const stats = useMemo(() => {
    let readCount = 0;
    let totalItems = items.length;
    let physicalCount = 0;
    let digitalCount = 0;
    let categoryDist = categories.map(c => ({ name: c.name, count: 0, id: c.id }));

    const monthlyFinished: Record<string, number> = {};

    items.forEach(item => {
      if (item.read) readCount++;
      if (item.ownedPhysical) physicalCount++;
      if (item.ownedDigital) digitalCount++;
      const cat = categoryDist.find(c => c.id === item.category);
      if (cat) cat.count++;

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

    return {
       readCount,
       totalItems,
       physicalCount,
       digitalCount,
       categoryDist: categoryDist.filter(c => c.count > 0),
       velocityData
    };
  }, [items, categories]);

  return (
    <div className="p-8 h-full overflow-y-auto bg-[var(--bg-app)]">
      <div className="max-w-6xl mx-auto space-y-8">
        <h2 className="text-2xl font-bold text-[var(--text-main)] flex items-center gap-3">
          <TrendingUp className="w-6 h-6 text-[var(--primary)]" />
          Insights Personales y Estadísticas
        </h2>

        {/* Stats Row */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="bg-[var(--bg-card)] border border-slate-200/50 p-5 rounded-2xl shadow-sm text-center flex flex-col justify-between">
             <div>
                <div className="w-10 h-10 bg-emerald-100/80 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-2 dark:bg-emerald-950/40 dark:text-emerald-400">
                  <BookOpen className="w-5 h-5" />
                </div>
                <p className="text-2xl font-black text-[var(--text-main)]">{stats.readCount}</p>
             </div>
             <p className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wide mt-1">Libros Terminados</p>
          </div>
          <div className="bg-[var(--bg-card)] border border-slate-200/50 p-5 rounded-2xl shadow-sm text-center flex flex-col justify-between">
             <div>
                <div className="w-10 h-10 bg-blue-100/80 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-2 dark:bg-blue-950/40 dark:text-blue-400">
                  <Layers className="w-5 h-5" />
                </div>
                <p className="text-2xl font-black text-[var(--text-main)]">{stats.totalItems}</p>
             </div>
             <p className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wide mt-1">Total en Colección</p>
          </div>
          <div className="bg-[var(--bg-card)] border border-slate-200/50 p-5 rounded-2xl shadow-sm text-center flex flex-col justify-between col-span-2 sm:col-span-1">
             <div>
                <div className="w-10 h-10 bg-orange-100/80 text-orange-600 rounded-full flex items-center justify-center mx-auto mb-2 dark:bg-orange-950/40 dark:text-orange-400">
                  <TrendingUp className="w-5 h-5" />
                </div>
                <p className="text-2xl font-black text-[var(--text-main)]">{stats.totalItems > 0 ? Math.round((stats.readCount/stats.totalItems)*100) : 0}%</p>
             </div>
             <p className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wide mt-1">Tasa de Finalización</p>
          </div>
          <div className="bg-[var(--bg-card)] border border-slate-200/50 p-5 rounded-2xl shadow-sm text-center flex flex-col justify-between">
             <div>
                <div className="w-10 h-10 bg-amber-100/80 text-amber-600 rounded-full flex items-center justify-center mx-auto mb-2 dark:bg-amber-950/40 dark:text-amber-400">
                  <Book className="w-5 h-5" />
                </div>
                <p className="text-2xl font-black text-[var(--text-main)]">{stats.physicalCount}</p>
             </div>
             <p className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wide mt-1">Libros Físicos</p>
          </div>
          <div className="bg-[var(--bg-card)] border border-slate-200/50 p-5 rounded-2xl shadow-sm text-center flex flex-col justify-between">
             <div>
                <div className="w-10 h-10 bg-purple-100/80 text-purple-600 rounded-full flex items-center justify-center mx-auto mb-2 dark:bg-purple-950/40 dark:text-purple-400">
                  <Laptop className="w-5 h-5" />
                </div>
                <p className="text-2xl font-black text-[var(--text-main)]">{stats.digitalCount}</p>
             </div>
             <p className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wide mt-1">Libros Digitales</p>
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

      </div>
    </div>
  );
}
