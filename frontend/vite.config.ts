import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import type { Plugin } from 'vite';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

// Content Security Policy for built pages. GitHub Pages cannot send headers, so the policy is a
// <meta> tag; nginx sends the same policy as a header (plus frame-ancestors, which a meta tag
// cannot carry). Not applied to the dev server, whose hot reload needs inline scripts.
// The Android app (mode "android") uses the same policy inside its WebView: the page is served
// from https://localhost ('self'), and the updater's requests to GitHub are made by native
// Java code, which the page's CSP does not govern, so no extra source is needed. Capacitor
// injects its bridge script before this tag is parsed.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  // React style={…} props are inline style attributes.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const cspMeta: Plugin = {
  name: 'foodo-csp-meta',
  apply: 'build',
  transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' }],
};

// Modes:
//  - default (server): the SPA is served by nginx next to the Django API (/api);
//  - "static": GitHub Pages build — guest mode only, relative base path, hash routing;
//  - "android": the same guest-mode build packaged into the Android APK (frontend/android):
//    no service worker (updates come with the APK), native updater UI.
/**
 * The Django API behind the dev and preview servers. The Host header is kept (changeOrigin: false;
 * Vite's string shorthand would rewrite it), so Django's CSRF origin check sees the same host as the
 * browser, as it does behind nginx in production.
 */
function backendProxy(target: string) {
  const route = { target, changeOrigin: false };
  return { '/api': route, '/admin': route, '/static/admin': route };
}

export default defineConfig(({ mode }) => {
  const isAndroid = mode === 'android';
  const isStatic = mode === 'static' || isAndroid;
  return {
    base: isStatic ? './' : '/',
    define: {
      __FOODO_STATIC__: JSON.stringify(isStatic),
      __FOODO_NATIVE__: JSON.stringify(isAndroid),
      __FOODO_VERSION__: JSON.stringify(process.env.FOODO_VERSION ?? 'dev'),
    },
    plugins: [
      react(),
      cspMeta,
      VitePWA({
        disable: isAndroid,
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
          background_color: '#fffbf2',
          theme_color: '#16a34a',
          icons: [
            { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,woff2,json,ttf}'],
          // Price data is large and changes weekly: fetched at runtime (below), not precached.
          globIgnores: ['data/prices/**'],
          navigateFallback: 'index.html',
          // The first installed worker takes over the open page at once, so screens loaded later
          // (lazy chunks) come from the cache even if the network drops before the next reload.
          clientsClaim: true,
          navigateFallbackDenylist: [/^\/api\//, /^\/admin\//, /^\/static\//],
          maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
          // Only the public catalog is cached at runtime. Private API responses are never cached by
          // the service worker; the account's offline copy lives in a per-account IndexedDB that is
          // wiped on logout.
          runtimeCaching: [
            {
              // Published public prices: the latest copy when online, the cached one offline.
              urlPattern: ({ url }) => url.pathname.includes('/data/prices/'),
              handler: 'NetworkFirst',
              options: { cacheName: 'foodo-public-prices', networkTimeoutSeconds: 4, expiration: { maxEntries: 50 } },
            },
            {
              // Recipe photos (self-hosted WebP copies from Wikimedia Commons): cached once seen.
              urlPattern: ({ url }) => /\/photos\/(thumb\/)?[^/]+\.webp$/.test(url.pathname),
              handler: 'CacheFirst',
              options: { cacheName: 'foodo-photos', expiration: { maxEntries: 800 } },
            },
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
      proxy: backendProxy('http://127.0.0.1:8000'),
    },
    preview: {
      proxy: backendProxy(process.env.FOODO_BACKEND_URL ?? 'http://127.0.0.1:8000'),
    },
    build: { outDir: isAndroid ? 'dist-android' : isStatic ? 'dist-static' : 'dist', sourcemap: false, chunkSizeWarningLimit: 1500 },
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts'],
      testTimeout: 30000,
    },
  };
});
