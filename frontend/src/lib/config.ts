/** Build-time configuration. The product name lives here (and in the PWA manifest). */
export const APP_NAME = import.meta.env.VITE_FOODO_APP_NAME ?? 'Foodo';
export const APP_VERSION = __FOODO_VERSION__;
/** Static (GitHub Pages) build: guest mode only, no server API. */
export const STATIC_BUILD = __FOODO_STATIC__;
/** Android app build (always also a static guest-mode build). Native-only code is loaded lazily
 * behind this flag, so the web builds do not contain it. */
export const NATIVE_BUILD = __FOODO_NATIVE__;
export const API_BASE = (import.meta.env.VITE_FOODO_API_BASE as string | undefined) ?? '/api';
export const DEFAULT_TIMEZONE = 'Europe/Moscow';
export const CURRENCY = 'RUB';
