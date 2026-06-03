import { useState } from 'react';
import { BookOpen, Lock, User, Eye, EyeOff } from 'lucide-react';

export function LoginScreen({ error: urlError }: { error?: string }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(
    urlError === 'unauthorized' ? 'No tienes acceso a esta biblioteca.' : (urlError || '')
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      setError('Por favor, ingresa tu usuario y contraseña.');
      return;
    }
    setLoading(true);
    setError('');

    try {
      const response = await fetch('/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password }),
      });

      if (response.ok) {
        window.location.reload();
      } else {
        const data = await response.json().catch(() => ({}));
        setError(data.error || 'Usuario o contraseña incorrectos.');
      }
    } catch (err) {
      setError('Error de conexión con el servidor.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100dvh', backgroundColor: 'var(--bg-app)' }} className="flex items-center justify-center p-4">
      {/* Ambient background blur blobs */}
      <div className="absolute top-1/4 left-1/4 w-[300px] h-[300px] rounded-full bg-[var(--primary)]/10 blur-[100px] pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-[300px] h-[300px] rounded-full bg-[var(--secondary)]/20 blur-[100px] pointer-events-none" />

      <div 
        style={{ 
          backgroundColor: 'var(--bg-card)', 
          borderColor: 'var(--border-card)',
          color: 'var(--text-main)'
        }} 
        className="relative z-10 flex flex-col items-center gap-6 p-8 rounded-2xl shadow-2xl w-full max-w-sm border backdrop-blur-md transition-all duration-300"
      >
        {/* Logo */}
        <div className="flex flex-col items-center gap-3">
          <div className="w-16 h-16 rounded-2xl bg-[var(--primary)]/10 flex items-center justify-center border border-[var(--primary)]/20">
            <BookOpen className="w-8 h-8 text-[var(--primary)]" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Biblioteca</h1>
          <p className="text-sm text-[var(--text-muted)] text-center font-medium">
            Tu biblioteca personal de libros y artículos
          </p>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="w-full bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 rounded-xl px-4 py-3 text-sm text-center font-medium">
            {error}
          </div>
        )}

        {/* Login Form */}
        <form onSubmit={handleSubmit} className="w-full flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
              Usuario
            </label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3.5 text-[var(--text-muted)]">
                <User className="w-4 h-4" />
              </span>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Ingresa tu usuario"
                className="w-full pl-10 pr-3 py-2.5 rounded-xl border border-[var(--border-card)] bg-[var(--bg-card-hover)] text-[var(--text-main)] placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent text-sm transition-all"
                disabled={loading}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
              Contraseña
            </label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3.5 text-[var(--text-muted)]">
                <Lock className="w-4 h-4" />
              </span>
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Ingresa tu contraseña"
                className="w-full pl-10 pr-10 py-2.5 rounded-xl border border-[var(--border-card)] bg-[var(--bg-card-hover)] text-[var(--text-main)] placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent text-sm transition-all"
                disabled={loading}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute inset-y-0 right-0 flex items-center pr-3.5 text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors cursor-pointer"
                disabled={loading}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-2 flex items-center justify-center gap-2 px-4 py-3 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white font-bold rounded-xl shadow-md shadow-[var(--primary)]/20 transition-all active:scale-95 cursor-pointer disabled:opacity-50"
          >
            {loading ? 'Iniciando sesión...' : 'Iniciar Sesión'}
          </button>
        </form>

        <p className="text-xs text-[var(--text-muted)] text-center font-medium">
          Solo usuarios autorizados pueden acceder.
        </p>
      </div>
    </div>
  );
}
