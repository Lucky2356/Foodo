import type { CapacitorConfig } from '@capacitor/cli';

// Android app: a WebView wrapper around the guest-mode static build (`npm run build:android`, Vite mode "android").
// The web bundle is packaged inside the APK and served from https://localhost by Capacitor;
// nothing is loaded from a remote web server. See docs/ANDROID.md.
const config: CapacitorConfig = {
  appId: 'io.github.lucky2356.foodo',
  appName: 'Foodo',
  webDir: 'dist-android',
  // Logs only in debug builds (Capacitor default, stated explicitly).
  loggingBehavior: 'debug',
  server: {
    // The page origin is https://localhost. Guest data (IndexedDB) belongs to this origin:
    // changing the scheme or hostname in a later version would leave existing data behind.
    androidScheme: 'https',
  },
  android: {
    // No http:// content inside the https://localhost page.
    allowMixedContent: false,
    // webContentsDebuggingEnabled is intentionally not set: Capacitor then enables WebView
    // debugging only for debuggable (debug) builds, never for the signed release APK.
  },
  plugins: {
    SystemBars: {
      // index.html declares viewport-fit=cover and the CSS pads with env(safe-area-inset-*).
      insetsHandling: 'native',
      initialViewportFitValueHint: 'cover',
    },
  },
};

export default config;
