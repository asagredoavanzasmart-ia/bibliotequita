# PLAN DE IMPLEMENTACIÓN: TABLERO KANBAN DE PROGRESO DE LECTURA

> Plan de ejecución derivado de `SPEC-TABLERO-KANBAN.md`, con decisiones ya
> tomadas con el usuario y detalles verificados contra el código real.
> Escrito para ejecutarse fase por fase sin ambigüedad. Las decisiones
> marcadas CERRADAS no se renegocian durante la implementación.

---

## 0. Decisiones CERRADAS (confirmadas con el usuario)

1. **Ubicación**: sección propia en el menú lateral (como "Análisis"), tablero
   GLOBAL de toda la biblioteca. NO es un modo de vista de la grilla.
2. **Sincronía**: mover tarjetas actualiza los estados reales del libro
   (`read`, `toRead`, `progress`) y `read === true` manda sobre la columna
   mostrada. Reglas exactas en §5.
3. **Columnas fijas** (spec §2): `por_leer`, `pendiente`, `en_curso`,
   `detenido`, `leido`. Sin columnas personalizables en v1.
4. **Solo aparecen libros añadidos explícitamente** al tablero (spec §4):
   `kanbanStatus` con valor. Marcar "leído" un libro que NO está en el
   tablero NO lo agrega.
5. **Cero cambios de servidor**: los items viajan como blob JSON por
   `PUT /api/library/items/:id` (columna `data` de `library_items`); el campo
   nuevo pasa solo.

## Prohibiciones del proyecto (vigentes aquí)

- NO registrar `touchstart/touchmove/touchend` propios. El swipe móvil entre
  columnas es SOLO CSS (`overflow-x-auto` + scroll-snap).
- NO `preventDefault()` sobre eventos de scroll/touch.
- Drag & drop con HTML5 nativo (patrón de `ResourcesPanel.tsx`
  `handleDragStart/Over/Drop`), NUNCA con librerías nuevas ni gestos táctiles.
- Tokens del tema (`var(--bg-card)`, `var(--text-main)`, `var(--primary)`,
  `var(--text-muted)`, `var(--border-card)`, `var(--bg-app)`) — nunca colores
  duros que rompan el modo oscuro.

---

## Fase 0 — Respaldo

```
git branch respaldo-pre-kanban-2026-07-19
```

---

## Fase 1 — Modelo de datos

### 1.1 `src/types.ts`

Agregar a `BookItem` (tras `generatedToc`), con este comentario:

```typescript
  // Columna del Tablero Kanban de progreso de lectura (null/undefined = el
  // libro NO está en el tablero; solo se entra al añadirlo explícitamente).
  // OJO: read === true manda sobre este valor al renderizar (ver KanbanBoard).
  kanbanStatus?: 'por_leer' | 'pendiente' | 'en_curso' | 'detenido' | 'leido' | null;
```

Exportar también el tipo para los componentes:

```typescript
export type KanbanStatus = 'por_leer' | 'pendiente' | 'en_curso' | 'detenido' | 'leido';
```

(y usar `kanbanStatus?: KanbanStatus | null` en `BookItem`).

### 1.2 Persistencia

`useLibrary().updateItem(id, { kanbanStatus: 'en_curso' })` ya persiste (PUT
al servidor + estado local). No se toca `useLibrary.tsx`.

---

## Fase 2 — Componentes nuevos (4 archivos, spec §5B)

### 2.1 `src/components/KanbanBoard.tsx` (contenedor)

**Props**: `{ onOpenBook: (id: string) => void }`.

**Datos**: `const { items, updateItem, tags } = useLibrary();`
(excluir SIEMPRE `items` con `deletedAt` — los borrados no se muestran).

**Definición de columnas** (constante módulo):

```typescript
const KANBAN_COLUMNS: { id: KanbanStatus; title: string; accent: string }[] = [
  { id: 'por_leer',  title: 'Por leer',             accent: 'bg-sky-400' },
  { id: 'pendiente', title: 'Pendiente de iniciar', accent: 'bg-amber-400' },
  { id: 'en_curso',  title: 'En curso',             accent: 'bg-emerald-400' },
  { id: 'detenido',  title: 'Detenido',             accent: 'bg-rose-400' },
  { id: 'leido',     title: 'Leído',                accent: 'bg-violet-400' },
];
```

El `accent` es SOLO el puntito de color junto al título (los textos usan
tokens del tema, nunca el accent como fondo — contraste WCAG, spec §6).

**Columna efectiva de un item** (la regla de sincronía inversa, §5):

```typescript
// read manda: un libro leído SIEMPRE se muestra en "Leído", aunque su
// kanbanStatus guardado diga otra cosa (quedó viejo). Al moverlo desde el
// tablero se reescribe todo coherente (ver moveTo).
const columnOf = (item: BookItem): KanbanStatus | null => {
  if (!item.kanbanStatus) return null;      // no está en el tablero
  if (item.read) return 'leido';
  return item.kanbanStatus;
};
```

**Mover tarjeta** (única función que escribe, usada por drag y por el menú ⋯):

```typescript
const moveTo = (item: BookItem, dest: KanbanStatus) => {
  const updates: Partial<BookItem> = { kanbanStatus: dest };
  if (dest === 'leido')        { updates.read = true;  updates.progress = 100; updates.toRead = false; }
  else if (dest === 'por_leer'){ updates.read = false; updates.toRead = true; }
  else                         { updates.read = false; updates.toRead = false; }
  updateItem(item.id, updates);
};
```

**Quitar del tablero**: `updateItem(item.id, { kanbanStatus: null })` — NO
toca `read`/`toRead`/`progress` (salir del tablero no cambia el estado del
libro).

**Configuración de tarjetas** (spec §3C) — estado + persistencia local:

```typescript
export interface KanbanCardSettings {
  showCover: boolean;       // Mostrar Portada
  coverLarge: boolean;      // Tamaño: false = pequeña lateral, true = grande superior
  showAuthor: boolean;
  showYear: boolean;
  showFormat: boolean;      // píldora PDF/EPUB/TXT
  showProgress: boolean;
  showTags: boolean;
  showRating: boolean;
}
const DEFAULT_CARD_SETTINGS: KanbanCardSettings = {
  showCover: true, coverLarge: false, showAuthor: true, showYear: false,
  showFormat: true, showProgress: true, showTags: true, showRating: false,
};
```

- Clave localStorage: `'kanban-card-settings'`. Cargar con try/catch y merge
  sobre los defaults (campos nuevos futuros no rompen). Guardar en cada toggle.
- Panel: botón engranaje (`Settings2`) en la cabecera del tablero → popover
  con 8 switches (patrón visual: filas del panel de la tuerca del TTS en
  ReaderView — `bg-[var(--bg-app)]/40 border rounded-xl`). El switch de
  "Tamaño de Portada" se deshabilita si `showCover` está apagado.

**Cabecera del tablero**: título "Tablero de Lectura" + contador total +
engranaje. Altura fija, no scrollea con las columnas (spec §3B).

**Layout responsive** (spec §3A/§3B — SOLO CSS):

```tsx
{/* Móvil: una columna por pantalla con snap táctil nativo.
    PC (lg+): las 5 columnas a lo ancho, sin scroll horizontal general. */}
<div className="flex-1 min-h-0 flex gap-3 overflow-x-auto snap-x snap-mandatory no-scrollbar
                lg:grid lg:grid-cols-5 lg:overflow-x-visible lg:snap-none">
  {KANBAN_COLUMNS.map(col => <KanbanColumn key={col.id} ... />)}
</div>
```

Cada columna: `w-[85vw] max-w-sm shrink-0 snap-center lg:w-auto lg:max-w-none`.

**Botón flotante móvil** (spec §3A): círculo `+` fijo abajo-derecha, solo
`lg:hidden`, abre el selector con columna por defecto `por_leer`:

```tsx
<button onClick={() => setSelectorCol('por_leer')}
  className="lg:hidden fixed bottom-6 right-6 w-14 h-14 bg-[var(--primary)] text-white
             rounded-full shadow-lg flex items-center justify-center z-[70]
             active:scale-95 transition-all border-2 border-white/20">
  <Plus className="w-7 h-7" />
</button>
```

(El FAB genérico del Dashboard se oculta en esta vista — Fase 3.2 — para no
tener dos botones `+` superpuestos.)

**Estado del selector**: `const [selectorCol, setSelectorCol] = useState<KanbanStatus | null>(null);`
(null = modal cerrado; el valor indica a qué columna se añade).

**Drag & drop de escritorio**: estado `draggedId: string | null` en el Board;
los handlers se pasan a columnas/tarjetas (§2.2, §2.3).

### 2.2 `src/components/KanbanColumn.tsx`

**Props**:

```typescript
{
  column: { id: KanbanStatus; title: string; accent: string };
  items: BookItem[];                 // ya filtrados y ordenados por el Board
  settings: KanbanCardSettings;
  tags: TagData[];
  onOpenBook: (id: string) => void;
  onMove: (item: BookItem, dest: KanbanStatus) => void;
  onRemove: (item: BookItem) => void;
  onAdd: () => void;                 // abre el selector para ESTA columna
  draggedId: string | null;
  setDraggedId: (id: string | null) => void;
}
```

**Estructura**:

```tsx
<div
  className={cn("w-[85vw] max-w-sm shrink-0 snap-center lg:w-auto lg:max-w-none",
                "flex flex-col min-h-0 rounded-2xl bg-[var(--bg-card)]/60 border",
                dragOver ? "border-[var(--primary)]/60 bg-[var(--primary)]/5" : "border-[var(--border-card)]")}
  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
  onDragLeave={() => setDragOver(false)}
  onDrop={() => { setDragOver(false); /* Board resuelve draggedId → onMove */ }}
>
  {/* Cabecera fija: puntito accent + título + contador */}
  <div className="flex items-center gap-2 px-3 py-2.5 shrink-0">
    <span className={cn("w-2.5 h-2.5 rounded-full", column.accent)} />
    <h3 className="text-sm font-bold text-[var(--text-main)] flex-1 truncate">{column.title}</h3>
    <span className="text-xs font-bold text-[var(--text-muted)]">{items.length}</span>
  </div>
  {/* Lista con scroll vertical PROPIO (spec §3B) */}
  <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-2 pb-1 space-y-2">
    {items.map(it => <KanbanCard key={it.id} ... />)}
    {items.length === 0 && <p className="text-xs text-[var(--text-muted)] text-center py-6">Sin tarjetas</p>}
  </div>
  {/* Pie fijo */}
  <button onClick={onAdd} className="shrink-0 flex items-center gap-1.5 px-3 py-2.5 text-xs font-bold
    text-[var(--text-muted)] hover:text-[var(--primary)] transition-colors">
    <Plus className="w-4 h-4" /> Añadir tarjeta
  </button>
</div>
```

El `onDrop` real vive en el Board (conoce `draggedId` y el item): la columna
solo notifica. La tarjeta arrastrada se pinta con `opacity-40` (mismo feedback
que la galería de recursos).

### 2.3 `src/components/KanbanCard.tsx`

**Props**: `{ item, settings, tags, currentCol, onOpen, onMove, onRemove, onDragStart, onDragEnd, isDragged }`.

**Reglas de renderizado** (cada campo respeta su switch, spec §3C):

- **Portada** (`showCover` y `item.thumbnailUrl`):
  - `coverLarge === false`: miniatura `w-10 h-14 rounded-md object-cover`
    a la IZQUIERDA del texto (layout `flex gap-2.5`).
  - `coverLarge === true`: imagen `w-full aspect-[3/2] object-cover rounded-t-xl`
    ARRIBA del texto (layout `flex-col`), como las tarjetas con foto de Trello.
  - Sin `thumbnailUrl`: no se reserva espacio (nada de huecos — lección de la
    franja vacía de BookGrid).
- **Título**: siempre visible, `text-[13px] font-bold line-clamp-2`, clic →
  `onOpen()` (abre el libro en el lector).
- **Autor** (`showAuthor`): `text-[11px] text-[var(--primary)] truncate`.
- **Año** (`showYear`): junto al autor, `text-[10px] text-[var(--text-muted)]`.
- **Formato** (`showFormat`): píldora `uppercase text-[9px] font-bold` con
  `item.type` — omitir si `type === 'externa'` (igual que BookGrid).
- **Progreso** (`showProgress`): barra fina de solo lectura
  (`h-1.5 rounded-full bg-slate-200/60` + relleno `bg-[var(--primary)]` al
  `item.progress ?? 0`%) + porcentaje `text-[10px]`. NO usar
  DraggableProgress (la tarjeta es compacta y el drag pelearía con el DnD).
- **Etiquetas** (`showTags`): píldoras pequeñas por cada `item.tags` resuelto
  contra `tags` (TagData). Color vía `colorSwatchProps(tag.color)` de
  `src/lib/utils.ts` (maneja clase Tailwind y hex):
  ```tsx
  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full
                   bg-[var(--bg-app)] border border-[var(--border-card)] text-[9px] font-bold">
    <span className={cn("w-1.5 h-1.5 rounded-full", colorSwatchProps(tag.color).className)}
          style={colorSwatchProps(tag.color).style} />
    {tag.name}
  </span>
  ```
- **Rating** (`showRating`): `<StarRating value={item.rating || 0} size="sm" compact onChange={...}/>`
  (interactivo, igual que la grilla; `onPointerDown stopPropagation` para no
  iniciar un drag).

**Menú ⋯** (spec §3A — imprescindible en móvil):

- Botón `MoreHorizontal` arriba-derecha de la tarjeta → popover propio
  (estado local `menuOpen`, cierre con backdrop transparente `fixed inset-0`).
- Contenido: "Abrir" (BookOpen) · separador · "Mover a: <las 4 columnas
  distintas de `currentCol`>" (cada una con su puntito accent) · separador ·
  "Quitar del tablero" (X, en rojo).
- z-index del popover: `z-50` dentro del board (no hay fullscreen encima).

**Drag** (solo PC — en móvil el menú ⋯ es el camino):

```tsx
<div draggable
     onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; onDragStart(); }}
     onDragEnd={onDragEnd}
     className={cn("bg-[var(--bg-card)] rounded-xl border border-[var(--border-card)] shadow-sm",
                   "transition-all duration-200 animate-in fade-in",
                   isDragged && "opacity-40")}>
```

La tarjeta ENTERA es arrastrable (a diferencia de la galería de recursos no
hay barra de tiempo con la que pelear; el rating y el menú frenan el drag con
`stopPropagation` en `onPointerDown`).

### 2.4 `src/components/KanbanSelectorModal.tsx`

**Props**: `{ targetCol: KanbanStatus; columnTitle: string; items: BookItem[]; onPick: (item: BookItem) => void; onClose: () => void }`.

**Comportamiento** (spec §4):

- Modal centrado `fixed inset-0 z-[100] bg-slate-900/60 backdrop-blur-sm`
  (patrón del modal de colores de CitationsManager). Cierre: X, clic en el
  fondo y tecla Escape.
- Input de búsqueda con `autoFocus`; filtro reactivo en cada tecla sobre
  título Y autor, insensible a mayúsculas y tildes:
  ```typescript
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const q = norm(query);
  const results = items.filter(i => !i.deletedAt && (norm(i.title).includes(q) || norm(i.author ?? '').includes(q)));
  ```
  Con el input vacío se listan los primeros ~50 (más recientes primero) — el
  tablero también sirve para descubrir qué añadir.
- Cada resultado: miniatura (si hay) + título + autor + a la derecha:
  - Si `columnOf(item) !== null` → atenuado (`opacity-50`) con etiqueta
    "Ya en: <columna>"; al elegirlo IGUAL se mueve a la columna destino
    (elegir = decidir dónde va).
  - Si no está en el tablero → botón implícito: toda la fila es clickeable.
- `onPick`: el Board ejecuta `moveTo(item, targetCol)` y cierra el modal. La
  tarjeta aparece de inmediato (estado local de useLibrary ya es optimista).
- Excepción de sincronía al AÑADIR (no al mover): si se añade a una columna
  distinta de `leido` un libro con `read === true`, `moveTo` ya pone
  `read: false` — coherente con la regla "read manda". No hay caso especial.

---

## Fase 3 — Integración (2 archivos)

### 3.1 `src/components/Sidebar.tsx`

- Import: agregar `SquareKanban` al import de lucide-react (línea 18;
  verificado disponible en lucide-react 0.546).
- Insertar ANTES del botón "Análisis" (≈ línea 566), copiando su estructura
  exacta (misma clase, mismo patrón activo/inactivo):

```tsx
      {/* Tablero Kanban de progreso de lectura */}
      <button
        onClick={() => { setActiveTab('kanban'); setActivePlaylist(null); setActiveStage(null); }}
        className={cn(
          "flex items-center gap-3 px-3 py-2 rounded-lg transition-colors w-full",
          collapsed ? "justify-center" : "",
          activeTab === 'kanban' ? "bg-white/10 text-white font-medium" : "text-white/80 hover:bg-white/5 hover:text-white font-medium"
        )}
        title={collapsed ? "Tablero" : undefined}
      >
        <SquareKanban className="w-5 h-5 opacity-80 shrink-0" />
        {!collapsed && <span className="truncate text-sm">Tablero</span>}
      </button>
```

- Revisar si Sidebar cierra el drawer móvil al elegir Análisis/Papelera
  (algún `setSidebarOpen(false)` en el flujo); replicar el mismo
  comportamiento para 'kanban'.

### 3.2 `src/components/Dashboard.tsx`

- Import: `import { KanbanBoard } from './KanbanBoard';`
- Línea ≈191 — ocultar el FAB genérico también en el tablero (tiene el suyo):

```tsx
{activeTab !== 'trash' && activeTab !== 'analytics' && activeTab !== 'kanban' && (
```

- Línea ≈242 — nueva rama del ternario:

```tsx
{activeTab === 'analytics' ? (
    <AnalyticsDashboard />
) : activeTab === 'kanban' ? (
    <KanbanBoard onOpenBook={onOpenBook} />
) : activeTab === 'trash' ? (
```

- El contenedor padre (línea ≈241) es `overflow-y-auto`: KanbanBoard debe
  ocupar el alto disponible (`h-full flex flex-col`) y gestionar su propio
  overflow interno (columnas con scroll propio). Si el padre interfiere con
  el `min-h-0`, envolver la rama kanban con `h-full` — verificar en vivo.
- La Toolbar sigue visible (búsqueda global, perfil). La búsqueda de la
  Toolbar NO filtra el tablero en v1 (el tablero tiene su buscador en el
  modal); no tocar la Toolbar.

---

## Fase 4 — Orden dentro de cada columna

- v1: orden ESTABLE por `timestamp` descendente (más reciente primero) dentro
  de cada columna. NO se implementa reordenamiento manual intra-columna
  (la spec no lo pide; el drag entre columnas sí).
- Si en el futuro se pide orden manual, se reutilizará `listIndex` (ya existe
  en BookItem) — dejar el sort en una función única `sortColumn(items)` para
  que el cambio sea de una línea.

---

## Fase 5 — Reglas de sincronización (resumen normativo)

| Acción | Efecto |
|---|---|
| Mover a "Leído" | `kanbanStatus:'leido'`, `read:true`, `progress:100`, `toRead:false` |
| Mover a "Por leer" | `kanbanStatus:'por_leer'`, `read:false`, `toRead:true` |
| Mover a Pendiente / En curso / Detenido | `kanbanStatus:<col>`, `read:false`, `toRead:false` |
| Quitar del tablero | `kanbanStatus:null` — NO toca read/toRead/progress |
| Libro del tablero marcado leído desde otra parte | Se MUESTRA en "Leído" (derivado, `columnOf`) sin escribir nada |
| Libro leído que se arrastra fuera de "Leído" | `moveTo` reescribe `read:false` → todo vuelve a ser coherente |
| Marcar leído un libro que NO está en el tablero | Nada (no se agrega solo) |

`progress` NUNCA se baja al sacar de "Leído" (perder el avance real sería
destructivo); solo se sube a 100 al entrar a "Leído".

---

## Fase 6 — Verificación (antes del commit)

Compilación:
- `npx tsc --noEmit` limpio.
- `npm run build` limpio.

Funcional (en dev, `npm run dev`):
1. Sidebar → "Tablero": abre con 5 columnas vacías y sus contadores en 0.
2. "+ Añadir tarjeta" en "En curso" → modal → buscar por título con tilde y
   sin tilde → elegir → la tarjeta aparece en "En curso" al instante.
3. Grilla normal: ese libro ahora NO está "leído" ni "por leer" (regla de
   sincronía de columna intermedia).
4. Mover con menú ⋯ a "Leído" → en la grilla el libro queda con check verde
   y 100% de progreso.
5. Marcar "no leído" desde la grilla → la tarjeta vuelve a su columna
   guardada;  marcarlo "leído" → la tarjeta se muestra en "Leído".
6. PC: arrastrar una tarjeta entre columnas (feedback: columna resaltada,
   tarjeta al 40%). Soltar fuera de una columna no rompe nada.
7. Móvil (DevTools + dispositivo real): swipe entre columnas con snap, una
   columna por pantalla; FAB `+` abre el selector; menú ⋯ mueve de columna.
8. Engranaje: cada switch cambia la tarjeta EN VIVO; recargar la página
   conserva la configuración; "Tamaño de portada" deshabilitado si
   "Mostrar portada" está apagado.
9. Portada grande vs pequeña: sin huecos cuando el libro no tiene portada.
10. Modo oscuro: tablero, tarjetas, popovers y modal legibles (tokens).
11. Quitar del tablero → desaparece del tablero y el libro NO cambia sus
    estados en la grilla.

Entrega:
- 1 commit (`feat: tablero kanban de progreso de lectura (5 columnas, sync con estados)`)
  con coautor Claude, mensaje descriptivo.
- push SOLO con confirmación del usuario.
- Actualizar `CONTEXTO_DESARROLLO.md` (sección de features) en el mismo
  commit o en uno de docs posterior.

---

## Archivos

| Archivo | Acción | Tamaño estimado |
|---|---|---|
| `src/types.ts` | +6 líneas (`KanbanStatus`, campo en BookItem) | trivial |
| `src/components/KanbanBoard.tsx` | NUEVO | ~180 líneas |
| `src/components/KanbanColumn.tsx` | NUEVO | ~90 líneas |
| `src/components/KanbanCard.tsx` | NUEVO | ~170 líneas |
| `src/components/KanbanSelectorModal.tsx` | NUEVO | ~110 líneas |
| `src/components/Sidebar.tsx` | +16 líneas (entrada "Tablero") | menor |
| `src/components/Dashboard.tsx` | +4 líneas (rama + FAB) | menor |
| Servidor / hooks / BookGrid | SIN CAMBIOS | — |

## Riesgos conocidos y mitigación

- **`min-h-0` en cadenas flex**: el scroll vertical por columna exige
  `min-h-0` en cada ancestro flex (bug clásico); verificar en el punto 3.2.
- **Drag nativo en Windows/Chrome** dispara `dragleave` al pasar sobre hijos:
  el resaltado de columna usa un contador o se tolera el parpadeo (cosmético).
- **Items legacy sin `tags`/`progress`**: todos los accesos con `?? 0` /
  `?? []` (los campos son opcionales en BookItem).
- **read=true con kanbanStatus viejo**: cubierto por `columnOf` (derivación),
  no requiere migración de datos.
