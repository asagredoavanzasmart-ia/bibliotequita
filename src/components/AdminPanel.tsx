// =============================================================================
// AdminPanel.tsx — Gestión de usuarios (solo administradores)
// -----------------------------------------------------------------------------
// Permite crear cuentas de prueba, editar sus límites (subidas, TTS, resúmenes
// con IA), activarlas/desactivarlas y eliminarlas. Habla con /api/admin/users.
// =============================================================================

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ShieldCheck, Plus, Trash2, Loader2 } from 'lucide-react';

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
  } | null;
}

export function AdminPanel({ onClose }: { onClose: () => void }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<'admin' | 'user'>('user');
  const [newMaxUploads, setNewMaxUploads] = useState(3);
  const [newMaxTts, setNewMaxTts] = useState(0);
  const [newMaxAi, setNewMaxAi] = useState(0);
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
                {users.map(u => (
                  <div key={u.id} className="bg-[var(--bg-card)] border border-[var(--border-card)] rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div>
                        <p className="font-bold text-sm">{u.username}</p>
                        <p className="text-xs text-[var(--text-muted)]">
                          {u.role === 'admin' ? 'Administrador' : 'Usuario'} · {u.is_active ? 'Activo' : 'Deshabilitado'}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
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
                      </div>
                    </div>

                    {u.user_limits && (
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
