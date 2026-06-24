// =============================================================================
// AdminPanel.tsx — Gestión de usuarios (solo administradores)
// -----------------------------------------------------------------------------
// Permite crear cuentas de prueba, editar sus límites (subidas, TTS, resúmenes
// con IA, análisis de estudios), activar/desactivar las herramientas de IA,
// activarlas/desactivarlas y eliminarlas. Habla con /api/admin/users.
// =============================================================================

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ShieldCheck, Plus, Trash2, Loader2, Activity, ChevronDown, ChevronUp } from 'lucide-react';
import { formatMinutes } from '../lib/utils';

interface AdminUser {
  id: string;
  username: string;
  email: string | null;
  role: 'admin' | 'user';
  is_active: boolean;
  created_at: string;
  user_limits: {
    max_uploads: number;
    max_tts_chars: number;
    max_ai_summaries: number;
    max_audit_analyses: number;
    ai_tools_enabled: boolean;
  } | null;
}

interface UserActivity {
  last_login_at: string | null;
  account_created_at: string | null;
  reading_time: { day: string; seconds: number }[];
  content_count: number;
  resources_count: number;
  ai_usage: {
    tts_chars_used: number; max_tts_chars: number;
    ai_summaries_used: number; max_ai_summaries: number;
    audit_analyses_used: number; max_audit_analyses: number;
  };
}

export function AdminPanel({ onClose, currentUserId }: { onClose: () => void; currentUserId?: string }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Actividad por usuario: se carga on-demand al expandir cada tarjeta (no
  // junto con la lista inicial) para no disparar N+1 requests al abrir el panel.
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [activityByUser, setActivityByUser] = useState<Record<string, UserActivity>>({});
  const [loadingActivityFor, setLoadingActivityFor] = useState<string | null>(null);

  const toggleActivity = async (id: string) => {
    if (expandedUserId === id) {
      setExpandedUserId(null);
      return;
    }
    setExpandedUserId(id);
    if (activityByUser[id]) return;
    setLoadingActivityFor(id);
    try {
      const res = await fetch(`/api/admin/users/${id}/activity`, { credentials: 'include' });
      const data = await res.json();
      if (res.ok) setActivityByUser(prev => ({ ...prev, [id]: data }));
    } catch { /* se muestra vacío si falla */ }
    finally { setLoadingActivityFor(null); }
  };

  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<'admin' | 'user'>('user');
  const [newMaxUploads, setNewMaxUploads] = useState(3);
  const [newMaxTts, setNewMaxTts] = useState(0);
  const [newMaxAi, setNewMaxAi] = useState(0);
  const [newMaxAudit, setNewMaxAudit] = useState(0);
  const [newAiToolsEnabled, setNewAiToolsEnabled] = useState(true);
  const [creating, setCreating] = useState(false);

  const loadUsers = () => {
    setLoading(true);
    setError(null);
    fetch('/api/admin/users', { credentials: 'include' })
      .then(r => {
        if (!r.ok) throw new Error('No se pudo cargar la lista de usuarios.');
        return r.json();
      })
      .then(d => setUsers(d.users ?? []))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadUsers(); }, []);

  const handleCreate = async () => {
    if (!newUsername || !newPassword) {
      setError('Usuario y contraseña son obligatorios.');
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: newUsername,
          password: newPassword,
          role: newRole,
          max_uploads: newMaxUploads,
          max_tts_chars: newMaxTts,
          max_ai_summaries: newMaxAi,
          max_audit_analyses: newMaxAudit,
          ai_tools_enabled: newAiToolsEnabled,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al crear el usuario.');
      setNewUsername('');
      setNewPassword('');
      setNewRole('user');
      setNewMaxUploads(3);
      setNewMaxTts(0);
      setNewMaxAi(0);
      setNewMaxAudit(0);
      setNewAiToolsEnabled(true);
      loadUsers();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  };

  const updateUser = async (id: string, patch: Record<string, unknown>) => {
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al actualizar el usuario.');
      loadUsers();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const deleteUser = async (id: string, username: string) => {
    if (!confirm(`¿Eliminar al usuario "${username}"? Esta acción no se puede deshacer.`)) return;
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${id}`, { method: 'DELETE', credentials: 'include' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al eliminar el usuario.');
      loadUsers();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const modalContent = (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-[var(--bg-app)] border border-[var(--border-card)] shadow-2xl rounded-2xl w-full max-w-3xl flex flex-col overflow-hidden max-h-[95vh] animate-in zoom-in-95 duration-300">

        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-200/50 bg-[var(--bg-card)]">
          <h2 className="text-xl font-bold text-[var(--text-main)] flex items-center gap-3">
            <span className="bg-[var(--primary)] text-[var(--bg-app)] p-2 rounded-xl shadow-md">
              <ShieldCheck className="w-5 h-5" />
            </span>
            Administración de usuarios
          </h2>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-[var(--primary)] transition-colors rounded-full hover:bg-[var(--primary)]/10">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 p-6 overflow-y-auto settings-scrollbar bg-[var(--bg-app)] text-[var(--text-main)] space-y-6">

          {error && (
            <div className="bg-red-50 text-red-600 text-sm font-medium px-4 py-3 rounded-xl border border-red-200">
              {error}
            </div>
          )}

          {/* Crear usuario */}
          <div className="bg-[var(--bg-card)] border border-[var(--border-card)] rounded-xl p-4 space-y-3">
            <h3 className="text-sm font-bold">Crear cuenta de prueba</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                type="text" placeholder="Nombre de usuario" value={newUsername}
                onChange={e => setNewUsername(e.target.value)}
                className="px-3 py-2 rounded-lg border border-[var(--border-card)] bg-[var(--bg-app)] text-sm"
              />
              <input
                type="password" placeholder="Contraseña" value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                className="px-3 py-2 rounded-lg border border-[var(--border-card)] bg-[var(--bg-app)] text-sm"
              />
              <label className="flex flex-col gap-1 text-xs font-medium text-[var(--text-muted)]">
                Rol
                <select value={newRole} onChange={e => setNewRole(e.target.value as 'admin' | 'user')} className="px-3 py-2 rounded-lg border border-[var(--border-card)] bg-[var(--bg-app)] text-sm text-[var(--text-main)]">
                  <option value="user">Usuario</option>
                  <option value="admin">Administrador</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-[var(--text-muted)]">
                Límite de subidas (0 = sin límite)
                <input type="number" min={0} value={newMaxUploads} onChange={e => setNewMaxUploads(Number(e.target.value))} className="px-3 py-2 rounded-lg border border-[var(--border-card)] bg-[var(--bg-app)] text-sm" />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-[var(--text-muted)]">
                Límite de caracteres TTS (0 = sin límite)
                <input type="number" min={0} value={newMaxTts} onChange={e => setNewMaxTts(Number(e.target.value))} className="px-3 py-2 rounded-lg border border-[var(--border-card)] bg-[var(--bg-app)] text-sm" />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-[var(--text-muted)]">
                Límite de resúmenes IA (0 = sin límite)
                <input type="number" min={0} value={newMaxAi} onChange={e => setNewMaxAi(Number(e.target.value))} className="px-3 py-2 rounded-lg border border-[var(--border-card)] bg-[var(--bg-app)] text-sm" />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-[var(--text-muted)]">
                Límite de análisis de estudios (0 = sin límite)
                <input type="number" min={0} value={newMaxAudit} onChange={e => setNewMaxAudit(Number(e.target.value))} className="px-3 py-2 rounded-lg border border-[var(--border-card)] bg-[var(--bg-app)] text-sm" />
              </label>
              <label className="flex items-center gap-2 text-xs font-medium text-[var(--text-muted)] sm:col-span-2">
                <input type="checkbox" checked={newAiToolsEnabled} onChange={e => setNewAiToolsEnabled(e.target.checked)} className="w-4 h-4 accent-[var(--primary)]" />
                Herramientas de IA habilitadas
              </label>
            </div>
            <button
              onClick={handleCreate}
              disabled={creating}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--primary)] text-white text-sm font-bold hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Crear usuario
            </button>
          </div>

          {/* Lista de usuarios */}
          <div>
            <h3 className="text-sm font-bold mb-3">Usuarios existentes</h3>
            {loading ? (
              <div className="flex items-center justify-center py-8 text-[var(--text-muted)]">
                <Loader2 className="w-5 h-5 animate-spin" />
              </div>
            ) : (
              <div className="space-y-2">
                {users.map(u => {
                  const isSelf = !!currentUserId && u.id === currentUserId;
                  return (
                  <div key={u.id} className="bg-[var(--bg-card)] border border-[var(--border-card)] rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div>
                        <p className="font-bold text-sm flex items-center gap-1.5">
                          {u.username}
                          {isSelf && <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--primary)] bg-[var(--primary)]/10 px-1.5 py-0.5 rounded">Tú</span>}
                        </p>
                        <p className="text-xs text-[var(--text-muted)]">
                          {u.role === 'admin' ? 'Administrador' : 'Usuario'} · {u.is_active ? 'Activo' : 'Deshabilitado'}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => toggleActivity(u.id)}
                          className="flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded-lg bg-sky-50 text-sky-600 hover:bg-sky-100 transition-colors"
                          title="Ver actividad"
                        >
                          <Activity className="w-3.5 h-3.5" />
                          Actividad
                          {expandedUserId === u.id ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        </button>
                        {/* No puedes deshabilitar ni eliminar tu propia cuenta —
                            el backend ya lo rechaza para "eliminar" (no puede
                            quedarse sin admin a mitad de sesión), pero antes el
                            botón seguía visible y clickeable igual, dando la
                            impresión de que la app permitía autoeliminarse. */}
                        {!isSelf && (
                          <>
                            <button
                              onClick={() => updateUser(u.id, { is_active: !u.is_active })}
                              className={u.is_active
                                ? "text-xs font-bold px-3 py-1.5 rounded-lg bg-amber-50 text-amber-600 hover:bg-amber-100 transition-colors"
                                : "text-xs font-bold px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition-colors"}
                            >
                              {u.is_active ? 'Deshabilitar' : 'Habilitar'}
                            </button>
                            <button
                              onClick={() => deleteUser(u.id, u.username)}
                              className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 transition-colors"
                              title="Eliminar"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {expandedUserId === u.id && (
                      <div className="bg-[var(--bg-app)] border border-[var(--border-card)] rounded-lg p-3 text-xs space-y-2">
                        {loadingActivityFor === u.id ? (
                          <div className="flex items-center justify-center py-3 text-[var(--text-muted)]">
                            <Loader2 className="w-4 h-4 animate-spin" />
                          </div>
                        ) : activityByUser[u.id] ? (
                          (() => {
                            const a = activityByUser[u.id];
                            const totalReadingSeconds = a.reading_time.reduce((sum, r) => sum + r.seconds, 0);
                            const fmtLimit = (used: number, max: number) => max > 0 ? `${used} / ${max}` : `${used} (sin límite)`;
                            return (
                              <>
                                <p><span className="font-bold text-[var(--text-main)]">Última conexión:</span> {a.last_login_at ? new Date(a.last_login_at).toLocaleString() : 'Nunca'}</p>
                                <p><span className="font-bold text-[var(--text-main)]">Tiempo de lectura (últimos 30 días):</span> {formatMinutes(totalReadingSeconds)}</p>
                                <p><span className="font-bold text-[var(--text-main)]">Contenido subido:</span> {a.content_count} libros · {a.resources_count} recursos</p>
                                <div className="pt-1 border-t border-[var(--border-card)] space-y-1">
                                  <p className="font-bold text-[var(--text-main)]">Uso de IA vs. límites:</p>
                                  <p>TTS: {fmtLimit(a.ai_usage.tts_chars_used, a.ai_usage.max_tts_chars)} caracteres</p>
                                  <p>Resúmenes: {fmtLimit(a.ai_usage.ai_summaries_used, a.ai_usage.max_ai_summaries)}</p>
                                  <p>Análisis de estudios: {fmtLimit(a.ai_usage.audit_analyses_used, a.ai_usage.max_audit_analyses)}</p>
                                </div>
                              </>
                            );
                          })()
                        ) : (
                          <p className="text-[var(--text-muted)]">No se pudo cargar la actividad.</p>
                        )}
                      </div>
                    )}

                    {u.user_limits && (
                      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                        <label className="flex flex-col gap-1 text-xs font-medium text-[var(--text-muted)]">
                          Subidas
                          <input
                            type="number" min={0} defaultValue={u.user_limits.max_uploads}
                            onBlur={e => updateUser(u.id, { max_uploads: Number(e.target.value) })}
                            className="px-3 py-2 rounded-lg border border-[var(--border-card)] bg-[var(--bg-app)] text-sm"
                          />
                        </label>
                        <label className="flex flex-col gap-1 text-xs font-medium text-[var(--text-muted)]">
                          Caracteres TTS
                          <input
                            type="number" min={0} defaultValue={u.user_limits.max_tts_chars}
                            onBlur={e => updateUser(u.id, { max_tts_chars: Number(e.target.value) })}
                            className="px-3 py-2 rounded-lg border border-[var(--border-card)] bg-[var(--bg-app)] text-sm"
                          />
                        </label>
                        <label className="flex flex-col gap-1 text-xs font-medium text-[var(--text-muted)]">
                          Resúmenes IA
                          <input
                            type="number" min={0} defaultValue={u.user_limits.max_ai_summaries}
                            onBlur={e => updateUser(u.id, { max_ai_summaries: Number(e.target.value) })}
                            className="px-3 py-2 rounded-lg border border-[var(--border-card)] bg-[var(--bg-app)] text-sm"
                          />
                        </label>
                        <label className="flex flex-col gap-1 text-xs font-medium text-[var(--text-muted)]">
                          Análisis de estudios
                          <input
                            type="number" min={0} defaultValue={u.user_limits.max_audit_analyses}
                            onBlur={e => updateUser(u.id, { max_audit_analyses: Number(e.target.value) })}
                            className="px-3 py-2 rounded-lg border border-[var(--border-card)] bg-[var(--bg-app)] text-sm"
                          />
                        </label>
                        <label className="flex items-center gap-2 text-xs font-medium text-[var(--text-muted)] sm:col-span-4">
                          <input
                            type="checkbox" checked={u.user_limits.ai_tools_enabled}
                            onChange={e => updateUser(u.id, { ai_tools_enabled: e.target.checked })}
                            className="w-4 h-4 accent-[var(--primary)]"
                          />
                          Herramientas de IA habilitadas
                        </label>
                      </div>
                    )}
                  </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
