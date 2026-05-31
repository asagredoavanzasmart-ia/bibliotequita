// =============================================================================
// server.ts — Backend Express + Vite (dev) + Gemini AI
// -----------------------------------------------------------------------------
// Único proceso. En dev sirve la SPA con vite middleware; en prod sirve los
// archivos estáticos de dist/. Diseñado para correr detrás de Nginx en un VPS.
//
// Endpoints expuestos a la SPA:
//   POST   /api/upload         (multer → uploads/<uuid>.<ext>)
//   GET    /api/files/:name    (stream del archivo)
//   DELETE /api/files/:name    (elimina del disco)
//   GET    /api/proxy-resource (CORS bypass — sólo http/https públicos)
//   POST   /api/analyze-pdf    (Gemini extrae metadatos de texto)
//   POST   /api/analyze-url    (Gemini analiza HTML scrapeado)
//   POST   /api/analyze-image  (Gemini analiza portada base64)
//   POST   /api/gemini/summarize (Gemini resume citas)
//   GET    /api/health         (probe para load balancer / pm2)
//
// Variables de entorno relevantes (ver .env.example):
//   PORT, HOST, NODE_ENV
//   UPLOAD_DIR, MAX_UPLOAD_MB
//   CORS_ORIGIN ("*" en dev, "https://midominio.com" en prod)
//   GEMINI_API_KEY
//   RATE_LIMIT_WINDOW_MIN, RATE_LIMIT_MAX  (rate-limit global)
//   AI_RATE_LIMIT_WINDOW_MIN, AI_RATE_LIMIT_MAX  (más estricto para /api/gemini)
//   ALLOW_PROXY_HOSTS  (whitelist opcional: "example.com,arxiv.org")
//   TRUST_PROXY  ("1" si estás detrás de Nginx, para que express lea X-Forwarded-For)
// =============================================================================

import express, { Request, Response, NextFunction } from "express";
import path from "path";
import fs from "fs";
import dns from "dns/promises";
import net from "net";
import multer from "multer";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { randomUUID } from "crypto";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import { GoogleAuth } from "google-auth-library";
import dotenv from "dotenv";

dotenv.config();

// -----------------------------------------------------------------------------
// Config desde env
// -----------------------------------------------------------------------------
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const NODE_ENV = process.env.NODE_ENV || "development";
const IS_PROD = NODE_ENV === "production";

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || "./uploads");
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 200);

const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";

const RATE_LIMIT_WINDOW_MIN = Number(process.env.RATE_LIMIT_WINDOW_MIN || 15);
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || 300);
const AI_RATE_LIMIT_WINDOW_MIN = Number(process.env.AI_RATE_LIMIT_WINDOW_MIN || 5);
const AI_RATE_LIMIT_MAX = Number(process.env.AI_RATE_LIMIT_MAX || 30);

const ALLOW_PROXY_HOSTS = (process.env.ALLOW_PROXY_HOSTS || "")
  .split(",")
  .map(h => h.trim().toLowerCase())
  .filter(Boolean);

const TRUST_PROXY = process.env.TRUST_PROXY === "1";

const apiKey = process.env.GEMINI_API_KEY || "";
if (!apiKey && IS_PROD) {
  console.warn("[WARN] GEMINI_API_KEY no configurada — los endpoints /api/analyze-* y /api/gemini/summarize devolverán error.");
}
const ai = new GoogleGenAI({ apiKey: apiKey || "missing", apiVersion: "v1beta" });

// -----------------------------------------------------------------------------
// Almacenamiento de archivos en disco (uploads/)
// -----------------------------------------------------------------------------
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

function safeExt(name: string): string {
  const m = /\.([a-zA-Z0-9]{1,8})$/.exec(name);
  return m ? "." + m[1].toLowerCase() : "";
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => cb(null, randomUUID() + safeExt(file.originalname)),
  }),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
});

// -----------------------------------------------------------------------------
// Helpers de validación
// -----------------------------------------------------------------------------
function reqString(v: unknown, max = 50000): string | null {
  if (typeof v !== "string") return null;
  if (v.length === 0 || v.length > max) return null;
  return v;
}

// Whitelist de nombres de archivo para evitar path traversal.
const FILENAME_RE = /^[A-Za-z0-9._-]{1,128}$/;

// Detecta IPs/hostnames a los que NO debemos hacer fetch desde el server
// (anti-SSRF). Bloquea: localhost, loopback, link-local, privadas, multicast,
// metadata services, etc.
function isPrivateIP(ip: string): boolean {
  if (!net.isIP(ip)) return false;
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local + AWS/GCP metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 0) return true;
    if (a >= 224) return true; // multicast / reserved
    return false;
  }
  // IPv6: bloquear loopback ::1, fc00::/7 (ULA), fe80::/10 (link-local), ::
  const v = ip.toLowerCase();
  if (v === "::1" || v === "::") return true;
  if (v.startsWith("fc") || v.startsWith("fd")) return true;
  if (v.startsWith("fe80")) return true;
  if (v.startsWith("::ffff:")) {
    // IPv4-mapped IPv6: validar la parte IPv4
    return isPrivateIP(v.replace("::ffff:", ""));
  }
  return false;
}

async function isSafePublicUrl(rawUrl: string): Promise<{ ok: true; url: URL } | { ok: false; reason: string }> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "URL inválida" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: "Sólo http y https permitidos" };
  }
  const hostname = parsed.hostname.toLowerCase();
  if (!hostname) return { ok: false, reason: "Hostname vacío" };

  // Whitelist explícita gana.
  if (ALLOW_PROXY_HOSTS.length > 0) {
    const allowed = ALLOW_PROXY_HOSTS.some(h => hostname === h || hostname.endsWith("." + h));
    if (!allowed) return { ok: false, reason: "Host no permitido (no está en ALLOW_PROXY_HOSTS)" };
  }

  // Bloquear hostnames sospechosos por nombre directo.
  if (["localhost", "ip6-localhost", "ip6-loopback"].includes(hostname)) {
    return { ok: false, reason: "Host privado bloqueado" };
  }

  // Si ya es una IP, validar directo.
  if (net.isIP(hostname)) {
    if (isPrivateIP(hostname)) return { ok: false, reason: "IP privada bloqueada" };
    return { ok: true, url: parsed };
  }

  // Resolver DNS y comprobar TODAS las IPs.
  try {
    const addrs = await dns.lookup(hostname, { all: true });
    if (addrs.length === 0) return { ok: false, reason: "DNS sin respuesta" };
    for (const a of addrs) {
      if (isPrivateIP(a.address)) {
        return { ok: false, reason: "El host resuelve a una IP privada" };
      }
    }
  } catch {
    return { ok: false, reason: "Fallo de resolución DNS" };
  }
  return { ok: true, url: parsed };
}

async function generateContentWithRetry(options: any, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await ai.models.generateContent(options);
    } catch (error: any) {
      if (error?.status === "UNAVAILABLE" || error?.status === 503) {
        if (i === maxRetries - 1) throw error;
        const waitTime = Math.pow(2, i) * 1000;
        console.log(`Model unavailable, retrying in ${waitTime}ms...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      } else {
        throw error;
      }
    }
  }
}

// -----------------------------------------------------------------------------
// App
// -----------------------------------------------------------------------------
async function startServer() {
  const app = express();

  // Si estás detrás de Nginx en un VPS, esto hace que rate-limit y los logs
  // vean la IP real del cliente vía X-Forwarded-For.
  if (TRUST_PROXY) app.set("trust proxy", 1);

  // Security headers. CSP relajado: la app carga Google Fonts y blobs PDF.
  app.use(
    helmet({
      contentSecurityPolicy: IS_PROD
        ? {
            useDefaults: true,
            directives: {
              "default-src": ["'self'"],
              "script-src": ["'self'"],
              "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
              "font-src": ["'self'", "https://fonts.gstatic.com", "data:"],
              "img-src": ["'self'", "data:", "blob:", "https:"],
              "connect-src": ["'self'", "https://generativelanguage.googleapis.com"],
              "worker-src": ["'self'", "blob:"],
              "frame-src": ["'self'", "https:"],
            },
          }
        : false, // En dev, deshabilitado para que Vite HMR funcione.
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: "cross-origin" },
    }),
  );

  app.use(cors({ origin: CORS_ORIGIN, credentials: false }));

  app.use(express.json({ limit: "50mb" }));

  // Rate limit global (todas las rutas /api/*).
  const apiLimiter = rateLimit({
    windowMs: RATE_LIMIT_WINDOW_MIN * 60 * 1000,
    max: RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Demasiadas solicitudes. Intenta de nuevo más tarde." },
  });
  app.use("/api/", apiLimiter);

  // Rate limit más agresivo para llamadas a Gemini (cuestan dinero).
  const aiLimiter = rateLimit({
    windowMs: AI_RATE_LIMIT_WINDOW_MIN * 60 * 1000,
    max: AI_RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Demasiadas peticiones de IA. Espera antes de seguir." },
  });

  // -------------------------------------------------------------------------
  // Health check
  // -------------------------------------------------------------------------
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, env: NODE_ENV, time: new Date().toISOString() });
  });

  // -------------------------------------------------------------------------
  // Files: upload / download / delete
  // -------------------------------------------------------------------------
  app.post("/api/upload", upload.single("file"), (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "No se recibió archivo" });
    }
    res.json({
      url: `/api/files/${req.file.filename}`,
      name: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size,
      mimeType: req.file.mimetype,
    });
  });

  app.get("/api/files/:name", (req, res) => {
    const name = req.params.name;
    if (!FILENAME_RE.test(name)) {
      return res.status(400).json({ error: "Nombre inválido" });
    }
    const filePath = path.join(UPLOAD_DIR, name);
    // Defensa en profundidad: garantizar que el path resuelto está dentro de UPLOAD_DIR.
    if (!filePath.startsWith(UPLOAD_DIR + path.sep)) {
      return res.status(400).json({ error: "Ruta fuera del directorio permitido" });
    }
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "Archivo no encontrado" });
    }
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.sendFile(filePath);
  });

  app.delete("/api/files/:name", (req, res) => {
    const name = req.params.name;
    if (!FILENAME_RE.test(name)) {
      return res.status(400).json({ error: "Nombre inválido" });
    }
    const filePath = path.join(UPLOAD_DIR, name);
    if (!filePath.startsWith(UPLOAD_DIR + path.sep)) {
      return res.status(400).json({ error: "Ruta fuera del directorio permitido" });
    }
    if (fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch (err) {
        console.warn("No se pudo borrar archivo:", err);
      }
    }
    res.json({ ok: true });
  });

  // -------------------------------------------------------------------------
  // Proxy de recursos externos (PDF, etc.) — anti-SSRF
  // -------------------------------------------------------------------------
  app.get("/api/proxy-resource", async (req, res) => {
    const url = reqString(req.query.url, 2048);
    if (!url) return res.status(400).json({ error: "URL es requerida" });

    const check = await isSafePublicUrl(url);
    if (check.ok === false) return res.status(400).json({ error: check.reason });

    try {
      const response = await fetch(check.url.toString(), {
        // 15 s de timeout para evitar conexiones colgadas.
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) {
        return res.status(response.status).json({ error: "No se pudo obtener el recurso" });
      }
      const buffer = await response.arrayBuffer();
      const contentType = response.headers.get("content-type") || "application/octet-stream";
      res.setHeader("Content-Type", contentType);
      res.send(Buffer.from(buffer));
    } catch (error) {
      console.error("Error proxying resource:", error);
      res.status(502).json({ error: "Fallo al obtener el recurso" });
    }
  });

  // -------------------------------------------------------------------------
  // Gemini endpoints (con rate limit propio)
  // -------------------------------------------------------------------------
  app.post("/api/analyze-pdf", aiLimiter, async (req, res) => {
    const text = reqString(req.body?.text, 200000);
    if (!text) return res.status(400).json({ error: "Texto requerido (no vacío, máx 200k)" });

    try {
      const response = await generateContentWithRetry({
        model: "gemini-2.5-flash",
        contents: `Analiza este texto correspondiente a las primeras páginas de un libro (que incluye la portada, créditos, copyright, colofón y la página de descripción editorial) y extrae de forma extremadamente concisa y precisa los siguientes campos en formato JSON.

REGLA CRÍTICA DE BÚSQUEDA:
Si no encuentras el ISBN en la primera página o portada, es imperativo que lo busques detalladamente en el texto de las páginas siguientes (especialmente de la página 2 a la 5). Recuerda que las editoriales siempre incluyen una página con toda la descripción editorial, los años de copyright, la editorial y la materia; es allí donde reside el ISBN, el año de publicación, el nombre de la editorial y el área temática o materia. Por lo tanto, analiza minuciosamente todas las páginas provistas.

Este texto es estándar de registro legal de propiedad intelectual. Busca patrones comunes como "©", "Copyright", "ISBN", "Editorial", "Impreso en / Printed in", "Edición", "Año", etc., especialmente en bloques compactos de texto.

Campos a extraer:
1. Título (title): El título del libro.
2. Autor (author): Nombre de los autores.
3. Año de publicación (year): El año de copyright o de edición (ej: "2018", "1994"). Aunque esté rodeado de texto legal o de reimpresión, identifícalo y extrae solo las 4 cifras del año más representativo.
4. Editorial (publisher): El nombre de la editorial comercial que publica el libro.
5. ISBN (isbn): Código ISBN-10 o ISBN-13 (ej: "978-84-12345-67-8" o sin guiones).
6. Materia o Área Temática (subject): Clasifica el tema principal o la disciplina general del libro en una SOLA palabra o concepto amplio y generalizador a partir del título, los subtítulos y el contexto. En lugar de ser muy específico, debes clasificarlo estrictamente dentro de una de las grandes áreas del conocimiento humano, por ejemplo:
   - "Economía" (para finanzas, microeconomía, macroeconomía, mercados, comercio)
   - "Psicología" (para terapia, mente, comportamiento, autoayuda psicológica, neurociencia cognitiva)
   - "Filosofía" (para ética, metafísica, lógica, historia del pensamiento, epistemología)
   - "Matemáticas" (para álgebra, cálculo, estadística, geometría)
   - "Física" (para termodinámica, relatividad, física clásica o cuántica)
   - "Política" (para teoría política, geopolítica, sistemas de gobierno, sociología política)
   - "Ciencia" (para biología, química, astronomía, medicina, o estudios científicos generales)
   - "Literatura" (para novelas, poesía, teatro, crítica literaria)
   - "Historia" (para acontecimientos históricos, biografías históricas, arqueología)
   - u otra gran disciplina similar. NO utilices frases largas ni especialidades muy estrechas (ej: no uses "Teoría de Juegos Avanzada", usa "Economía" o "Matemáticas").

Si no puedes identificar un valor para algún campo, especifica una cadena de texto vacía "".
Texto del documento:
${text}
`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              author: { type: Type.STRING },
              year: { type: Type.STRING },
              publisher: { type: Type.STRING },
              isbn: { type: Type.STRING },
              subject: { type: Type.STRING }
            },
            required: ["title", "author", "year", "publisher", "isbn", "subject"]
          },
        },
      });
      res.json(JSON.parse(response?.text || "{}"));
    } catch (error) {
      console.error("Error analyzing PDF text:", error);
      res.status(500).json({ error: "Fallo al analizar texto con Gemini" });
    }
  });

  app.post("/api/analyze-url", aiLimiter, async (req, res) => {
    const url = reqString(req.body?.url, 2048);
    if (!url) return res.status(400).json({ error: "URL requerida" });
    const check = await isSafePublicUrl(url);
    if (check.ok === false) return res.status(400).json({ error: check.reason });

    try {
      const fetchRes = await fetch(check.url.toString(), {
        headers: { "User-Agent": "Mozilla/5.0 BibliotecaBot/1.0" },
        signal: AbortSignal.timeout(15000),
      });
      const html = await fetchRes.text();
      const text = html
        .replace(/<script[^>]*>([\S\s]*?)<\/script>/gmi, "")
        .replace(/<style[^>]*>([\S\s]*?)<\/style>/gmi, "")
        .replace(/<\/?[^>]+(>|$)/g, " ")
        .replace(/\s+/g, " ")
        .substring(0, 15000);

      const response = await generateContentWithRetry({
        model: "gemini-2.5-flash",
        contents: `Analiza este texto extraído de una página web y extrae de forma extremadamente concisa y precisa los siguientes campos en formato JSON.
Busca patrones comunes en el texto relacionados con metadatos de libros o artículos como "©", "Copyright", "ISBN", "Editorial", "Publicado en", "Año", etc.

Campos a extraer:
1. Título (title): El título del material.
2. Autor (author): Nombre del autor o autores.
3. Año de publicación (year): El año de copyright o edición (ej: "2018", "1994"). Extrae solo las 4 cifras del año.
4. Editorial / Publicador (publisher): Nombre de la editorial o del sitio web.
5. ISBN (isbn): Código ISBN si está disponible.
6. Materia o Área Temática (subject): Clasifica el tema principal o la disciplina general de manera concisa en una SOLA palabra o concepto amplio a partir del título y el contenido. Debes clasificarlo estrictamente dentro de una de las grandes áreas del conocimiento humano, por ejemplo:
   - "Economía" (para finanzas, microeconomía, macroeconomía, mercados, comercio)
   - "Psicología" (para terapia, mente, comportamiento, autoayuda psicológica, neurociencia cognitiva)
   - "Filosofía" (para ética, metafísica, lógica, historia del pensamiento, epistemología)
   - "Matemáticas" (para álgebra, cálculo, estadística, geometría)
   - "Física" (para termodinámica, relatividad, física clásica o cuántica)
   - "Política" (para teoría política, geopolítica, sistemas de gobierno, sociología política)
   - "Ciencia" (para biología, química, astronomía, medicina, o estudios científicos generales)
   - "Literatura" (para novelas, poesía, teatro, crítica literaria)
   - "Historia" (para acontecimientos históricos, biografías históricas, arqueología)
   - u otra gran disciplina similar. NO utilices frases largas ni especialidades muy estrechas (ej: no uses "Teoría de Juegos Avanzada", usa "Economía" o "Matemáticas").

Si no puedes identificar un valor para algún campo, especifica una cadena de texto vacía "".
Texto:
${text}
`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              author: { type: Type.STRING },
              year: { type: Type.STRING },
              publisher: { type: Type.STRING },
              isbn: { type: Type.STRING },
              subject: { type: Type.STRING }
            },
            required: ["title", "author", "year", "publisher", "isbn", "subject"]
          },
        },
      });
      res.json(JSON.parse(response?.text || "{}"));
    } catch (error) {
      console.error("Error analyzing URL:", error);
      res.status(500).json({ error: "Fallo al analizar URL" });
    }
  });

  app.post("/api/analyze-image", aiLimiter, async (req, res) => {
    const imageBase64 = reqString(req.body?.imageBase64, 20 * 1024 * 1024);
    if (!imageBase64) return res.status(400).json({ error: "Imagen requerida" });

    const match = imageBase64.match(/^data:(image\/[\w+.-]+);base64,(.+)$/);
    let mimeType = "image/jpeg";
    let base64Data = imageBase64;
    if (match) {
      mimeType = match[1];
      base64Data = match[2];
    }

    try {
      const response = await generateContentWithRetry({
        model: "gemini-2.5-flash",
        contents: [
          { text: "Analyze this book cover image. Extract the Title and Author. If you cannot find a value, specify an empty string. The language is likely Spanish, so extract fields accordingly." },
          { inlineData: { mimeType, data: base64Data } },
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              author: { type: Type.STRING },
            },
            required: ["title", "author"],
          },
        },
      });
      res.json(JSON.parse(response?.text || "{}"));
    } catch (error) {
      console.error("Error analyzing image:", error);
      res.status(500).json({ error: "Fallo al analizar imagen" });
    }
  });

  app.post("/api/gemini/summarize", aiLimiter, async (req, res) => {
    const citations = Array.isArray(req.body?.citations) ? req.body.citations : null;
    const prompt = reqString(req.body?.prompt, 10000);
    if (!citations || citations.length === 0) {
      return res.status(400).json({ error: "No se proporcionaron citas para resumir." });
    }
    if (!prompt) {
      return res.status(400).json({ error: "Prompt requerido." });
    }
    // Validar que cada cita sea string razonable.
    const safe = citations
      .filter((c: unknown) => typeof c === "string" && c.length > 0 && c.length < 20000)
      .slice(0, 200);
    if (safe.length === 0) {
      return res.status(400).json({ error: "Citas inválidas." });
    }

    try {
      const citationsText = safe.map((c: string, i: number) => `Cita ${i + 1}:\n${c}`).join("\n\n");
      const response = await generateContentWithRetry({
        model: "gemini-2.5-flash",
        contents: `${prompt}\n\nCitas:\n${citationsText}`,
      });
      res.json({ summary: response?.text || "" });
    } catch (error) {
      console.error("Error generating summary with Gemini:", error);
      res.status(500).json({ error: "Error al generar el resumen automático." });
    }
  });

  // -------------------------------------------------------------------------
  // TTS Proxy Endpoint (Soporta ElevenLabs y Google Gemini TTS multimodal)
  // -------------------------------------------------------------------------
  interface CacheEntry {
    key: string;
    buffer: Buffer;
    contentType: string;
  }
  const ttsCache: CacheEntry[] = [];

  async function runGoogleStandardTTS(text: string, voiceName: string, credentialsPath: string, cacheKey: string, res: Response) {
    try {
      const auth = new GoogleAuth({
        keyFile: credentialsPath,
        scopes: ["https://www.googleapis.com/auth/cloud-platform"],
      });
      const client = await auth.getClient();
      const tokenResponse = await (client as any).getAccessToken();
      const accessToken = tokenResponse.token;

      const languageCode = voiceName.split("-").slice(0, 2).join("-");

      const ttsResponse = await fetch(
        "https://texttospeech.googleapis.com/v1/text:synthesize",
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            input: { text },
            voice: { languageCode, name: voiceName },
            audioConfig: { audioEncoding: "MP3" },
          }),
          signal: AbortSignal.timeout(30000),
        }
      );

      if (!ttsResponse.ok) {
        const errText = await ttsResponse.text().catch(() => "");
        console.error("[Google Standard TTS] Error:", ttsResponse.status, errText);
        return res.status(ttsResponse.status).json({
          error: `Error de Google Cloud TTS: ${ttsResponse.statusText}`,
          details: errText.substring(0, 500),
        });
      }

      const data = await ttsResponse.json() as { audioContent: string };
      const audioBuffer = Buffer.from(data.audioContent, "base64");

      ttsCache.unshift({ key: cacheKey, buffer: audioBuffer, contentType: "audio/mpeg" });
      if (ttsCache.length > 3) ttsCache.pop();

      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("X-Cache", "MISS");
      return res.send(audioBuffer);
    } catch (error: any) {
      console.error("[Google Standard TTS] Error interno:", error);
      return res.status(500).json({ error: "Fallo al generar síntesis con Google Cloud TTS.", details: error.message });
    }
  }

  app.post("/api/tts", aiLimiter, async (req, res) => {
    const text = reqString(req.body?.text, 3000);
    const provider = reqString(req.body?.provider, 32) || "elevenlabs";
    const customVoiceId = reqString(req.body?.voiceId, 128);
    const model = reqString(req.body?.model, 128) || "gemini-2.5-flash";
    
    if (!text) {
      return res.status(400).json({ error: "El texto es requerido y debe tener un máximo de 3,000 caracteres." });
    }

    let activeProvider = provider;
    let voiceId = customVoiceId;

    // Self-healing: Detect voice mismatch and automatically correct the provider/voice mapping
    if (voiceId?.startsWith("es-") || voiceId?.startsWith("en-")) {
      activeProvider = "google-standard";
    } else if (["Erinome", "Autonoe", "Erin", "Aoede"].includes(voiceId || "")) {
      activeProvider = "google";
    } else if (voiceId === "21m00Tcm4TlvDq8ikWAM" || voiceId === "AZnzlk1XvdvUeBnXmlld" || voiceId === "ErXwobaYiN019PkySvjV") {
      activeProvider = "elevenlabs";
    }

    console.log(`[TTS] provider="${provider}" (active="${activeProvider}") voice="${voiceId}" model="${model}"`);

    // Generar la clave de caché única
    const cacheKey = `${activeProvider}_${voiceId || "default"}_${model}_${text.trim()}`;
    const cached = ttsCache.find(entry => entry.key === cacheKey);
    if (cached) {
      console.log(`[TTS Cache] HIT para: "${text.trim().substring(0, 40)}..."`);
      res.setHeader("Content-Type", cached.contentType);
      res.setHeader("X-Cache", "HIT");
      return res.send(cached.buffer);
    }

    if (activeProvider === "google") {
      const apiKey = process.env.GEMINI_API_KEY || "";
      const credentialsPath = process.env.GOOGLE_TTS_CREDENTIALS || "./google-tts-credentials.json";
      
      if (!apiKey) {
        console.warn("[WARN] GEMINI_API_KEY no está configurada en el servidor.");
        if (fs.existsSync(credentialsPath)) {
          console.log("[TTS Fallback] GEMINI_API_KEY missing. Falling back to google-standard.");
          return await runGoogleStandardTTS(text, "es-ES-Standard-A", credentialsPath, cacheKey, res);
        }
        return res.status(503).json({ error: "El servicio de lectura de voz de Google no está disponible temporalmente (falta la API Key de Gemini)." });
      }

      try {
        const voiceName = voiceId || "Erinome";
        let response;
        let success = false;
        
        // Try multiple models in sequence for high availability
        const modelsToTry = [model, "gemini-2.0-flash-exp", "gemini-2.0-flash"];
        let lastErr: any = null;
        
        for (const m of modelsToTry) {
          try {
            console.log(`[TTS Gemini] Trying model "${m}" with voice "${voiceName}"`);
            response = await ai.models.generateContent({
              model: m,
              contents: `Por favor, lee el siguiente fragmento de texto de forma fluida. Texto:\n${text}`,
              config: {
                systemInstruction: `leelo con voz chilena nativa como una persona de Chile 100% coloquial y rápido con énfasis, pausas y de manera narrativa pero ágil`,
                responseModalities: ["TEXT", "AUDIO"],
                speechConfig: {
                  voiceConfig: {
                    prebuiltVoiceConfig: {
                      voiceName: voiceName
                    }
                  }
                }
              }
            });
            
            const parts = response.candidates?.[0]?.content?.parts || [];
            const audioPart = parts.find((p: any) => p.inlineData?.data && p.inlineData.mimeType?.startsWith('audio/'));
            if (audioPart?.inlineData?.data) {
              const audioBuffer = Buffer.from(audioPart.inlineData.data, 'base64');
              const mimeType = audioPart.inlineData.mimeType || 'audio/mp3';
              
              // Save in circular cache
              ttsCache.unshift({ key: cacheKey, buffer: audioBuffer, contentType: mimeType });
              if (ttsCache.length > 3) ttsCache.pop();
              console.log(`[TTS Cache] MISS (Google Gemini) - Saved to cache for: "${text.trim().substring(0, 40)}..."`);
              
              res.setHeader("Content-Type", mimeType);
              res.setHeader("X-Cache", "MISS");
              res.send(audioBuffer);
              success = true;
              break;
            }
          } catch (err: any) {
            lastErr = err;
            console.warn(`[WARN] Model "${m}" failed synthesis:`, err.message || err);
          }
        }
        
        if (!success) {
          // If Gemini models fail, check if Google Standard credentials exist for fallback
          if (fs.existsSync(credentialsPath)) {
            console.log("[TTS Fallback] Gemini synthesis failed. Falling back transparently to google-standard.");
            return await runGoogleStandardTTS(text, "es-ES-Standard-A", credentialsPath, cacheKey, res);
          } else {
            throw lastErr || new Error("Fallo en todos los modelos de Gemini.");
          }
        }
      } catch (error: any) {
        console.error("Error generating speech with Gemini:", error);
        res.status(500).json({ error: "Fallo al generar la síntesis de voz con Google Gemini.", details: error.message });
      }
    } else if (activeProvider === "google-standard") {
      const credentialsPath = process.env.GOOGLE_TTS_CREDENTIALS || "./google-tts-credentials.json";
      if (!fs.existsSync(credentialsPath)) {
        return res.status(503).json({ error: "Credenciales de Google Cloud TTS no encontradas en el servidor." });
      }
      return await runGoogleStandardTTS(text, voiceId || "es-ES-Standard-A", credentialsPath, cacheKey, res);
    } else {
      const elevenKey = process.env.ELEVENLABS_API_KEY || "";
      if (!elevenKey) {
        console.warn("[WARN] ELEVENLABS_API_KEY no está configurada en el servidor.");
        return res.status(503).json({ error: "El servicio de lectura de voz no está disponible en este servidor temporalmente (falta la API Key)." });
      }

      const defaultVoiceId = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
      const activeVoiceId = voiceId || defaultVoiceId;

      try {
        const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${activeVoiceId}?output_format=mp3_44100_128`, {
          method: "POST",
          headers: {
            "xi-api-key": elevenKey,
            "Content-Type": "application/json",
            "accept": "audio/mpeg",
          },
          body: JSON.stringify({
            text: text,
            model_id: "eleven_multilingual_v2",
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.75,
            },
          }),
          signal: AbortSignal.timeout(30000),
        });

        if (!response.ok) {
          const errorText = await response.text().catch(() => "");
          console.error("ElevenLabs API error response:", response.status, errorText);
          return res.status(response.status).json({ 
            error: `Error de ElevenLabs: ${response.statusText || response.status}`,
            details: errorText.substring(0, 500)
          });
        }

        const contentType = response.headers.get("content-type") || "audio/mpeg";
        const buffer = await response.arrayBuffer();
        const audioBuffer = Buffer.from(buffer);

        ttsCache.unshift({ key: cacheKey, buffer: audioBuffer, contentType });
        if (ttsCache.length > 3) ttsCache.pop();
        console.log(`[TTS Cache] MISS (ElevenLabs) - Saved to cache for: "${text.trim().substring(0, 40)}..."`);

        res.setHeader("Content-Type", contentType);
        res.setHeader("X-Cache", "MISS");
        res.send(audioBuffer);
      } catch (error) {
        console.error("Error generating speech with ElevenLabs:", error);
        res.status(500).json({ error: "Fallo interno al procesar la síntesis de voz." });
      }
    }
  });

  // -------------------------------------------------------------------------
  // Frontend: Vite middleware en dev, archivos estáticos en prod.
  // -------------------------------------------------------------------------
  if (!IS_PROD) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath, { maxAge: "1d", index: false }));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // Manejador global de errores (último middleware).
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err && err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: `Archivo demasiado grande (máx ${MAX_UPLOAD_MB} MB)` });
    }
    console.error("Unhandled error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Error interno del servidor" });
    }
  });

  app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}  (env=${NODE_ENV})`);
    console.log(`Uploads dir: ${UPLOAD_DIR}  (máx ${MAX_UPLOAD_MB} MB/archivo)`);
    if (ALLOW_PROXY_HOSTS.length > 0) {
      console.log(`Proxy whitelist: ${ALLOW_PROXY_HOSTS.join(", ")}`);
    }
  });
}

startServer().catch(err => {
  console.error("Fatal en startServer:", err);
  process.exit(1);
});
