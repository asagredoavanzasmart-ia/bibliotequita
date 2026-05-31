# Sistema Biblioteca Personal — Documentación y Plan de Mejoras

> Documento de trabajo. La idea es que lo iteremos juntos: agregar contexto, marcar mejoras como hechas, priorizar, descartar, etc.

---

## 🆕 Cambios aplicados en esta iteración

- ✅ **Almacenamiento de archivos migrado al servidor.** Nuevos endpoints `POST /api/upload`, `GET /api/files/:name`, `DELETE /api/files/:name` en [server.ts](server.ts) (multer + carpeta `uploads/` ignorada en git). Helper único [src/lib/uploadFile.ts](src/lib/uploadFile.ts). Modales y lectores adaptados.
- ✅ **Limpieza de huérfanos al borrar libro:** `deleteItem` ahora limpia `notes-<id>`, `color-palette-<id>` y dispara DELETE de los archivos en el servidor.
- ✅ **Modelo Gemini inexistente arreglado** (`gemini-3.5-flash` → `gemini-2.5-flash`) en el endpoint de resumen.
- ✅ **Archivos sueltos eliminados** de la raíz: `search_results.txt`, `search_useState.txt`, `metadata.json`.
- ⏳ Compatibilidad con items legacy `idb://` y `blob:` mantenida en lectores para no romper datos antiguos.

---

## 1. ¿Qué es esta aplicación?

Una **biblioteca personal local-first** para gestionar, leer y anotar **libros (PDF/EPUB), revistas, artículos web y recursos externos**. Funciona como organizador de libros + lector + bloc de notas + asistente IA, todo en el navegador.

**Nombre del proyecto:** `Biblioteca` (ver [index.html](index.html#L6) y [package.json](package.json#L2) — actualmente `react-example`).
**Pantalla de carga:** [src/main.tsx](src/main.tsx) → `<App />` → decide entre **Dashboard** (catálogo) o **ReaderView** (lector).

---

## 2. Stack técnico

| Capa | Tecnología | Detalle |
|---|---|---|
| Frontend | React 19 + TypeScript | StrictMode activo |
| Bundler / Dev | Vite 6 | `npm run dev` arranca el servidor en `:3000` |
| Estilos | TailwindCSS 4 + variables CSS | Sistema de temas con `[data-theme="..."]` en `index.css` |
| Estado global | Context API ([useLibrary](src/hooks/useLibrary.tsx)) | Sin Redux ni Zustand |
| Drag & Drop | `@dnd-kit/core` + `sortable` | DnDContext único en Dashboard |
| Persistencia (metadata) | `localStorage` | Claves `library_*` |
| Persistencia (archivos) | **Servidor (`uploads/`) + `multer`** | URLs `/api/files/<uuid>.<ext>`. `idb-keyval` queda solo como fallback legacy. |
| Lectura PDF | `react-pdf` (pdfjs) | Scroll continuo + IntersectionObserver |
| Lectura EPUB | `react-reader` | Flow paginated |
| Markdown (notas) | `react-markdown` | |
| Gráficos | `recharts` | Solo en AnalyticsDashboard |
| Iconos | `lucide-react` | |
| Animaciones | `motion` (Framer) | Uso puntual |
| Backend (dev y prod) | Express + tsx/esbuild | [server.ts](server.ts) |
| IA | Google Gemini (`@google/genai`) | Modelo único: `gemini-2.5-flash` |
| Auth (parcial) | Firebase Auth (Google) | Solo para exportar a Google Docs |

---

## 3. Arquitectura general

```
┌─────────────────────────────────────────────────────────────┐
│  Browser SPA (React)                                        │
│                                                             │
│  ┌─────────────────┐         ┌──────────────────────────┐   │
│  │   Dashboard     │ <────── │     LibraryProvider      │   │
│  │  (catálogo)     │         │   (Context API global)   │   │
│  └─────────────────┘         └──────────────────────────┘   │
│         │                              │                    │
│         │ onOpenBook(id)               │                    │
│         ▼                              ▼                    │
│  ┌─────────────────┐         ┌──────────────────────────┐   │
│  │   ReaderView    │         │  localStorage            │   │
│  │   (lector)      │         │  - library_items         │   │
│  └─────────────────┘         │  - library_playlists     │   │
│         │                    │  - library_categories    │   │
│         ▼                    │  - library_tags          │   │
│  PDFReader / EPUBReader      │  - library_theme/font    │   │
│  NotesPanel                  │  - notes-<docId>         │   │
│  CitationsManager            │  - color-palette-<docId> │   │
│  EditBookModal               │                          │   │
│                              │  IndexedDB (idb-keyval)  │   │
│                              │  - SOLO LECTURA legacy   │   │
│                              │    para items "idb://"   │   │
│                              └──────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                  │ fetch /api/... + /api/upload + /api/files/...
                  ▼
┌─────────────────────────────────────────────────────────────┐
│  Express Server (server.ts)                                 │
│  - POST /api/upload         (multer → uploads/<uuid>.<ext>) │
│  - GET  /api/files/:name    (sirve PDF/EPUB/portadas)       │
│  - DEL  /api/files/:name    (limpieza al borrar libros)     │
│  - /api/proxy-resource      (CORS bypass para PDFs externos)│
│  - /api/analyze-pdf         (Gemini extrae metadatos)       │
│  - /api/analyze-url         (Gemini analiza HTML scrapeado) │
│  - /api/analyze-image       (Gemini analiza portada)        │
│  - /api/gemini/summarize    (Gemini resume citas)           │
│                                                             │
│  Storage en disco: ./uploads/  (ignorado por git)           │
└─────────────────────────────────────────────────────────────┘
```

**Punto clave:** la **metadata** (lista de libros, etiquetas, listas, configuración) vive en `localStorage` del navegador y por tanto sigue siendo local-first. Los **archivos grandes** (PDF/EPUB y portadas) ahora viven en `./uploads/` del servidor, accesibles vía `/api/files/<uuid>.<ext>`. Sigue sin haber base de datos ni autenticación ni sincronización multi-dispositivo: si copias el repo y la carpeta `uploads/` a otro equipo, te llevas todo.

---

## 4. Modelos de datos ([src/types.ts](src/types.ts))

- **`BookItem`** — la entidad central. Cada recurso es uno. Campos importantes:
  - `source`: **`/api/files/<uuid>.<ext>`** (nuevo, servido por el backend) · URL pública · `blob:` o `idb://` (legacy).
  - `category`: id de `CategoryData` (`libros`, `revistas`, `articulos`, o personalizadas).
  - `tags`: se almacenan **por nombre, no por id** (ojo, ver mejoras §6).
  - `folderIds` / `stageIds`: listas y etapas históricas asignadas.
  - `bookmarkPage`: última página → al abrir el libro reanuda ahí.
  - `progress` (0–100), `rating` (1–5), flags `read/toBuy/pinned/ownedPhysical/ownedDigital`.
- **`CategoryData`** — categorías de primer nivel (editables en Settings).
- **`PlaylistData`** — "Mis Listas" del sidebar (con color).
- **`StageData`** — etapas históricas (HARDCODEADAS: Prehistoria → Edad Contemporánea, no se persisten).
- **`TagData`** — etiquetas globales con color.
- **`Note`** (en NotesPanel) — notas/citas/marcadores por documento.

---

## 5. Mapa de componentes (qué hace cada uno)

### Entry & layout
| Archivo | Rol |
|---|---|
| [src/main.tsx](src/main.tsx) | Entry point. Monta `<App />` en `#root`. |
| [src/App.tsx](src/App.tsx) | Router minimalista: Dashboard vs ReaderView. |
| [src/hooks/useLibrary.tsx](src/hooks/useLibrary.tsx) | **CONTEXTO GLOBAL.** Estado + persistencia + migraciones. |

### Catálogo (Dashboard)
| Archivo | Rol |
|---|---|
| [src/components/Dashboard.tsx](src/components/Dashboard.tsx) | Layout 3 zonas + DnDContext + bulk actions flotantes. |
| [src/components/Sidebar.tsx](src/components/Sidebar.tsx) | Navegación: categorías, siglos, A–Z, etapas, playlists, filtros. |
| [src/components/Toolbar.tsx](src/components/Toolbar.tsx) | Buscador (con suggestions), orden, viewMode, botón "Añadir". |
| [src/components/BookGrid.tsx](src/components/BookGrid.tsx) | Renderiza items (grid / grid-compact / list) + filtrado/orden. |
| [src/components/AnalyticsDashboard.tsx](src/components/AnalyticsDashboard.tsx) | Stats: leídos, %, géneros preferidos, velocidad mensual (recharts). |

### Lectura (ReaderView)
| Archivo | Rol |
|---|---|
| [src/components/ReaderView.tsx](src/components/ReaderView.tsx) | Split-view redimensionable + toolbars + selección de texto. |
| [src/components/PDFReader.tsx](src/components/PDFReader.tsx) | react-pdf con scroll continuo, IntersectionObserver, pinch-zoom. |
| [src/components/EPUBReader.tsx](src/components/EPUBReader.tsx) | react-reader (minimalista). |
| [src/components/NotesPanel.tsx](src/components/NotesPanel.tsx) | Panel de notas/citas/marcadores (Markdown). |
| [src/components/CitationsManager.tsx](src/components/CitationsManager.tsx) | Vista completa: ordenar, agrupar, **resumir con Gemini**, exportar. |

### Modales
| Archivo | Rol |
|---|---|
| [src/components/AddManualModal.tsx](src/components/AddManualModal.tsx) | Añadir recurso (PDF upload, URL externa, manual). Análisis IA. |
| [src/components/EditBookModal.tsx](src/components/EditBookModal.tsx) | Editar metadatos (`inline` también se usa dentro del Reader). |
| [src/components/FolderManagerModal.tsx](src/components/FolderManagerModal.tsx) | Asignar libro a listas/etapas. |
| [src/components/BulkTagModal.tsx](src/components/BulkTagModal.tsx) | Etiquetar masivamente la selección. |
| [src/components/SettingsModal.tsx](src/components/SettingsModal.tsx) | Tabs: tema, categorías, tags, tarjetas, playlists. |

### Utilidades
| Archivo | Rol |
|---|---|
| [src/lib/utils.ts](src/lib/utils.ts) | `cn()` (clsx + tailwind-merge). |
| [src/utils/exportUtils.ts](src/utils/exportUtils.ts) | Exportar a `.docx`, PDF imprimible, Google Docs (Firebase Auth). |
| [src/index.css](src/index.css) | Tokens CSS por tema + scrollbars + Tailwind import. |

### Backend
| Archivo | Rol |
|---|---|
| [server.ts](server.ts) | Express + Vite middleware + 5 endpoints `/api/*` (Gemini). |

---

## 6. Mapeo rápido UI → código (para navegar la app y el código a la par)

| Lo que ves en pantalla | Archivo |
|---|---|
| El sidebar oscuro de la izquierda | [Sidebar.tsx](src/components/Sidebar.tsx) |
| La barra de búsqueda y "Añadir Recurso" | [Toolbar.tsx](src/components/Toolbar.tsx) |
| Las tarjetas del catálogo | [BookGrid.tsx](src/components/BookGrid.tsx) (`SortableItem`) |
| El botón "+" flotante en móvil | [Dashboard.tsx:106-110](src/components/Dashboard.tsx#L106-L110) |
| La barra negra "X seleccionados" | [Dashboard.tsx:150-218](src/components/Dashboard.tsx#L150-L218) |
| Modal "Añadir Recurso" | [AddManualModal.tsx](src/components/AddManualModal.tsx) |
| Tab "Análisis" del sidebar | [AnalyticsDashboard.tsx](src/components/AnalyticsDashboard.tsx) |
| Lectura PDF / EPUB | [ReaderView.tsx](src/components/ReaderView.tsx) → PDFReader/EPUBReader |
| Panel lateral de notas en el lector | [NotesPanel.tsx](src/components/NotesPanel.tsx) |
| Vista "Administrar citas" en el lector | [CitationsManager.tsx](src/components/CitationsManager.tsx) |
| Modal de ajustes (engranaje) | [SettingsModal.tsx](src/components/SettingsModal.tsx) |

---

## 7. Riesgos y deuda técnica detectados

> Lo que está ✅ se arregló. Lo que está ⏳ queda pendiente.

### 🔴 Críticos (afectan datos del usuario)

1. ✅ **[RESUELTO] Pérdida de archivos al recargar.**
   Migrado a almacenamiento en servidor: `POST /api/upload` (multer) → carpeta `uploads/` en disco → URL pública `/api/files/<uuid>.<ext>` guardada en `BookItem.source`. Ya no depende de `blob:` ni de IndexedDB del navegador.
   Cambios: [server.ts](server.ts), [src/lib/uploadFile.ts](src/lib/uploadFile.ts) (nuevo), [AddManualModal.tsx](src/components/AddManualModal.tsx), [EditBookModal.tsx](src/components/EditBookModal.tsx). Lectores ([PDFReader.tsx](src/components/PDFReader.tsx), [EPUBReader.tsx](src/components/EPUBReader.tsx)) cargan la URL directo; conservan fallback `idb://` y `blob:` para items legacy.

2. ✅ **[PARCIAL] Tope de localStorage por thumbnails inline.**
   Las portadas subidas por el usuario van al servidor (URL corta en `thumbnailUrl`). PENDIENTE: la portada auto-extraída de la 1ª página del PDF (`canvas.toDataURL`) aún se guarda como base64 — habría que subirla también al servidor. Ver §8 → "Subir auto-portada al servidor".

3. ✅ **[RESUELTO] Notas y archivos huérfanos al borrar libro.**
   [useLibrary.deleteItem](src/hooks/useLibrary.tsx) ahora limpia `localStorage[notes-<id>]`, `localStorage[color-palette-<id>]` y hace `DELETE /api/files/<uuid>` tanto del archivo digital como de la portada cuando viven en nuestro servidor.

4. ⏳ **[PENDIENTE] `tags` se guardan por nombre, no por id.**
   Cambio invasivo (rompe datos sin migración). No lo apliqué en esta iteración para no romper la maqueta. Si quieres, lo planificamos como migración explícita v1→v2.

### 🟡 Importantes (UX y mantenibilidad)

5. **`StageData` está hardcodeada** en [useLibrary.tsx:43-49](src/hooks/useLibrary.tsx#L43-L49). El usuario no puede crear/editar/borrar etapas históricas desde Settings, aunque hay sección visual para ellas.

6. **Sin manejo de errores visible en `/api/*`.** Si Gemini falla, la UI se queda en "Analizando..." sin feedback claro. `AddManualModal` y `CitationsManager` deberían mostrar toasts.

7. ✅ **[RESUELTO] Modelo `gemini-3.5-flash` no existe.** Cambiado a `gemini-2.5-flash` en [server.ts](server.ts) (endpoint summarize).

8. ✅ **[RESUELTO] `metadata.json`** eliminado de la raíz.

9. ✅ **[RESUELTO] `search_results.txt` y `search_useState.txt`** eliminados de la raíz.

10. **`.env` y `.env.example` tienen el mismo contenido (467 bytes).** Si `.env` contiene la clave real, hay riesgo de filtración. Confirmar que `.gitignore` lo excluye (lo hace para `.env`, pero conviene revisar el contenido).



12. **`CitationsManager.tsx` tiene ~70k caracteres.** Es el archivo más grande del proyecto. Riesgo claro de bug-festival al modificarlo.



14. **`server.ts` no valida `req.body` ni `req.query`.** Cualquier POST con JSON malformado puede crashear el proceso. Mínimo validar con zod o `typeof === 'string'`.

15. **El proxy `/api/proxy-resource` es un SSRF abierto.** Acepta cualquier URL y la fetchea. Si esto se despliega públicamente, alguien puede usar el servidor para escanear la red interna. Whitelist de dominios o desactivar en prod.

### 🟢 Quality of life

16. **Sin TypeScript strict ni linter configurado.** `npm run lint` solo hace `tsc --noEmit`. No hay ESLint/Prettier. El estilo es heterogéneo.

17. **Sin tests.** Cero archivos `*.test.*`. La lógica de filtrado/orden/migración de [BookGrid.tsx:337-387](src/components/BookGrid.tsx#L337-L387) y [useLibrary.tsx:78-125](src/hooks/useLibrary.tsx#L78-L125) sería fácil de testear y se rompe a menudo.

18. **`uuid` 14.0.0 + `crypto.randomUUID()` mezclados.** En NotesPanel usa `crypto.randomUUID()`, en useLibrary usa `uuidv4()`. Unificar.

19. **Importación dinámica de `firebase-applet-config.json`** ([exportUtils.ts:14-15](src/utils/exportUtils.ts#L14-L15)) con `// @vite-ignore`. Frágil. La exportación a Google Docs probablemente está rota hasta que ese archivo exista.

20. **Sin keyboard shortcuts** (next page, search, fullscreen). Sería un boost gigante para uso intensivo.

21. **Sin modo "leer sin distracciones"** real para EPUB (el wrapper actual es muy básico).

22. **`AnalyticsDashboard`** mide "velocidad de lectura" usando `timestamp` (fecha de creación del item), no la fecha en que se marcó como leído. Es engañoso.

23. **Migración de categorías** ([useLibrary.tsx:78-125](src/hooks/useLibrary.tsx#L78-L125)) es lógica defensiva que va a quedar para siempre. Convendría poder declararla como "v1→v2" y ejecutarla una vez.

---

## 8. Ideas de features (para discutir y priorizar)

> Listo por bloques. Pondré una estimación de esfuerzo: S/M/L.

### Datos & resiliencia
- [ ] **(M)** Exportar/Importar toda la biblioteca a un único `.json` (backup), incluyendo descarga ZIP de los archivos en `uploads/`.
- [ ] **(M)** Sincronización opcional con Drive/Dropbox.
- [ ] **(S)** Subir al servidor también la portada auto-extraída de la 1ª página del PDF (hoy queda como base64 en localStorage).
- [ ] **(S)** Endpoint `GET /api/files` que liste archivos huérfanos (subidos pero sin `BookItem` asociado) para limpieza periódica.
- [x] ~~**(S)** Eliminar notas huérfanas al borrar items (fix bug §7.3).~~  ✅ HECHO

### Lectura
- [ ] **(M)** Buscador interno de texto dentro del PDF/EPUB.
- [ ] **(S)** Atajos de teclado (←/→ páginas, `/` buscar, `f` fullscreen, `n` notas).
- [ ] **(M)** Resaltado persistente sobre el PDF (no solo cita en notas).
- [ ] **(L)** TTS (text-to-speech) por página con api de eleven labs.

### Citas & notas
- [ ] **(M)** Exportar todas las citas de un libro a markdown/BibTeX/RIS.
- [ ] **(M)** Buscar citas y notas globalmente (cross-libro).
- [ ] **(M)** Generar bibliografía APA/MLA/Chicago a partir de la metadata.
- [ ] **(L)** Sugerencias de notas con IA basadas en lo leído.

### IA
- [ ] **(S)** Reintentos + toasts de error visibles en cada llamada a Gemini.
- [ ] **(M)** Resumen ejecutivo automático por libro al terminarlo.
- [ ] **(M)** "Pregúntale al libro" (RAG sobre el PDF cargado).
- [ ] **(S)** Permitir elegir el modelo desde Settings.

### UX visual
- [ ] **(S)** Modo "leyendo ahora" en el dashboard (atajo a último libro abierto).
- [ ] **(M)** Vista "Estantería" (mockup de libros físicos en estantes).

- [ ] **(S)** Animaciones de transición Dashboard ↔ Reader.

### Mantenibilidad
- [ ] **(S)** Configurar ESLint + Prettier + lint-staged.
- [ ] **(M)** Refactorizar Sidebar.tsx en subcomponentes.
- [ ] **(L)** Unificar AddManualModal + EditBookModal en uno solo (`<BookFormModal mode="add|edit" />`).
- [ ] **(M)** Tests de la lógica de filtrado/orden (vitest).
- [ ] **(S)** Renombrar `react-example` → `biblioteca-personal` en `package.json`.
- [x] ~~**(S)** Borrar `search_results.txt`, `search_useState.txt`, `metadata.json` de la raíz.~~  ✅ HECHO

### Seguridad (si llega a estar en línea)
- [ ] **(S)** Whitelist de dominios en `/api/proxy-resource`.
- [ ] **(S)** Rate limiting básico en `/api/*`.
- [ ] **(M)** Mover GEMINI_API_KEY a un secret manager si se despliega.

---

## 9. Convenciones del proyecto (lo que se nota leyendo)

- **Idioma:** UI en español, comentarios mezclados (ahora unificados a español en los archivos clave).
- **Estilos:** Tailwind con `var(--...)` para los tokens de tema. Evitar colores hardcodeados nuevos: usar `var(--primary)`, `var(--bg-card)`, etc.
- **Iconos:** `lucide-react`. Nada de SVG inline si hay un icono que ya existe en la librería.
- **Persistencia:** la metadata va a `localStorage` con prefijo `library_` (config) o `notes-` / `color-palette-` (per-doc). **Archivos grandes (PDF/EPUB/portadas) → `uploadFile()` desde [src/lib/uploadFile.ts](src/lib/uploadFile.ts) → URL `/api/files/...`**. No volver a meter blobs ni base64 en localStorage.
- **Categorías "virtuales":** `destacados`, `fisico`, `digital`, `analytics`, `todos`. No las confundas con categorías reales (`libros`, `revistas`, `articulos`).
- **Tabs del Reader:** `'reader' | 'edit' | 'citations'`.
- **Bulk events:** se disparan con `window.dispatchEvent(new CustomEvent('bulk-mark-read', ...))`. Patrón a evitar para nuevas features (mejor usar el context).

---

## 10. Próximos pasos sugeridos

Después de los fixes de esta iteración (almacenamiento en servidor + limpieza de huérfanos + modelo Gemini + archivos sueltos), las prioridades pendientes son:

1. **Probar el flujo end-to-end** ahora mismo: subir un PDF, recargar la página y confirmar que persiste; borrar el libro y confirmar que `uploads/<uuid>.pdf` desaparece del disco.
2. **Migración de tags por id** (§7.4) con script que recorra `library_items` y mapee `tag.name → tag.id`. Es invasivo pero necesario para que renombrar tags no rompa nada.
3. **Subir al servidor la auto-portada del PDF** (§7.2 punto pendiente) para vaciar el último base64 grande de localStorage.
4. **Validar entradas en `/api/*`** y cerrar el SSRF del proxy (§7.14–15) si la app va a salir de tu equipo.
5. **Refactor Sidebar + unificación de modales add/edit** (M-L): paga deuda y deja el código listo para nuevas features.
6. **Una feature visible** (la que tú elijas de §8): para tener algo nuevo en pantalla y validar el flujo.

¿Por dónde quieres arrancar?

---

## Apéndice — Cómo ejecutar el proyecto

```bash
npm install
# editar .env y poner GEMINI_API_KEY
npm run dev
# abre http://localhost:3000
```

Scripts disponibles ([package.json](package.json)):
- `dev` → `tsx server.ts` (modo desarrollo con Vite middleware).
- `build` → vite build + esbuild bundle del server.
- `start` → corre el server bundled de prod.
- `lint` → `tsc --noEmit` (solo type-check).
