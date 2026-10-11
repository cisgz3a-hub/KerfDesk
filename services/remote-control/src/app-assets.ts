/** Fixed KerfDesk Remote asset names (ADR-582); nothing else under /app/ is served. */
export const APP_ASSETS = new Set([
  '/app/',
  '/app/app.js',
  '/app/app.css',
  '/app/sw.js',
  '/app/manifest.webmanifest',
  '/app/icon.svg',
  '/app/icon-192.png',
  '/app/icon-512.png',
]);

export function appAssetPath(pathname: string): string {
  return pathname === '/app/' ? '/app/index.html' : pathname;
}

export const APP_DOCUMENT = '/app/';

/** The app shell needs its manifest, service worker, same-origin socket and local camera. */
export const APP_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "connect-src 'self' wss://kerfdesk-phone-control.cisgz3a.workers.dev",
  "img-src 'self' data: blob:",
  'media-src blob:',
  "manifest-src 'self'",
  "worker-src 'self'",
  "font-src 'self'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join('; ');
