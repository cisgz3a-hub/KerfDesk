import { trustedAppRequest } from './app-route-guard.js';
import type { ProtocolHandler } from './licensing-routes.js';
import { configureAutoUpdater, type DesktopUpdater } from './auto-update.js';

const READY_PATH = '/api/desktop/workspace-ready';
const HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

type BackgroundOptions = {
  readonly isPackaged: boolean;
  readonly trustedUpdates: boolean;
  readonly startCamera?: (() => void | Promise<void>) | undefined;
  readonly reportError?: (error: unknown) => void;
};

export function createDesktopBackgroundStartup(
  licence: { readonly config: { readonly channel: string }; readonly start: () => void },
  updater: DesktopUpdater,
  options: BackgroundOptions,
) {
  return createDesktopStartup(() => {
    licence.start();
    void options.startCamera?.();
    configureAutoUpdater(updater, {
      isPackaged: options.isPackaged,
      isChannelTrusted: options.trustedUpdates && licence.config.channel === 'free',
      onError:
        options.reportError ??
        ((error: unknown) => console.warn('Desktop update check failed:', error)),
    });
  });
}

/**
 * Native background work waits for the renderer's opening gates. In particular,
 * publishing first-use terms must not start a saved licence refresh underneath
 * its agreement screen. This does not make a licence a workspace or job guard.
 */
export function createDesktopStartup(start: () => void) {
  let ready = false;
  const open = (): void => {
    if (ready) return;
    start();
    ready = true;
  };
  return {
    /** Only an unpackaged, loopback development renderer opens directly. */
    open,
    routes:
      (fallback: ProtocolHandler): ProtocolHandler =>
      async (request) => {
        const url = new URL(request.url);
        if (url.pathname === READY_PATH) {
          if (
            request.method !== 'POST' ||
            request.body !== null ||
            !trustedAppRequest(request, url, 'X-KerfDesk-Desktop')
          )
            return new Response('Not Found', { status: 404, headers: HEADERS });
          try {
            open();
          } catch {
            return new Response('Startup unavailable', { status: 503, headers: HEADERS });
          }
          return new Response(null, { status: 204, headers: HEADERS });
        }
        if (!ready && url.pathname.startsWith('/api/licensing/')) {
          if (!trustedAppRequest(request, url, 'X-KerfDesk-Licensing'))
            return new Response('Not Found', { status: 404, headers: HEADERS });
          return new Response('Workspace is not open', { status: 503, headers: HEADERS });
        }
        return fallback(request);
      },
  };
}
