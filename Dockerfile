# ── Etapa 1: build ────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Instalar dependencias nativas necesarias por @napi-rs/canvas y sharp
RUN apk add --no-cache python3 make g++ pkgconfig cairo-dev pango-dev jpeg-dev giflib-dev librsvg-dev

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ── Etapa 2: runtime ──────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

WORKDIR /app

# Solo las libs nativas de runtime (canvas, sharp)
RUN apk add --no-cache cairo pango jpeg giflib librsvg

# Copiar solo lo necesario
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

# Directorio persistente para uploads (montar como volumen en el VPS)
RUN mkdir -p uploads && chown node:node uploads

USER node

EXPOSE 3000

CMD ["node", "dist/server.cjs"]
