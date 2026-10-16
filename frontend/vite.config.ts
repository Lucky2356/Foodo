import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

// Modes:
//  - default (server): the SPA is served by nginx next to the Django API (/api);
//  - "static": GitHub Pages build — guest mode only, relative base path, hash routing.
export default defineConfig(({ mode }) => {
  const isStatic = mode === 'static';
  return {
    base: isStatic ? './' : '/',
    define: {
      __FOODO_STATIC__: JSON.stringify(isStatic),
      __FOODO_VERSION__: JSON.stringify(process.env.FOODO_VERSION ?? 'dev'),
    },
    plugins: [
      react(),
      VitePWA({
        registerType: 'prompt',
        injectRegister: null,
        includeAssets: ['icons/*.png', 'icons/*.svg', 'offline.html'],
        manifest: {
          name: 'Foodo — планирование питания',
          short_name: 'Foodo',
          description: 'Бесплатное меню на неделю, рецепты, КБЖУ и список покупок для семьи.',
          lang: 'ru',
          start_url: '.',
          scope: '.',
          display: 'standalone',
          background_color: '#f7f5ef',
          theme_color: '#2f6b4f',
          icons: [
            { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,woff2,json}'],
          navigateFallback: 'index.html',
          navigateFallbackDenylist: [/^\/api\//, /^\/admin\//, /^\/static\//],
          maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
          // Only the public catalog is cached at runtime. Private API responses are never cached by
          // the service worker; the account's offline copy lives in a per-account IndexedDB that is
          // wiped on logout.
          runtimeCaching: [
            {
              urlPattern: ({ url }) => url.pathname.startsWith('/api/catalog/'),
              handler: 'StaleWhileRevalidate',
              options: { cacheName: 'foodo-public-catalog', expiration: { maxEntries: 20 } },
            },
          ],
        },
      }),
    ],
    server: {
      fs: { allow: [repoRoot] },
      proxy: {
        '/api': 'http://127.0.0.1:8000',
        '/admin': 'http://127.0.0.1:8000',
        '/static/admin': 'http://127.0.0.1:8000',
      },
    },
    build: { outDir: isStatic ? 'dist-static' : 'dist', sourcemap: false, chunkSizeWarningLimit: 1500 },
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts'],
      testTimeout: 30000,
    },
  };
});
