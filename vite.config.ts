import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      // PWA: la app se instala en el teléfono y abre SIN conexión.
      // - precache: el shell completo (JS/CSS/HTML) queda en el dispositivo.
      // - /api/files/* (los archivos de libro): CacheFirst contra el caché
      //   'offline-books' — el MISMO caché donde el botón "Leer sin conexión"
      //   (pestaña ⓘ) guarda la descarga explícita. rangeRequests sirve las
      //   peticiones parciales de pdf.js desde la respuesta completa cacheada.
      // - /api/library*: NetworkFirst — con red usa el servidor; sin red
      //   muestra la última biblioteca conocida (sin esto, la app abriría
      //   offline pero con la biblioteca vacía y ningún libro que abrir).
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.png', 'icon.png', 'logo.png'],
        manifest: {
          name: 'Biblioteca',
          short_name: 'Biblioteca',
          description: 'Biblioteca personal con lector PDF/EPUB y lectura por voz',
          lang: 'es',
          display: 'standalone',
          start_url: '/',
          background_color: '#f8fafc',
          theme_color: '#00558F',
          icons: [
            {src: '/pwa-192.png', sizes: '192x192', type: 'image/png'},
            {src: '/pwa-512.png', sizes: '512x512', type: 'image/png'},
            {src: '/pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable'},
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,mjs,css,html,ico,png,svg,woff2}'],
          // El bundle principal (~2.2MB) y el worker de pdf.js (~1MB) superan
          // el límite por defecto de 2MB — sin esto quedarían fuera del
          // precache y la app no abriría offline.
          maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [/^\/api\//],
          runtimeCaching: [
            {
              urlPattern: ({url}) => url.pathname.startsWith('/api/files/'),
              handler: 'CacheFirst',
              options: {
                cacheName: 'offline-books',
                rangeRequests: true,
                cacheableResponse: {statuses: [200]},
              },
            },
            {
              urlPattern: ({url, request}) =>
                request.method === 'GET' && url.pathname.startsWith('/api/library'),
              handler: 'NetworkFirst',
              options: {
                cacheName: 'api-library',
                networkTimeoutSeconds: 8,
                cacheableResponse: {statuses: [200]},
              },
            },
          ],
        },
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      allowedHosts: true as const,
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
