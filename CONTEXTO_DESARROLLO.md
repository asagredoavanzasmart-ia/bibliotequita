# Biblioteca — Contexto Completo de Desarrollo

> Documento de contexto para IAs y desarrolladores que continúen este proyecto.
> Última actualización: 2026-07-18 | Commit: 53e53bd

---

## 1. ¿Qué es Biblioteca?

**Biblioteca** es una aplicación web personal de gestión de libros digitales y recursos complementarios.

### Características principales:
- **Lectura digital**: PDF, EPUB, TXT con citas, resaltados, TTS (Text-to-Speech)
- **Recursos multimedia**: videos, audios (MP3, WAV→MP3 auto, M4A, etc.), imágenes, presentaciones (PPT, PPTX, ODP, PDF)
- **Auditoría Científica**: análisis epistemológico de estudios PDF (verdad/sesgo/metodología)
- **Control remoto Bluetooth**: mando pasa-páginas en el lector (frase/página/cita)
- **Notas y citas**: con 5 colores, persistentes, exportables

---

## 2. Stack Tecnológico

### Frontend (React + TypeScript)
- **Lectura**: PDF (pdfjs), EPUB v2 (motor propio sin iframes), TXT (nativo)
- **UI**: Tailwind CSS, Lucide Icons, shadcn/ui
- **Estado**: React hooks + Supabase (notas, citas, bookmarks)
- **Audio**: Web Audio API + ElevenLabs/Google TTS

### Backend (Node.js + Express)
- **Servidor**: Express, TypeScript
- **Base de datos**: Supabase (PostgreSQL)
- **Auth**: Google OAuth + JWT sessions
- **Upload**: Multer (whitelist estricta ext+MIME)
- **Media**: ffmpeg (compresión WAV→MP3), sharp (miniaturas PDF/EPUB)
- **IA**: Google Gemini (Auditoría, resúmenes de citas)

### DevOps
- **Hosting**: Railway (CI/CD automático)
- **Docker**: Multi-stage (builder + runtime)
- **Contenedor**: Node 22 Alpine + ffmpeg + librerías gráficas

---

## 3. Sesiones Anteriores: Features Implementadas (2026-07-15 a 2026-07-18)

### 3.1 Auditor Científico — Fix JSON Truncado (ba80ff2)
**Problema**: Gemini devolvía JSON cortado en la Parte C (18 criterios), error 400 previo eliminado.

**Solución**:
- Config: `maxOutputTokens: 65536`, `thinkingConfig: { thinkingBudget: 1024 }`
- `repairJson()`: recupera JSON truncado cortando la propiedad a medias y cerrando llaves/corchetes
- Reintento UNA vez solo la parte que falló
- Diagnóstico: error devuelve `finishReason`, tokens gastados, últimos 200 caracteres

**Verificación**: 16 tests unitarios del reparador (casos de truncamiento)

---

### 3.2 UI — Cuatro Pedidos Consolidados (cc6cb9b)
#### a) Botonera superior en móvil sin cortes
- **Antes**: overflow-x-auto invisible → botón cortado (Análisis desaparecía)
- **Ahora**: `min-h-14 + flex-wrap` → segunda fila si no cabe
- Botones compactados `p-1.5 sm:p-2`

#### b) TTS del Auditor en la botonera superior
- Botón "Leer/Pausar" veredicto en el header del panel (NO al pie del resultado)
- Misma lógica que recursos de texto: solo TTS, sin mecanismo de citas

#### c) Galería de recursos arrastrable para todo
- **Textos, audios, imágenes**: grilla (2-3 columnas) + reorden por arrastre
- Manija **⋮⋮** en el pie (no la tarjeta entera, para no pelear con barra de tiempo)
- `listIndex` persistido (mismo campo que BookGrid)

#### d) Resumen IA → Recursos automático
- Al generar resumen desde citas, se guarda AUTOMÁTICAMENTE en Recursos/Textos
- Título: `"Resumen IA (Breve) · 18-07-2026"` (tipo + fecha)
- Botón manual sigue para versión editada

---

### 3.3 Control Remoto Bluetooth (6a70c00)
**Dispatcher único** para dos vías de entrada:
- **Teclado BT** (mandos pasa-páginas): flechas, RePág/AvPág
- **Media Session** (auriculares): previoustrack/nexttrack

**Tres funciones**:
1. **1 pulsación adelante/atrás**: frase siguiente/anterior (TTS activo) o página (TTS off)
   - En borde de página → cambia página automáticamente
2. **2 pulsaciones seguidas** (≤350 ms): página siguiente/anterior
3. **Mantener presionado** (≥600 ms): cita en **GRIS** (o ROJO si no hay gris, o primer color)

**Detección de colores**: por nombre (`/gris|gray/`) o hex (desaturado = gris, canal R dominante = rojo)

---

### 3.4 Pantalla Completa — Doble Clic/Tap (4eee351)
- **Antes**: tap simple alternaba botonera (aparecía sin querer)
- **Ahora**: doble clic/tap (≤350 ms) en PDF/TXT igual que EPUB v2
- Si el doble clic selecciona palabra (doble-click nativo), no alterna (se interpreta como cita)

---

### 3.5 Presentaciones en Recursos (e3dfc95)
Nueva categoría **"Presentaciones"** con lógica de galería:

**Formatos soportados**:
- `.pdf` → abre con lector propio (zoom, pantalla completa, citas, TTS)
- `.ppt, .pptx, .pps, .ppsx` → se descargan (app de presentaciones local)
- `.odp` (LibreOffice) → idem
- `.key` (Keynote) → idem

**Por qué no Google Slides/Office Online**: el archivo jamás sale del servidor propio

**Seguridad**: whitelist estricta extension+MIME (binarios inertes, no XSS)

---

### 3.6 WAV → MP3 Automático en Docker (357711a)
**Problema**: WAV pesa ~600 MB/hora, MP3 ~55 MB. Usuario tiene que convertir antes.

**Solución**:
- **Dockerfile**: `ffmpeg` en imagen runtime (`apk add ffmpeg`)
- **server.ts**: `convertWavToMp3()` al recibir un `.wav`
  - execFile sin shell (array de args, nombre UUID del servidor)
  - Timeout 15 min
  - Si ffmpeg falta/falla → WAV se guarda tal cual (fallback seguro)
- **Tope especial**: `MAX_WAV_UPLOAD_MB=800` (vs `MAX_UPLOAD_MB=200` para el resto)
  - El WAV grande tiene que llegar entero para comprimirse
  - Otros tipos se pre-rechazan en cliente; WAV se rechaza en servidor apenas termina
- **Cliente**: `getMaxWavUploadMb()` + mensajes acordes

**Flujo**:
1. Usuario sube WAV de 600 MB
2. Barra de progreso llega al 100 % (subida)
3. Servidor: execFile ffmpeg (espera ~2-5 min)
4. Respuesta: URL del `.mp3` (~55 MB)

---

## 3.7 Ondas de Audio en Vivo + Velocidad 0.5×–2× (1fd518a)

**Visualizador de ondas en tiempo real** (reproductor de audio en Recursos):
- Web Audio API nativo (`AnalyserNode`): barras que se mueven con el sonido real
- Conectado al MISMO `<audio>` que ya suena → cero descargas extra, cero RAM
- Si el AudioContext falla, el audio sigue sonando normal (visualizador nunca es crítico)
- Canvas de 64 barras (fluido y ligero)

**Control de velocidad 0.5×, 1×, 1.25×, 1.5×, 2×**:
- **MediaPlayer** (audio y video, incluye YouTube): botón único a la izquierda que recorre velocidades en ciclo
- **TTS** (libros y recursos): fila de chips en la tuerca de opciones, persistida en localStorage
- **YouTube**: via `postMessage` + `setPlaybackRate`; sin dependencias nuevas

---

## 3.8 Administrador de Citas con Pestañas por Fuente (53e53bd)

**Menú de fuentes** (lado izquierdo en PC; fila móvil):
- "Todas" — libro + recursos juntos
- "Libro · [título]"
- Una pestaña por cada recurso CON citas: "Video · Entrevista", "Audio · Clase 3", "Texto · Resumen IA…"

**Comportamiento**:
- Renombrar recurso → pestaña se actualiza sola (título fresco del listado)
- "Todas" + agrupado por color: los grupos **mezclan** citas de todas las fuentes sin discriminar
- "Todas" sin agrupar: libro primero, luego divisor "Citas de recursos" con cada recurso bajo su encabezado
- Fuente concreta: solo sus citas; filtro de color y agrupación aplican igual que en libro
- Recurso borrado → pestaña desaparece, vista vuelve a "Todas" sola
- Editar/borrar/mover citas reutiliza mutaciones aisladas (`saveResourceNotes` y cia) — nunca se mezclan con notas del libro

---

## 4. Cómo Cambios Logran Reconstruirse en Railway

**Railway detecta automáticamente**:
- Push a `origin/main` → webhook de GitHub
- Descarga commit nuevo
- Lee `Dockerfile` (cambió → agregar ffmpeg)
- **Rebuild automático**: corre `docker build`
- **Redeploy automático**: mata contenedor viejo, corre el nuevo

**Resultado**: sin hacer nada más, el VPS tiene ffmpeg y la compresión funciona.

---

## 5. Archivos Críticos Modificados en Esta Sesión

| Archivo | Cambios | Commit |
|---------|---------|--------|
| `server.ts` | Auditor JSON repair, WAV→MP3, topes | ba80ff2, 357711a |
| `src/components/ReaderView.tsx` | Botonera wrap, TTS Auditor, Control BT, doble-tap | cc6cb9b, 6a70c00, 4eee351 |
| `src/components/ResourcesPanel.tsx` | Galería arrastrable, resumen auto, presentaciones, WAV client | cc6cb9b, e3dfc95, 357711a |
| `src/components/AuditorPanel.tsx` | TTS veredicto en header | cc6cb9b |
| `src/types.ts` | `ResourceKind = 'slides'` | e3dfc95 |
| `Dockerfile` | ffmpeg en runtime | 357711a |
| `src/lib/uploadFile.ts` | `getMaxWavUploadMb()` | 357711a |

---

## 6. Ramas de Respaldo Creadas

Antes de cada feature importante, se crea rama `respaldo-pre-*`:
- `respaldo-pre-ui4-2026-07-18` (4 cambios UI)
- `respaldo-pre-bluetooth-2026-07-18` (Control BT)
- `respaldo-pre-dobletap-2026-07-18` (Doble tap)
- `respaldo-pre-presentaciones-2026-07-18` (Presentaciones)
- `respaldo-pre-wav2mp3-2026-07-18` (WAV→MP3)
- `respaldo-pre-velocidad-ondas-2026-07-18` (Velocidad + ondas)
- `respaldo-pre-citas-fuentes-2026-07-18` (Citas por fuente)

**Por qué**: si hay problema, `git checkout respaldo-pre-*` revierte a estado previo sin merges complicados.

---

## 7. Verificaciones Hechas

✅ `npx tsc --noEmit` — sin errores TypeScript  
✅ `npm run build` — build exitoso  
✅ 16 tests unitarios repairJson (truncamiento JSON)  
✅ 32 tests unitarios normalizeAudit (schema enforcement)  
✅ Commits con mensaje descriptivo + coautor Claude  

**No verificado en entorno local** (imposible sin network):
- Conversión WAV→MP3 real (ejecuta ffmpeg en Docker del VPS)
- Llamada real a Gemini (Auditor, resúmenes)

---

## 8. Cómo Continuar Desarrollo

### Si quieres agregar una feature:
1. **Crear rama de respaldo**: `git branch respaldo-pre-<feature>-$(date +%Y-%m-%d)`
2. **Editar/escribir** código
3. **Verificar**: `tsc --noEmit && npm run build`
4. **Commitear**: mensaje descriptivo, si es en server.ts + coautor
5. **Hacer push**: confirmación antes (`git push origin main`)
6. **Railway redeploy**: automático en ~2-5 min

### Si algo falla en Railway:
1. **Revisar logs**: "Registros" en el panel de Railway
2. **Rollback seguro**: `git checkout respaldo-pre-*` + push
3. **Investigar**: error en los logs vs. cambio que hiciste

### Si modificas el Dockerfile:
- Railway reconstruirá la imagen automáticamente
- Si agregas dependencias (`apk add`), espera ~3-5 min más en el build

---

## 9. Configuración y Secretos

**En Railway (Environment)** (NO en código):
```
DATABASE_URL=postgresql://...  # Supabase
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_API_KEY=...             # Gemini
DELETE_TOKEN=...               # Token para borrar archivos
MAX_UPLOAD_MB=200
MAX_WAV_UPLOAD_MB=800          # Nuevo para WAV
UPLOAD_DIR=/app/uploads        # En Docker
```

**No cambies** estos valores sin entender el impacto (especialmente `MAX_*`).

---

## 10. Estado Actual & Próximos Pasos

### Verificado en vivo (Sesión anterior):
✅ UI de 4 cambios (botonera, TTS, galería, resumen)  
✅ Control Bluetooth (frase/página/cita gris)  
✅ Pantalla completa (doble-tap)  
✅ Presentaciones (galería arrastrable)  
✅ Compilación server (Auditor repair, WAV config)  

### Esta sesión (2026-07-18, tras contexto):
✅ Ondas de audio en vivo (AnalyserNode Web Audio API)  
✅ Velocidad 0.5×–2× en MediaPlayer (audio, video, YouTube)  
✅ Velocidad 0.5×–2× en TTS (tuerca de opciones, localStorage persistido)  
✅ Administrador de citas con pestañas por fuente (libro + recursos)  
✅ Renombrar recurso → pestaña se actualiza sola  
✅ Agrupación por color: "Todas" mezcla recursos sin discriminar  
✅ Compilación: `tsc --noEmit` + `npm run build` limpios  
✅ Push a origin/main (Railway redeploy automático en ~2-5 min)  

### Pendiente en vivo:
⏳ **Conversión WAV→MP3**: en Railway (ffmpeg ya está, redeploy en progreso)  
⏳ **Auditor Repair**: en Railway  
⏳ **Ondas de audio**: en Railway (verifica que canvas se vea fluido)  

### Para siguiente sesión:
1. **Probar WAV → MP3 en Railway** (subir un .wav, verificar que llegue .mp3)
2. **Auditar un PDF** (verificar que repair funcione y diagnóstico sea útil)
3. **Mando Bluetooth**: probar con tu control remoto (qué teclas envía)
4. **Ondas de audio**: verifica que se vean al reproducir en Recursos
5. **Velocidad**: prueba 0.5× / 2× en TTS, MediaPlayer y YouTube

---

## 11. Errores Conocidos & Workarounds

| Problema | Causa | Solución |
|----------|-------|----------|
| Botonera cortada en móvil | overflow-x-auto sin scrollbar | ✅ Arreglado (flex-wrap) |
| TTS Auditor al pie | UI lejana del código | ✅ Movido a header |
| JSON truncado Auditor | Thinking tokens sin acotar | ✅ Repair + reintento |
| WAV no comprimido | ffmpeg no en imagen vieja | ⏳ Redeploy Docker |
| Botón Análisis desaparece | No había espacio en botonera | ✅ Segunda fila |

---

## 12. Contacto & Documentación Externa

- **Repo GitHub**: https://github.com/asagredoavanzasmart-ia/bibliotequita
- **Railway Dashboard**: (screenshot: influenciadores_app → bibliotech)
- **Supabase Console**: (credenciales en Railway)
- **Google Cloud Console**: (para GOOGLE_API_KEY)

---

## Fin del Contexto

Este documento resume el **estado exacto** del proyecto tras ~6 horas de desarrollo intenso. 

Próxima IA o desarrollador: lean esto primero, miren los commits (son autoexplicativos), y procedan con confianza.

**¿Dudas?** El código tiene comentarios internos (no es autoexplicativo, pero sí anotado en puntos críticos).

---

**Última actualización**: 2026-07-18 (post-push)  
**Por**: Claude Code + Usuario (avanzasmartgrowth)  
**Rama**: main @ 53e53bd (2 commits nuevos desde anterior actualización)
