# Guía de despliegue en VPS — Bibliotequita

## Requisitos previos

El VPS debe tener Ubuntu 20.04 o superior. Todos los comandos se ejecutan como usuario con `sudo`.

---

## Paso 1 — Instalar Docker

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
```

Cierra la sesión SSH y vuelve a entrar para que el grupo tome efecto.

Verifica que funciona:
```bash
docker --version
```

---

## Paso 2 — Instalar Git

```bash
sudo apt update && sudo apt install -y git
```

---

## Paso 3 — Clonar el repositorio

```bash
git clone https://github.com/asagredoavanzasmart-ia/bibliotequita.git
cd bibliotequita
```

---

## Paso 4 — Crear el archivo de variables de entorno

```bash
nano .env
```

Pega el siguiente contenido y rellena los valores reales:

```
NODE_ENV=production
PORT=3000
TRUST_PROXY=1

GEMINI_API_KEY=tu_clave_de_gemini
ELEVENLABS_API_KEY=tu_clave_de_elevenlabs
ELEVENLABS_VOICE_ID=lLsDvdl6OjtZfLJPM2HA

ADMIN_USERNAME=superblibliotequita
ADMIN_PASSWORD=tu_contraseña_segura
SESSION_SECRET=pon-aqui-una-frase-larga-y-aleatoria

DEMO_MAX_UPLOADS=0
```

> **Nota:** `DEMO_MAX_UPLOADS=0` desactiva el límite de subidas. En tu servidor propio no necesitas restricción.

Guarda con `Ctrl+O` y cierra con `Ctrl+X`.

---

## Paso 5 — Crear la carpeta de uploads persistente

```bash
mkdir -p ~/bibliotequita-uploads
```

Esta carpeta vive fuera del contenedor. Los archivos subidos sobreviven aunque reinicies o actualices la app.

---

## Paso 6 — Construir la imagen Docker

```bash
docker build -t bibliotequita .
```

La primera vez tarda entre 3 y 5 minutos.

---

## Paso 7 — Correr el contenedor

```bash
docker run -d \
  --name bibliotequita \
  --restart unless-stopped \
  -p 3000:3000 \
  -v ~/bibliotequita-uploads:/app/uploads \
  --env-file .env \
  bibliotequita
```

---

## Paso 8 — Verificar que funciona

```bash
docker logs bibliotequita
```

Deberías ver:
```
Server running on port 3000
```

Abre en el navegador: `http://IP_DE_TU_VPS:3000`

---

## Actualizar la app cuando haya cambios en GitHub

```bash
cd ~/bibliotequita
git pull
docker build -t bibliotequita .
docker stop bibliotequita && docker rm bibliotequita
docker run -d \
  --name bibliotequita \
  --restart unless-stopped \
  -p 3000:3000 \
  -v ~/bibliotequita-uploads:/app/uploads \
  --env-file .env \
  bibliotequita
```

---

## Opcional — Nginx + HTTPS (dominio propio)

Si quieres usar `https://tudominio.com` en vez de `http://ip:3000`:

### Instalar Nginx y Certbot

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
```

### Configurar el sitio

```bash
sudo nano /etc/nginx/sites-available/bibliotequita
```

Pega esto (reemplaza `tudominio.com`):

```nginx
server {
    listen 80;
    server_name tudominio.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        client_max_body_size 200M;
    }
}
```

### Activar el sitio

```bash
sudo ln -s /etc/nginx/sites-available/bibliotequita /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### Obtener certificado SSL gratuito

```bash
sudo certbot --nginx -d tudominio.com
```

Certbot configura HTTPS automáticamente y renueva el certificado cada 90 días.

---

## Comandos útiles de Docker

| Acción | Comando |
|---|---|
| Ver logs en vivo | `docker logs -f bibliotequita` |
| Entrar al contenedor | `docker exec -it bibliotequita sh` |
| Detener | `docker stop bibliotequita` |
| Eliminar contenedor | `docker rm bibliotequita` |
| Ver contenedores activos | `docker ps` |
| Ver uso de disco | `docker system df` |

---

## Opcional — Supabase autoalojado en el VPS (almacenamiento de archivos)

Esta sección instala un stack de **Supabase self-hosted** (Postgres + Storage API + Kong + Auth + Studio) en el mismo VPS, usando Docker Compose. Sirve para mover los PDF/EPUB/portadas que hoy se guardan en `~/bibliotequita-uploads` a un bucket de Supabase Storage. **Esta instalación es independiente del contenedor `bibliotequita`** — corre en sus propios contenedores y puertos.

> Requiere al menos 2 GB de RAM libres en el VPS (idealmente 4 GB+). Si tu VPS es muy pequeño, considera ampliarlo antes de seguir.

### Paso S1 — Clonar el repositorio oficial de Supabase

```bash
cd ~
git clone --depth 1 https://github.com/supabase/supabase.git supabase-src
cd supabase-src/docker
```

### Paso S2 — Crear el archivo `.env`

```bash
cp .env.example .env
```

Genera las claves y contraseñas necesarias. Supabase necesita:

- `POSTGRES_PASSWORD` — contraseña de la base de datos.
- `JWT_SECRET` — secreto para firmar los tokens (mínimo 32 caracteres).
- `ANON_KEY` y `SERVICE_ROLE_KEY` — claves JWT derivadas del `JWT_SECRET`.
- `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD` — acceso al panel Studio.

Genera un `JWT_SECRET` aleatorio:

```bash
openssl rand -base64 48 | tr -d '\n' | cut -c1-40
```

Para generar `ANON_KEY` y `SERVICE_ROLE_KEY` a partir de ese `JWT_SECRET`, usa el generador oficial de Supabase:
[https://supabase.com/docs/guides/self-hosting/docker#securing-your-services](https://supabase.com/docs/guides/self-hosting/docker#securing-your-services)
(pega tu `JWT_SECRET` ahí y copia las dos claves generadas).

Edita el `.env`:

```bash
nano .env
```

Como mínimo, ajusta estas variables:

```
POSTGRES_PASSWORD=elige-una-contraseña-fuerte
JWT_SECRET=el-secreto-de-32+-caracteres-que-generaste
ANON_KEY=la-clave-anon-generada
SERVICE_ROLE_KEY=la-clave-service-role-generada

DASHBOARD_USERNAME=admin
DASHBOARD_PASSWORD=elige-otra-contraseña-fuerte

# URLs públicas: si no tienes dominio propio, usa la IP del VPS
SITE_URL=http://IP_DE_TU_VPS:8000
API_EXTERNAL_URL=http://IP_DE_TU_VPS:8000
SUPABASE_PUBLIC_URL=http://IP_DE_TU_VPS:8000
```

> Las claves `ANON_KEY` y `SERVICE_ROLE_KEY` son secretas. No las compartas ni las subas a GitHub — guárdalas igual que las del `.env` de Bibliotequita.

### Paso S3 — Levantar el stack

```bash
docker compose pull
docker compose up -d
```

La primera vez descarga varias imágenes (Postgres, Kong, GoTrue, Storage API, Studio, etc.) y puede tardar varios minutos.

Verifica que todos los servicios estén corriendo:

```bash
docker compose ps
```

### Paso S4 — Acceder a Studio y crear el bucket de almacenamiento

Abre `http://IP_DE_TU_VPS:8000` en el navegador (puerto del proxy Kong) e inicia sesión con `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD`.

1. Ve a **Storage** en el menú lateral.
2. Crea un nuevo bucket llamado, por ejemplo, `library-files`.
3. Déjalo **privado** (no público) — Bibliotequita accederá a los archivos a través del backend usando la `SERVICE_ROLE_KEY`, no directamente desde el navegador.

### Paso S5 — Abrir el puerto en el firewall (si aplica)

```bash
sudo ufw allow 8000/tcp
```

Si solo vas a usar Supabase desde el propio servidor (el contenedor `bibliotequita` accede por red interna), puedes omitir este paso y mantener el puerto 8000 cerrado al exterior.

### Datos que necesitarás para el siguiente paso

Cuando este stack esté corriendo, ten a mano (sin compartirlos en texto plano si es posible):

- **URL de Supabase**: `http://IP_DE_TU_VPS:8000` (o tu dominio si configuraste Nginx).
- **`SERVICE_ROLE_KEY`** generada en el paso S2.
- **Nombre del bucket**: `library-files`.

Con estos tres datos se actualizará `server.ts` para que `/api/upload`, `/api/files/:name` y el resto de endpoints que leen archivos lean y escriban en este bucket en lugar del disco local.

### Comandos útiles de Supabase

| Acción | Comando |
|---|---|
| Ver logs en vivo | `docker compose logs -f` |
| Detener el stack | `docker compose down` |
| Reiniciar el stack | `docker compose restart` |
| Actualizar imágenes | `docker compose pull && docker compose up -d` |
