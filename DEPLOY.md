# Deploy en un VPS

Guía mínima para correr la aplicación en un VPS Linux (Ubuntu/Debian) detrás de Nginx con SSL, con persistencia de archivos y arranque automático con PM2.

> ⚠️ **Antes de empezar:** la clave `GEMINI_API_KEY` que estaba en `.env.example` ha estado en el repositorio. Considérala comprometida y **revócala / genera una nueva** en https://aistudio.google.com/app/apikey.

---

## 1. Requisitos del VPS

- Ubuntu 22.04 (o similar) con `sudo`.
- Node.js 20+ (`curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs`).
- Nginx (`sudo apt install nginx`).
- Certbot para SSL (`sudo apt install certbot python3-certbot-nginx`).
- PM2 global (`sudo npm install -g pm2`).

---

## 2. Clonar y construir

```bash
sudo mkdir -p /opt/biblioteca && sudo chown $USER:$USER /opt/biblioteca
cd /opt/biblioteca
git clone <tu-repo> .
npm ci
npm run build   # genera dist/ (frontend) y dist/server.cjs (backend bundle)
```

---

## 3. Variables de entorno

Copia `.env.example` a `.env` y edita los valores para producción:

```bash
cp .env.example .env
nano .env
```

Valores recomendados para producción:

```
NODE_ENV=production
PORT=3000
HOST=127.0.0.1                          # solo localhost; Nginx hace el frontend externo
TRUST_PROXY=1                           # estás detrás de Nginx
CORS_ORIGIN=https://biblioteca.midominio.com
UPLOAD_DIR=/var/lib/biblioteca/uploads  # fuera del repo, en un volumen persistente
MAX_UPLOAD_MB=200
RATE_LIMIT_WINDOW_MIN=15
RATE_LIMIT_MAX=300
AI_RATE_LIMIT_WINDOW_MIN=5
AI_RATE_LIMIT_MAX=30
ALLOW_PROXY_HOSTS=                      # vacío = bloquear IPs privadas y nada más
GEMINI_API_KEY=la_clave_nueva_y_rotada
```

Crea el directorio de uploads:

```bash
sudo mkdir -p /var/lib/biblioteca/uploads
sudo chown $USER:$USER /var/lib/biblioteca/uploads
```

---

## 4. Arranque con PM2

```bash
pm2 start dist/server.cjs --name biblioteca --update-env
pm2 save
pm2 startup    # genera el comando para arranque automático tras reboot
```

Comprobar:

```bash
curl http://127.0.0.1:3000/api/health
# → {"ok":true,"env":"production","time":"..."}
```

---

## 5. Nginx como reverse proxy

Crea `/etc/nginx/sites-available/biblioteca`:

```nginx
server {
    listen 80;
    server_name biblioteca.midominio.com;

    # Permitir uploads grandes (igual o mayor que MAX_UPLOAD_MB).
    client_max_body_size 220M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 90s;
    }
}
```

Activar y aplicar SSL:

```bash
sudo ln -s /etc/nginx/sites-available/biblioteca /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d biblioteca.midominio.com
```

---

## 6. Persistencia y backups

Datos que importan:

| Qué | Dónde | Cómo respaldarlo |
|---|---|---|
| Archivos subidos (PDF/EPUB/portadas) | `/var/lib/biblioteca/uploads/` | `tar`/`rsync` periódico a otro servidor o bucket. |
| Metadata (lista de libros, notas, marcadores, etc.) | **Navegador del usuario** (`localStorage`) | Hoy no hay backup automático — pendiente: feature de export/import JSON (§8 del DOC). |
| `.env` con `GEMINI_API_KEY` | `/opt/biblioteca/.env` | Backup separado, encriptado. |

Cron simple para backup de uploads (diario a las 03:00):

```cron
0 3 * * * tar -czf /backup/biblioteca-uploads-$(date +\%F).tar.gz -C /var/lib/biblioteca uploads
```

---

## 7. Actualizar la app

```bash
cd /opt/biblioteca
git pull
npm ci
npm run build
pm2 restart biblioteca --update-env
```

---

## 8. Checklist de seguridad antes de exponer al público

- [ ] `GEMINI_API_KEY` rotada (la del repo está comprometida).
- [ ] `.env` con permisos `chmod 600`.
- [ ] `NODE_ENV=production` (activa CSP estricta de Helmet).
- [ ] `CORS_ORIGIN` configurado a tu dominio (no `*`).
- [ ] SSL activo con Certbot.
- [ ] `TRUST_PROXY=1` para que rate-limit cuente por IP real, no por IP de Nginx.
- [ ] Si te preocupa el coste de Gemini, baja `AI_RATE_LIMIT_MAX`.
- [ ] Si quieres restringir el proxy a fuentes confiables, define `ALLOW_PROXY_HOSTS`.
- [ ] Backups de `uploads/` configurados.
- [ ] Firewall del VPS abre sólo 22, 80, 443 (`ufw allow OpenSSH && ufw allow 'Nginx Full' && ufw enable`).

---

## Notas técnicas

- **`/api/files/:name`** sirve los archivos con `Cache-Control: public, max-age=31536000, immutable`. Como los nombres incluyen un UUID, el cache es seguro.
- **Anti-SSRF:** `/api/proxy-resource` y `/api/analyze-url` bloquean automáticamente IPs privadas, loopback, link-local (incluido el metadata service de AWS/GCP `169.254.169.254`) y `localhost`. La whitelist opcional `ALLOW_PROXY_HOSTS` añade una capa más.
- **Rate limit:** dos buckets. Global (`RATE_LIMIT_*`) para todo `/api/*` y específico (`AI_RATE_LIMIT_*`) sólo para los endpoints que llaman a Gemini.
- **Carpeta uploads:** se sirve sólo a través del endpoint `/api/files/:name`, nunca con `express.static`. Eso permite añadir auth en el futuro sin cambiar URLs.
