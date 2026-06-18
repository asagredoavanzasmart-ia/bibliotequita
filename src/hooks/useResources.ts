// =============================================================================
// useResources.ts — Recursos complementarios de un libro (videos, audios,
// textos, imágenes). Carga/crea/actualiza/borra contra /api/books/:bookId/resources.
//
// Patrón: estado local + mutaciones optimistas reconciliadas con la respuesta
// del servidor, igual que useLibrary.
// =============================================================================

import { useCallback, useEffect, useState } from 'react';
import { ResourceItem } from '../types';

async function apiFetch(url: string, options?: RequestInit) {
  const res = await fetch(url, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Error en ${url}`);
  }
  return res.json();
}

export function useResources(bookId: string | undefined) {
  const [resources, setResources] = useState<ResourceItem[]>([]);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(() => {
    if (!bookId) { setResources([]); return; }
    setLoading(true);
    apiFetch(`/api/books/${bookId}/resources`)
      .then((data) => setResources(data.resources ?? []))
      .catch((err) => console.error('No se pudieron cargar los recursos:', err))
      .finally(() => setLoading(false));
  }, [bookId]);

  useEffect(() => { reload(); }, [reload]);

  const addResource = useCallback(async (resource: Omit<ResourceItem, 'id' | 'bookId' | 'timestamp'>) => {
    if (!bookId) return;
    const payload = { ...resource, timestamp: Date.now(), listIndex: 0 };
    try {
      const data = await apiFetch(`/api/books/${bookId}/resources`, { method: 'POST', body: JSON.stringify(payload) });
      setResources((prev) => [...prev, data.resource]);
      return data.resource as ResourceItem;
    } catch (err) {
      console.error('No se pudo crear el recurso:', err);
      throw err;
    }
  }, [bookId]);

  const updateResource = useCallback(async (id: string, updates: Partial<ResourceItem>) => {
    if (!bookId) return;
    setResources((prev) => prev.map((r) => (r.id === id ? { ...r, ...updates } : r)));
    try {
      await apiFetch(`/api/books/${bookId}/resources/${id}`, { method: 'PUT', body: JSON.stringify(updates) });
    } catch (err) {
      console.error('No se pudo actualizar el recurso:', err);
    }
  }, [bookId]);

  const deleteResource = useCallback(async (id: string) => {
    if (!bookId) return;
    setResources((prev) => prev.filter((r) => r.id !== id));
    try {
      await apiFetch(`/api/books/${bookId}/resources/${id}`, { method: 'DELETE' });
    } catch (err) {
      console.error('No se pudo borrar el recurso:', err);
    }
  }, [bookId]);

  return { resources, loading, reload, addResource, updateResource, deleteResource };
}
