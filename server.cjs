var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// server.ts
var import_express = __toESM(require("express"), 1);
var import_path = __toESM(require("path"), 1);
var import_fs = __toESM(require("fs"), 1);
var import_promises = __toESM(require("dns/promises"), 1);
var import_net = __toESM(require("net"), 1);
var import_multer = __toESM(require("multer"), 1);
var import_helmet = __toESM(require("helmet"), 1);
var import_cors = __toESM(require("cors"), 1);
var import_express_rate_limit = __toESM(require("express-rate-limit"), 1);
var import_crypto = require("crypto");
var import_vite = require("vite");
var import_genai = require("@google/genai");
var import_google_auth_library = require("google-auth-library");
var import_express_session = __toESM(require("express-session"), 1);
var import_passport = __toESM(require("passport"), 1);
var import_passport_google_oauth20 = require("passport-google-oauth20");
var import_dotenv = __toESM(require("dotenv"), 1);
import_dotenv.default.config();
var PORT = Number(process.env.PORT || 3e3);
var HOST = process.env.HOST || "0.0.0.0";
var NODE_ENV = process.env.NODE_ENV || "development";
var IS_PROD = NODE_ENV === "production";
var UPLOAD_DIR = import_path.default.resolve(process.env.UPLOAD_DIR || "./uploads");
var MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 200);
var CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
if (IS_PROD && CORS_ORIGIN === "*") {
  console.warn("[WARN] CORS_ORIGIN='*' en producci\xF3n \u2014 define CORS_ORIGIN=https://tudominio.com en .env para restringir el acceso.");
}
var RATE_LIMIT_WINDOW_MIN = Number(process.env.RATE_LIMIT_WINDOW_MIN || 15);
var RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || 300);
var AI_RATE_LIMIT_WINDOW_MIN = Number(process.env.AI_RATE_LIMIT_WINDOW_MIN || 5);
var AI_RATE_LIMIT_MAX = Number(process.env.AI_RATE_LIMIT_MAX || 30);
var ALLOW_PROXY_HOSTS = (process.env.ALLOW_PROXY_HOSTS || "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
var TRUST_PROXY = process.env.TRUST_PROXY === "1";
var GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
var GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
var SESSION_SECRET = process.env.SESSION_SECRET || (0, import_crypto.randomUUID)();
var ALLOWED_EMAILS = (process.env.ALLOWED_EMAILS || "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
var DELETE_TOKEN = process.env.DELETE_TOKEN || (IS_PROD ? null : (() => {
  const t = (0, import_crypto.randomUUID)();
  console.log(`[DEV] DELETE_TOKEN generado para esta sesi\xF3n: ${t}`);
  return t;
})());
var apiKey = process.env.GEMINI_API_KEY || "";
if (!apiKey && IS_PROD) {
  console.warn("[WARN] GEMINI_API_KEY no configurada \u2014 los endpoints /api/analyze-* y /api/gemini/summarize devolver\xE1n error.");
}
var ai = new import_genai.GoogleGenAI({ apiKey: apiKey || "missing", apiVersion: "v1beta" });
if (!import_fs.default.existsSync(UPLOAD_DIR)) {
  import_fs.default.mkdirSync(UPLOAD_DIR, { recursive: true });
}
function safeExt(name) {
  const m = /\.([a-zA-Z0-9]{1,8})$/.exec(name);
  return m ? "." + m[1].toLowerCase() : "";
}
var ALLOWED_MIME_TYPES = /* @__PURE__ */ new Set([
  "application/pdf",
  "application/epub+zip",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif"
]);
var upload = (0, import_multer.default)({
  storage: import_multer.default.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => cb(null, (0, import_crypto.randomUUID)() + safeExt(file.originalname))
  }),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Tipo de archivo no permitido: ${file.mimetype}`));
    }
  }
});
function reqString(v, max = 5e4) {
  if (typeof v !== "string") return null;
  if (v.length === 0 || v.length > max) return null;
  return v;
}
var FILENAME_RE = /^[A-Za-z0-9._-]{1,128}$/;
function isPrivateIP(ip) {
  if (!import_net.default.isIP(ip)) return false;
  if (import_net.default.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 0) return true;
    if (a >= 224) return true;
    return false;
  }
  const v = ip.toLowerCase();
  if (v === "::1" || v === "::") return true;
  if (v.startsWith("fc") || v.startsWith("fd")) return true;
  if (v.startsWith("fe80")) return true;
  if (v.startsWith("::ffff:")) {
    return isPrivateIP(v.replace("::ffff:", ""));
  }
  return false;
}
async function isSafePublicUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "URL inv\xE1lida" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: "S\xF3lo http y https permitidos" };
  }
  const hostname = parsed.hostname.toLowerCase();
  if (!hostname) return { ok: false, reason: "Hostname vac\xEDo" };
  if (ALLOW_PROXY_HOSTS.length > 0) {
    const allowed = ALLOW_PROXY_HOSTS.some((h) => hostname === h || hostname.endsWith("." + h));
    if (!allowed) return { ok: false, reason: "Host no permitido (no est\xE1 en ALLOW_PROXY_HOSTS)" };
  }
  if (["localhost", "ip6-localhost", "ip6-loopback"].includes(hostname)) {
    return { ok: false, reason: "Host privado bloqueado" };
  }
  if (import_net.default.isIP(hostname)) {
    if (isPrivateIP(hostname)) return { ok: false, reason: "IP privada bloqueada" };
    return { ok: true, url: parsed };
  }
  try {
    const addrs = await import_promises.default.lookup(hostname, { all: true });
    if (addrs.length === 0) return { ok: false, reason: "DNS sin respuesta" };
    for (const a of addrs) {
      if (isPrivateIP(a.address)) {
        return { ok: false, reason: "El host resuelve a una IP privada" };
      }
    }
  } catch {
    return { ok: false, reason: "Fallo de resoluci\xF3n DNS" };
  }
  return { ok: true, url: parsed };
}
async function generateContentWithRetry(options, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await ai.models.generateContent(options);
    } catch (error) {
      if (error?.status === "UNAVAILABLE" || error?.status === 503) {
        if (i === maxRetries - 1) throw error;
        const waitTime = Math.pow(2, i) * 1e3;
        console.log(`Model unavailable, retrying in ${waitTime}ms...`);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      } else {
        throw error;
      }
    }
  }
}
async function startServer() {
  const app = (0, import_express.default)();
  if (TRUST_PROXY) app.set("trust proxy", 1);
  app.use(
    (0, import_helmet.default)({
      contentSecurityPolicy: IS_PROD ? {
        useDefaults: true,
        directives: {
          "default-src": ["'self'"],
          "script-src": ["'self'"],
          "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
          "font-src": ["'self'", "https://fonts.gstatic.com", "data:"],
          "img-src": ["'self'", "data:", "blob:", "https:"],
          "connect-src": ["'self'", "https://generativelanguage.googleapis.com"],
          "worker-src": ["'self'", "blob:"],
          "frame-src": ["'self'", "https:"]
        }
      } : false,
      // En dev, deshabilitado para que Vite HMR funcione.
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: "cross-origin" }
    })
  );
  app.use((0, import_cors.default)({ origin: CORS_ORIGIN, credentials: true }));
  app.use(import_express.default.json({ limit: "50mb" }));
  app.use((0, import_express_session.default)({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: IS_PROD,
      maxAge: 7 * 24 * 60 * 60 * 1e3
      // 7 días
    }
  }));
  import_passport.default.use(new import_passport_google_oauth20.Strategy(
    {
      clientID: GOOGLE_CLIENT_ID,
      clientSecret: GOOGLE_CLIENT_SECRET,
      callbackURL: "/auth/google/callback"
    },
    (_accessToken, _refreshToken, profile, done) => {
      const email = profile.emails?.[0]?.value?.toLowerCase() || "";
      if (ALLOWED_EMAILS.length > 0 && !ALLOWED_EMAILS.includes(email)) {
        return done(null, false, { message: "Email no autorizado." });
      }
      return done(null, {
        id: profile.id,
        name: profile.displayName,
        email,
        photo: profile.photos?.[0]?.value || ""
      });
    }
  ));
  import_passport.default.serializeUser((user, done) => done(null, user));
  import_passport.default.deserializeUser((user, done) => done(null, user));
  app.use(import_passport.default.initialize());
  app.use(import_passport.default.session());
  app.get(
    "/auth/google",
    import_passport.default.authenticate("google", { scope: ["profile", "email"] })
  );
  app.get(
    "/auth/google/callback",
    import_passport.default.authenticate("google", { failureRedirect: "/?error=unauthorized" }),
    (_req, res) => res.redirect("/")
  );
  app.get("/auth/logout", (req, res) => {
    req.logout(() => res.redirect("/"));
  });
  app.get("/api/me", (req, res) => {
    if (req.isAuthenticated()) {
      res.json({ user: req.user });
    } else {
      res.status(401).json({ user: null });
    }
  });
  const requireAuth = (req, res, next) => {
    const openPaths = ["/api/me", "/api/health", "/api/config"];
    if (openPaths.includes(req.path) || req.isAuthenticated()) return next();
    res.status(401).json({ error: "No autenticado." });
  };
  app.use("/api/", requireAuth);
  const apiLimiter = (0, import_express_rate_limit.default)({
    windowMs: RATE_LIMIT_WINDOW_MIN * 60 * 1e3,
    max: RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Demasiadas solicitudes. Intenta de nuevo m\xE1s tarde." }
  });
  app.use("/api/", apiLimiter);
  const aiLimiter = (0, import_express_rate_limit.default)({
    windowMs: AI_RATE_LIMIT_WINDOW_MIN * 60 * 1e3,
    max: AI_RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Demasiadas peticiones de IA. Espera antes de seguir." }
  });
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, env: NODE_ENV, time: (/* @__PURE__ */ new Date()).toISOString() });
  });
  app.get("/api/config", (_req, res) => {
    res.json({ deleteToken: DELETE_TOKEN || null });
  });
  app.post("/api/upload", upload.single("file"), (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "No se recibi\xF3 archivo" });
    }
    res.json({
      url: `/api/files/${req.file.filename}`,
      name: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size,
      mimeType: req.file.mimetype
    });
  });
  app.get("/api/files/:name", (req, res) => {
    const name = req.params.name;
    if (!FILENAME_RE.test(name)) {
      return res.status(400).json({ error: "Nombre inv\xE1lido" });
    }
    const filePath = import_path.default.join(UPLOAD_DIR, name);
    if (!filePath.startsWith(UPLOAD_DIR + import_path.default.sep)) {
      return res.status(400).json({ error: "Ruta fuera del directorio permitido" });
    }
    if (!import_fs.default.existsSync(filePath)) {
      return res.status(404).json({ error: "Archivo no encontrado" });
    }
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.sendFile(filePath);
  });
  app.delete("/api/files/:name", (req, res) => {
    const authHeader = req.headers["x-delete-token"];
    if (DELETE_TOKEN && authHeader !== DELETE_TOKEN) {
      return res.status(401).json({ error: "No autorizado." });
    }
    const name = req.params.name;
    if (!FILENAME_RE.test(name)) {
      return res.status(400).json({ error: "Nombre inv\xE1lido" });
    }
    const filePath = import_path.default.join(UPLOAD_DIR, name);
    if (!filePath.startsWith(UPLOAD_DIR + import_path.default.sep)) {
      return res.status(400).json({ error: "Ruta fuera del directorio permitido" });
    }
    if (import_fs.default.existsSync(filePath)) {
      try {
        import_fs.default.unlinkSync(filePath);
      } catch (err) {
        console.warn("No se pudo borrar archivo:", err);
      }
    }
    res.json({ ok: true });
  });
  app.get("/api/proxy-resource", aiLimiter, async (req, res) => {
    const url = reqString(req.query.url, 2048);
    if (!url) return res.status(400).json({ error: "URL es requerida" });
    const check = await isSafePublicUrl(url);
    if (check.ok === false) return res.status(400).json({ error: check.reason });
    try {
      const response = await fetch(check.url.toString(), {
        // 15 s de timeout para evitar conexiones colgadas.
        signal: AbortSignal.timeout(15e3)
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
  app.post("/api/analyze-pdf", aiLimiter, async (req, res) => {
    const text = reqString(req.body?.text, 2e5);
    if (!text) return res.status(400).json({ error: "Texto requerido (no vac\xEDo, m\xE1x 200k)" });
    try {
      const response = await generateContentWithRetry({
        model: "gemini-2.5-flash",
        contents: `Analiza este texto correspondiente a las primeras p\xE1ginas de un libro (que incluye la portada, cr\xE9ditos, copyright, colof\xF3n y la p\xE1gina de descripci\xF3n editorial) y extrae de forma extremadamente concisa y precisa los siguientes campos en formato JSON.

REGLA CR\xCDTICA DE B\xDASQUEDA:
Si no encuentras el ISBN en la primera p\xE1gina o portada, es imperativo que lo busques detalladamente en el texto de las p\xE1ginas siguientes (especialmente de la p\xE1gina 2 a la 5). Recuerda que las editoriales siempre incluyen una p\xE1gina con toda la descripci\xF3n editorial, los a\xF1os de copyright, la editorial y la materia; es all\xED donde reside el ISBN, el a\xF1o de publicaci\xF3n, el nombre de la editorial y el \xE1rea tem\xE1tica o materia. Por lo tanto, analiza minuciosamente todas las p\xE1ginas provistas.

Este texto es est\xE1ndar de registro legal de propiedad intelectual. Busca patrones comunes como "\xA9", "Copyright", "ISBN", "Editorial", "Impreso en / Printed in", "Edici\xF3n", "A\xF1o", etc., especialmente en bloques compactos de texto.

Campos a extraer:
1. T\xEDtulo (title): El t\xEDtulo del libro.
2. Autor (author): Nombre de los autores.
3. A\xF1o de publicaci\xF3n (year): El a\xF1o de copyright o de edici\xF3n (ej: "2018", "1994"). Aunque est\xE9 rodeado de texto legal o de reimpresi\xF3n, identif\xEDcalo y extrae solo las 4 cifras del a\xF1o m\xE1s representativo.
4. Editorial (publisher): El nombre de la editorial comercial que publica el libro.
5. ISBN (isbn): C\xF3digo ISBN-10 o ISBN-13 (ej: "978-84-12345-67-8" o sin guiones).
6. Materia o \xC1rea Tem\xE1tica (subject): Clasifica el tema principal o la disciplina general del libro en una SOLA palabra o concepto amplio y generalizador a partir del t\xEDtulo, los subt\xEDtulos y el contexto. En lugar de ser muy espec\xEDfico, debes clasificarlo estrictamente dentro de una de las grandes \xE1reas del conocimiento humano, por ejemplo:
   - "Econom\xEDa" (para finanzas, microeconom\xEDa, macroeconom\xEDa, mercados, comercio)
   - "Psicolog\xEDa" (para terapia, mente, comportamiento, autoayuda psicol\xF3gica, neurociencia cognitiva)
   - "Filosof\xEDa" (para \xE9tica, metaf\xEDsica, l\xF3gica, historia del pensamiento, epistemolog\xEDa)
   - "Matem\xE1ticas" (para \xE1lgebra, c\xE1lculo, estad\xEDstica, geometr\xEDa)
   - "F\xEDsica" (para termodin\xE1mica, relatividad, f\xEDsica cl\xE1sica o cu\xE1ntica)
   - "Pol\xEDtica" (para teor\xEDa pol\xEDtica, geopol\xEDtica, sistemas de gobierno, sociolog\xEDa pol\xEDtica)
   - "Ciencia" (para biolog\xEDa, qu\xEDmica, astronom\xEDa, medicina, o estudios cient\xEDficos generales)
   - "Literatura" (para novelas, poes\xEDa, teatro, cr\xEDtica literaria)
   - "Historia" (para acontecimientos hist\xF3ricos, biograf\xEDas hist\xF3ricas, arqueolog\xEDa)
   - u otra gran disciplina similar. NO utilices frases largas ni especialidades muy estrechas (ej: no uses "Teor\xEDa de Juegos Avanzada", usa "Econom\xEDa" o "Matem\xE1ticas").

Si no puedes identificar un valor para alg\xFAn campo, especifica una cadena de texto vac\xEDa "".
Texto del documento:
${text}
`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: import_genai.Type.OBJECT,
            properties: {
              title: { type: import_genai.Type.STRING },
              author: { type: import_genai.Type.STRING },
              year: { type: import_genai.Type.STRING },
              publisher: { type: import_genai.Type.STRING },
              isbn: { type: import_genai.Type.STRING },
              subject: { type: import_genai.Type.STRING }
            },
            required: ["title", "author", "year", "publisher", "isbn", "subject"]
          }
        }
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
        signal: AbortSignal.timeout(15e3)
      });
      const html = await fetchRes.text();
      const text = html.replace(/<script[^>]*>([\S\s]*?)<\/script>/gmi, "").replace(/<style[^>]*>([\S\s]*?)<\/style>/gmi, "").replace(/<\/?[^>]+(>|$)/g, " ").replace(/\s+/g, " ").substring(0, 15e3);
      const response = await generateContentWithRetry({
        model: "gemini-2.5-flash",
        contents: `Analiza este texto extra\xEDdo de una p\xE1gina web y extrae de forma extremadamente concisa y precisa los siguientes campos en formato JSON.
Busca patrones comunes en el texto relacionados con metadatos de libros o art\xEDculos como "\xA9", "Copyright", "ISBN", "Editorial", "Publicado en", "A\xF1o", etc.

Campos a extraer:
1. T\xEDtulo (title): El t\xEDtulo del material.
2. Autor (author): Nombre del autor o autores.
3. A\xF1o de publicaci\xF3n (year): El a\xF1o de copyright o edici\xF3n (ej: "2018", "1994"). Extrae solo las 4 cifras del a\xF1o.
4. Editorial / Publicador (publisher): Nombre de la editorial o del sitio web.
5. ISBN (isbn): C\xF3digo ISBN si est\xE1 disponible.
6. Materia o \xC1rea Tem\xE1tica (subject): Clasifica el tema principal o la disciplina general de manera concisa en una SOLA palabra o concepto amplio a partir del t\xEDtulo y el contenido. Debes clasificarlo estrictamente dentro de una de las grandes \xE1reas del conocimiento humano, por ejemplo:
   - "Econom\xEDa" (para finanzas, microeconom\xEDa, macroeconom\xEDa, mercados, comercio)
   - "Psicolog\xEDa" (para terapia, mente, comportamiento, autoayuda psicol\xF3gica, neurociencia cognitiva)
   - "Filosof\xEDa" (para \xE9tica, metaf\xEDsica, l\xF3gica, historia del pensamiento, epistemolog\xEDa)
   - "Matem\xE1ticas" (para \xE1lgebra, c\xE1lculo, estad\xEDstica, geometr\xEDa)
   - "F\xEDsica" (para termodin\xE1mica, relatividad, f\xEDsica cl\xE1sica o cu\xE1ntica)
   - "Pol\xEDtica" (para teor\xEDa pol\xEDtica, geopol\xEDtica, sistemas de gobierno, sociolog\xEDa pol\xEDtica)
   - "Ciencia" (para biolog\xEDa, qu\xEDmica, astronom\xEDa, medicina, o estudios cient\xEDficos generales)
   - "Literatura" (para novelas, poes\xEDa, teatro, cr\xEDtica literaria)
   - "Historia" (para acontecimientos hist\xF3ricos, biograf\xEDas hist\xF3ricas, arqueolog\xEDa)
   - u otra gran disciplina similar. NO utilices frases largas ni especialidades muy estrechas (ej: no uses "Teor\xEDa de Juegos Avanzada", usa "Econom\xEDa" o "Matem\xE1ticas").

Si no puedes identificar un valor para alg\xFAn campo, especifica una cadena de texto vac\xEDa "".
Texto:
${text}
`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: import_genai.Type.OBJECT,
            properties: {
              title: { type: import_genai.Type.STRING },
              author: { type: import_genai.Type.STRING },
              year: { type: import_genai.Type.STRING },
              publisher: { type: import_genai.Type.STRING },
              isbn: { type: import_genai.Type.STRING },
              subject: { type: import_genai.Type.STRING }
            },
            required: ["title", "author", "year", "publisher", "isbn", "subject"]
          }
        }
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
          { inlineData: { mimeType, data: base64Data } }
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: import_genai.Type.OBJECT,
            properties: {
              title: { type: import_genai.Type.STRING },
              author: { type: import_genai.Type.STRING }
            },
            required: ["title", "author"]
          }
        }
      });
      res.json(JSON.parse(response?.text || "{}"));
    } catch (error) {
      console.error("Error analyzing image:", error);
      res.status(500).json({ error: "Fallo al analizar imagen" });
    }
  });
  app.post("/api/gemini/summarize", aiLimiter, async (req, res) => {
    const citations = Array.isArray(req.body?.citations) ? req.body.citations : null;
    const prompt = reqString(req.body?.prompt, 1e4);
    if (!citations || citations.length === 0) {
      return res.status(400).json({ error: "No se proporcionaron citas para resumir." });
    }
    if (!prompt) {
      return res.status(400).json({ error: "Prompt requerido." });
    }
    const safe = citations.filter((c) => typeof c === "string" && c.length > 0 && c.length < 2e4).slice(0, 200);
    if (safe.length === 0) {
      return res.status(400).json({ error: "Citas inv\xE1lidas." });
    }
    try {
      const citationsText = safe.map((c, i) => `Cita ${i + 1}:
${c}`).join("\n\n");
      const response = await generateContentWithRetry({
        model: "gemini-2.5-flash",
        contents: `${prompt}

Citas:
${citationsText}`
      });
      res.json({ summary: response?.text || "" });
    } catch (error) {
      console.error("Error generating summary with Gemini:", error);
      res.status(500).json({ error: "Error al generar el resumen autom\xE1tico." });
    }
  });
  const ttsCache = [];
  async function runGoogleStandardTTS(text, voiceName, credentialsPath, cacheKey, res) {
    try {
      const auth = new import_google_auth_library.GoogleAuth({
        keyFile: credentialsPath,
        scopes: ["https://www.googleapis.com/auth/cloud-platform"]
      });
      const client = await auth.getClient();
      const tokenResponse = await client.getAccessToken();
      const accessToken = tokenResponse.token;
      const languageCode = voiceName.split("-").slice(0, 2).join("-");
      const ttsResponse = await fetch(
        "https://texttospeech.googleapis.com/v1/text:synthesize",
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            input: { text },
            voice: { languageCode, name: voiceName },
            audioConfig: { audioEncoding: "MP3" }
          }),
          signal: AbortSignal.timeout(3e4)
        }
      );
      if (!ttsResponse.ok) {
        const errText = await ttsResponse.text().catch(() => "");
        console.error("[Google Standard TTS] Error:", ttsResponse.status, errText);
        return res.status(ttsResponse.status).json({
          error: `Error de Google Cloud TTS: ${ttsResponse.statusText}`,
          details: errText.substring(0, 500)
        });
      }
      const data = await ttsResponse.json();
      const audioBuffer = Buffer.from(data.audioContent, "base64");
      ttsCache.unshift({ key: cacheKey, buffer: audioBuffer, contentType: "audio/mpeg" });
      if (ttsCache.length > 3) ttsCache.pop();
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("X-Cache", "MISS");
      return res.send(audioBuffer);
    } catch (error) {
      console.error("[Google Standard TTS] Error interno:", error);
      return res.status(500).json({ error: "Fallo al generar s\xEDntesis con Google Cloud TTS.", details: error.message });
    }
  }
  app.post("/api/tts", aiLimiter, async (req, res) => {
    const text = reqString(req.body?.text, 3e3);
    const provider = reqString(req.body?.provider, 32) || "elevenlabs";
    const customVoiceId = reqString(req.body?.voiceId, 128);
    const model = reqString(req.body?.model, 128) || "gemini-2.5-flash";
    if (!text) {
      return res.status(400).json({ error: "El texto es requerido y debe tener un m\xE1ximo de 3,000 caracteres." });
    }
    let activeProvider = provider;
    let voiceId = customVoiceId;
    if (voiceId?.startsWith("es-") || voiceId?.startsWith("en-")) {
      activeProvider = "google-standard";
    } else if (["Erinome", "Autonoe", "Erin", "Aoede"].includes(voiceId || "")) {
      activeProvider = "google";
    } else if (voiceId === "21m00Tcm4TlvDq8ikWAM" || voiceId === "AZnzlk1XvdvUeBnXmlld" || voiceId === "ErXwobaYiN019PkySvjV") {
      activeProvider = "elevenlabs";
    }
    console.log(`[TTS] provider="${provider}" (active="${activeProvider}") voice="${voiceId}" model="${model}"`);
    const cacheKey = `${activeProvider}_${voiceId || "default"}_${model}_${text.trim()}`;
    const cached = ttsCache.find((entry) => entry.key === cacheKey);
    if (cached) {
      console.log(`[TTS Cache] HIT para: "${text.trim().substring(0, 40)}..."`);
      res.setHeader("Content-Type", cached.contentType);
      res.setHeader("X-Cache", "HIT");
      return res.send(cached.buffer);
    }
    if (activeProvider === "google") {
      const apiKey2 = process.env.GEMINI_API_KEY || "";
      const credentialsPath = process.env.GOOGLE_TTS_CREDENTIALS || "./google-tts-credentials.json";
      if (!apiKey2) {
        console.warn("[WARN] GEMINI_API_KEY no est\xE1 configurada en el servidor.");
        if (import_fs.default.existsSync(credentialsPath)) {
          console.log("[TTS Fallback] GEMINI_API_KEY missing. Falling back to google-standard.");
          return await runGoogleStandardTTS(text, "es-ES-Standard-A", credentialsPath, cacheKey, res);
        }
        return res.status(503).json({ error: "El servicio de lectura de voz de Google no est\xE1 disponible temporalmente (falta la API Key de Gemini)." });
      }
      try {
        const voiceName = voiceId || "Erinome";
        let response;
        let success = false;
        const modelsToTry = [model, "gemini-2.0-flash-exp", "gemini-2.0-flash"];
        let lastErr = null;
        for (const m of modelsToTry) {
          try {
            console.log(`[TTS Gemini] Trying model "${m}" with voice "${voiceName}"`);
            response = await ai.models.generateContent({
              model: m,
              contents: `Por favor, lee el siguiente fragmento de texto de forma fluida. Texto:
${text}`,
              config: {
                systemInstruction: `leelo con voz chilena nativa como una persona de Chile 100% coloquial y r\xE1pido con \xE9nfasis, pausas y de manera narrativa pero \xE1gil`,
                responseModalities: ["TEXT", "AUDIO"],
                speechConfig: {
                  voiceConfig: {
                    prebuiltVoiceConfig: {
                      voiceName
                    }
                  }
                }
              }
            });
            const parts = response.candidates?.[0]?.content?.parts || [];
            const audioPart = parts.find((p) => p.inlineData?.data && p.inlineData.mimeType?.startsWith("audio/"));
            if (audioPart?.inlineData?.data) {
              const audioBuffer = Buffer.from(audioPart.inlineData.data, "base64");
              const mimeType = audioPart.inlineData.mimeType || "audio/mp3";
              ttsCache.unshift({ key: cacheKey, buffer: audioBuffer, contentType: mimeType });
              if (ttsCache.length > 3) ttsCache.pop();
              console.log(`[TTS Cache] MISS (Google Gemini) - Saved to cache for: "${text.trim().substring(0, 40)}..."`);
              res.setHeader("Content-Type", mimeType);
              res.setHeader("X-Cache", "MISS");
              res.send(audioBuffer);
              success = true;
              break;
            }
          } catch (err) {
            lastErr = err;
            console.warn(`[WARN] Model "${m}" failed synthesis:`, err.message || err);
          }
        }
        if (!success) {
          if (import_fs.default.existsSync(credentialsPath)) {
            console.log("[TTS Fallback] Gemini synthesis failed. Falling back transparently to google-standard.");
            return await runGoogleStandardTTS(text, "es-ES-Standard-A", credentialsPath, cacheKey, res);
          } else {
            throw lastErr || new Error("Fallo en todos los modelos de Gemini.");
          }
        }
      } catch (error) {
        console.error("Error generating speech with Gemini:", error);
        res.status(500).json({ error: "Fallo al generar la s\xEDntesis de voz con Google Gemini.", details: error.message });
      }
    } else if (activeProvider === "google-standard") {
      const credentialsPath = process.env.GOOGLE_TTS_CREDENTIALS || "./google-tts-credentials.json";
      if (!import_fs.default.existsSync(credentialsPath)) {
        return res.status(503).json({ error: "Credenciales de Google Cloud TTS no encontradas en el servidor." });
      }
      return await runGoogleStandardTTS(text, voiceId || "es-ES-Standard-A", credentialsPath, cacheKey, res);
    } else {
      const elevenKey = process.env.ELEVENLABS_API_KEY || "";
      if (!elevenKey) {
        console.warn("[WARN] ELEVENLABS_API_KEY no est\xE1 configurada en el servidor.");
        return res.status(503).json({ error: "El servicio de lectura de voz no est\xE1 disponible en este servidor temporalmente (falta la API Key)." });
      }
      const defaultVoiceId = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
      const activeVoiceId = voiceId || defaultVoiceId;
      try {
        const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${activeVoiceId}?output_format=mp3_44100_128`, {
          method: "POST",
          headers: {
            "xi-api-key": elevenKey,
            "Content-Type": "application/json",
            "accept": "audio/mpeg"
          },
          body: JSON.stringify({
            text,
            model_id: "eleven_multilingual_v2",
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.75
            }
          }),
          signal: AbortSignal.timeout(3e4)
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
        res.status(500).json({ error: "Fallo interno al procesar la s\xEDntesis de voz." });
      }
    }
  });
  app.post("/api/audit-resource", aiLimiter, async (req, res) => {
    const fileName = reqString(req.body?.fileName, 260);
    if (!fileName) {
      return res.status(400).json({ error: "fileName requerido." });
    }
    if (fileName.includes("..") || fileName.includes("/") || fileName.includes("\\")) {
      return res.status(400).json({ error: "Nombre de archivo inv\xE1lido." });
    }
    const filePath = import_path.default.join(UPLOAD_DIR, fileName);
    if (!import_fs.default.existsSync(filePath)) {
      return res.status(404).json({ error: "Archivo no encontrado en el servidor." });
    }
    const ext = import_path.default.extname(fileName).toLowerCase();
    if (ext !== ".pdf") {
      return res.status(400).json({ error: "Solo se puede auditar archivos PDF." });
    }
    const stats = import_fs.default.statSync(filePath);
    const MAX_AUDIT_MB = 15;
    if (stats.size > MAX_AUDIT_MB * 1024 * 1024) {
      return res.status(413).json({ error: `El archivo supera el l\xEDmite de ${MAX_AUDIT_MB} MB para auditor\xEDa.` });
    }
    try {
      const fileBuffer = import_fs.default.readFileSync(filePath);
      const base64Data = fileBuffer.toString("base64");
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `Analiza el documento PDF adjunto siguiendo exactamente las instrucciones del system prompt. Rellena todos los campos del schema JSON con an\xE1lisis detallados y espec\xEDficos al contenido de ESTE documento. No uses frases gen\xE9ricas \u2014 referencia datos, cifras y afirmaciones concretas del paper. Si el documento no es un paper cient\xEDfico formal (e.g., es un libro, ensayo o gu\xEDa), adapta el an\xE1lisis al tipo de documento pero mant\xE9n el mismo rigor cr\xEDtico.`
              },
              {
                inlineData: {
                  mimeType: "application/pdf",
                  data: base64Data
                }
              }
            ]
          }
        ],
        config: {
          systemInstruction: `Eres un auditor cient\xEDfico experto en integridad metodol\xF3gica y pensamiento cr\xEDtico. Tu misi\xF3n es desgranar papers y estudios acad\xE9micos con ojo implacable: identificar sesgos, fallos metodol\xF3gicos, p-hacking, cientificismo y extrapolaciones injustificadas. Tambi\xE9n extraes el aprendizaje real y verificable para el lector. Responde siempre en espa\xF1ol, de forma directa y sin eufemismos.

Para cada campo del schema sigue estas instrucciones:

- titulo_del_estudio: El t\xEDtulo exacto del documento tal como aparece en el PDF.
- veredicto_general: 2-3 oraciones que resuman la solidez global del estudio. S\xE9 directo: \xBFes fiable, parcialmente fiable o cuestionable? \xBFPor qu\xE9?
- nivel_credibilidad: UNA sola palabra: "alto", "medio" o "bajo". Basado en la suma de todos los criterios.

SECCI\xD3N auditoria_epistemologica:
- grado_de_corroboracion_objetiva: \xBFCu\xE1ntos estudios independientes corroboran los resultados? \xBFSon replicables? Menciona si hay corroboraci\xF3n alta, moderada o baja y por qu\xE9.
- infradeterminacion_explicaciones_alternativas: \xBFExisten explicaciones alternativas igualmente v\xE1lidas que el estudio ignora o descarta sin justificaci\xF3n?

SECCI\xD3N diseccion_teorica_y_conceptual:
- falsabilidad_y_riesgo_popperiano: \xBFLa hip\xF3tesis central podr\xEDa ser refutada por alg\xFAn experimento posible? \xBFO est\xE1 formulada de forma que siempre sea "verdadera"?
- brecha_de_validez_de_constructo: \xBFLas m\xE9tricas usadas miden realmente lo que dicen medir? Eval\xFAa si los constructos te\xF3ricos est\xE1n bien operacionalizados.
- hipotesis_ad_hoc_lakatosianas: \xBFEl estudio a\xF1ade suposiciones auxiliares para salvar su teor\xEDa cuando los datos no encajan? Identifica ejemplos concretos si los hay.

SECCI\xD3N escrutinio_metodologico_y_estadistico:
- adecuacion_y_omision_de_controles: \xBFSe usaron grupos control adecuados? \xBFQu\xE9 variables confusoras no se controlaron? S\xE9 espec\xEDfico.
- robustez_y_relevancia_real: \xBFEl tama\xF1o del efecto es cl\xEDnicamente/pr\xE1cticamente significativo, o solo estad\xEDsticamente significativo? \xBFCu\xE1l es el intervalo de confianza real?
- rastros_de_p_hacking: \xBFHay se\xF1ales de selecci\xF3n de variables post-hoc, an\xE1lisis m\xFAltiples no reportados, umbrales p ajustados o muestras ampliadas hasta obtener p<0.05?

SECCI\xD3N auditoria_de_sesgos_y_datos_faltantes:
- sesgo_de_reporte_interno: \xBFSe reportan todos los resultados o solo los favorables? \xBFHay discrepancias entre m\xE9todos declarados y resultados reportados?
- alineacion_de_incentivos: \xBFQui\xE9n financia el estudio? \xBFLos autores tienen conflictos de inter\xE9s? \xBFEl dise\xF1o favorece sistem\xE1ticamente un resultado?

SECCI\xD3N detector_de_cientificismo_y_banderas_rojas:
- brecha_causal_y_extrapolacion: \xBFEl estudio infiere causalidad de datos correlacionales? \xBFGeneraliza a poblaciones/contextos no estudiados?
- cherry_picking_contextual: \xBFSe ignoran estudios previos contradictorios? \xBFSe seleccionan solo los datos que confirman la hip\xF3tesis?
- opacidad_para_refutacion: \xBFLos datos crudos son accesibles? \xBFEl protocolo fue pre-registrado? \xBFEs reproducible el an\xE1lisis?

SECCI\xD3N sintesis_para_el_pensamiento_critico:
- la_realidad_de_los_datos_crudos: En 1-2 oraciones contundentes: \xBFqu\xE9 dicen realmente los datos, sin el spin del resumen de los autores?
- traduccion_de_la_incertidumbre_al_mundo_real: \xBFQu\xE9 significa este estudio para una persona real? \xBFCu\xE1nto debe cambiar su comportamiento/creencias bas\xE1ndose en esto?

SECCI\xD3N guia_de_aprendizaje:
- que_aprender_de_este_documento: Los 2-3 conceptos m\xE1s valiosos y verificables que el lector puede extraer, independientemente de las limitaciones del estudio.
- conceptos_clave_verificados: Lista los t\xE9rminos cient\xEDficos o metodol\xF3gicos clave que aparecen en el estudio y que vale la pena que el lector comprenda profundamente.
- conexiones_con_otros_campos: \xBFCon qu\xE9 otras disciplinas o \xE1reas del conocimiento conecta este estudio? \xBFQu\xE9 lecturas complementarias sugerir\xEDa?
- preguntas_para_reflexion: 2-3 preguntas cr\xEDticas que el lector deber\xEDa hacerse al terminar de leer este documento.
- conclusion_para_el_lector: Una recomendaci\xF3n final directa: \xBFdebe el lector confiar en este estudio, usarlo con cautela, o descartarlo? \xBFPor qu\xE9?`,
          responseMimeType: "application/json",
          responseSchema: {
            type: import_genai.Type.OBJECT,
            properties: {
              titulo_del_estudio: { type: import_genai.Type.STRING },
              veredicto_general: { type: import_genai.Type.STRING },
              nivel_credibilidad: { type: import_genai.Type.STRING },
              auditoria_epistemologica: {
                type: import_genai.Type.OBJECT,
                properties: {
                  grado_de_corroboracion_objetiva: { type: import_genai.Type.STRING },
                  infradeterminacion_explicaciones_alternativas: { type: import_genai.Type.STRING }
                },
                required: ["grado_de_corroboracion_objetiva", "infradeterminacion_explicaciones_alternativas"]
              },
              diseccion_teorica_y_conceptual: {
                type: import_genai.Type.OBJECT,
                properties: {
                  falsabilidad_y_riesgo_popperiano: { type: import_genai.Type.STRING },
                  brecha_de_validez_de_constructo: { type: import_genai.Type.STRING },
                  hipotesis_ad_hoc_lakatosianas: { type: import_genai.Type.STRING }
                },
                required: ["falsabilidad_y_riesgo_popperiano", "brecha_de_validez_de_constructo", "hipotesis_ad_hoc_lakatosianas"]
              },
              escrutinio_metodologico_y_estadistico: {
                type: import_genai.Type.OBJECT,
                properties: {
                  adecuacion_y_omision_de_controles: { type: import_genai.Type.STRING },
                  robustez_y_relevancia_real: { type: import_genai.Type.STRING },
                  rastros_de_p_hacking: { type: import_genai.Type.STRING }
                },
                required: ["adecuacion_y_omision_de_controles", "robustez_y_relevancia_real", "rastros_de_p_hacking"]
              },
              auditoria_de_sesgos_y_datos_faltantes: {
                type: import_genai.Type.OBJECT,
                properties: {
                  sesgo_de_reporte_interno: { type: import_genai.Type.STRING },
                  alineacion_de_incentivos: { type: import_genai.Type.STRING }
                },
                required: ["sesgo_de_reporte_interno", "alineacion_de_incentivos"]
              },
              detector_de_cientificismo_y_banderas_rojas: {
                type: import_genai.Type.OBJECT,
                properties: {
                  brecha_causal_y_extrapolacion: { type: import_genai.Type.STRING },
                  cherry_picking_contextual: { type: import_genai.Type.STRING },
                  opacidad_para_refutacion: { type: import_genai.Type.STRING }
                },
                required: ["brecha_causal_y_extrapolacion", "cherry_picking_contextual", "opacidad_para_refutacion"]
              },
              sintesis_para_el_pensamiento_critico: {
                type: import_genai.Type.OBJECT,
                properties: {
                  la_realidad_de_los_datos_crudos: { type: import_genai.Type.STRING },
                  traduccion_de_la_incertidumbre_al_mundo_real: { type: import_genai.Type.STRING }
                },
                required: ["la_realidad_de_los_datos_crudos", "traduccion_de_la_incertidumbre_al_mundo_real"]
              },
              guia_de_aprendizaje: {
                type: import_genai.Type.OBJECT,
                properties: {
                  que_aprender_de_este_documento: { type: import_genai.Type.STRING },
                  conceptos_clave_verificados: { type: import_genai.Type.STRING },
                  conexiones_con_otros_campos: { type: import_genai.Type.STRING },
                  preguntas_para_reflexion: { type: import_genai.Type.STRING },
                  conclusion_para_el_lector: { type: import_genai.Type.STRING }
                },
                required: ["que_aprender_de_este_documento", "conceptos_clave_verificados", "conexiones_con_otros_campos", "preguntas_para_reflexion", "conclusion_para_el_lector"]
              }
            },
            required: [
              "titulo_del_estudio",
              "veredicto_general",
              "nivel_credibilidad",
              "auditoria_epistemologica",
              "diseccion_teorica_y_conceptual",
              "escrutinio_metodologico_y_estadistico",
              "auditoria_de_sesgos_y_datos_faltantes",
              "detector_de_cientificismo_y_banderas_rojas",
              "sintesis_para_el_pensamiento_critico",
              "guia_de_aprendizaje"
            ]
          }
        }
      });
      const text = response.text;
      if (!text) return res.status(500).json({ error: "Gemini no devolvi\xF3 resultado." });
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        return res.status(500).json({ error: "Respuesta de Gemini no es JSON v\xE1lido." });
      }
      res.json({ result: parsed });
    } catch (error) {
      console.error("[Auditor] Error:", error);
      res.status(500).json({ error: "Error al auditar el documento.", details: error.message });
    }
  });
  if (!IS_PROD) {
    const vite = await (0, import_vite.createServer)({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = import_path.default.join(process.cwd(), "dist");
    app.use(import_express.default.static(distPath, { maxAge: "1d", index: false }));
    app.get("*", (_req, res) => {
      res.sendFile(import_path.default.join(distPath, "index.html"));
    });
  }
  app.use((err, _req, res, _next) => {
    if (err && err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: `Archivo demasiado grande (m\xE1x ${MAX_UPLOAD_MB} MB)` });
    }
    console.error("Unhandled error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Error interno del servidor" });
    }
  });
  app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}  (env=${NODE_ENV})`);
    console.log(`Uploads dir: ${UPLOAD_DIR}  (m\xE1x ${MAX_UPLOAD_MB} MB/archivo)`);
    if (ALLOW_PROXY_HOSTS.length > 0) {
      console.log(`Proxy whitelist: ${ALLOW_PROXY_HOSTS.join(", ")}`);
    }
  });
}
startServer().catch((err) => {
  console.error("Fatal en startServer:", err);
  process.exit(1);
});
//# sourceMappingURL=server.cjs.map
