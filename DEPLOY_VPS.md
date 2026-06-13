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
