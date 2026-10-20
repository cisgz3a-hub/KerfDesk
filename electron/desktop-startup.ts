import { trustedAppRequest } from './app-route-guard.js';
import type { ProtocolHandler } from './licensing-routes.js';
import { configureAutoUpdater, type DesktopUpdater } from './auto-update.js';
import type { WorkspaceAdmission } from './licensing-startup-signals.js';

const READY_PATH = '/api/desktop/workspace-ready';
const HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

type BackgroundOptions = {
  readonly isPackaged: boolean;
  readonly trustedUpdates: boolean;
  readonly startCamera?: (() => void | Promise<void>) | undefined;
  readonly stopCamera?: (() => void | Promise<void>) | undefined;
  readonly reportError?: (error: unknown) => void;
};

export function createDesktopBackgroundStartup(
  licence: {
    readonly config: { readonly channel: string };
    readonly start: () => void;
    /** Whether a workspace is admitted: the camera bridge runs only then (ADR-623). */
    readonly admission?: WorkspaceAdmission;
  },
  updater: DesktopUpdater,
  options: BackgroundOptions,
) {
  const runCamera = (admitted: boolean): void => {
    void (admitted ? options.startCamera?.() : options.stopCamera?.());
  };
  return createDesktopStartup(
    () => {
      licence.start();
      if (licence.admission === undefined) runCamera(true);
      else licence.admission.onChange(runCamera);
      configureAutoUpdater(updater, {
        isPackaged: options.isPackaged,
        isChannelTrusted: options.trustedUpdates && licence.config.channel === 'free',
        onError:
          options.reportError ??
          ((error: unknown) => console.warn('Desktop update check failed:', error)),
      });
    },
    // Each renderer, a reopened macOS window or a reload, holds services until it
    // acknowledges its mounted workspace.
    () => licence.admission?.rendererOpening(),
  );
}

/**
 * Native background work waits for the renderer's opening gates. In particular,
 * publishing first-use terms must not start a saved licence refresh underneath
 * its agreement screen. This does not make a licence a workspace or job guard.
 */
export function createDesktopStartup(start: () => void, eachRenderer?: () => void) {
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
            eachRenderer?.();
            open();
          } catch {
            return new Response('Startup unavailable', { status: 503, headers: HEADERS });
          }
          return new Response(null, { status: 204, headers: HEADERS });
        }
        const openingHeader = url.pathname.startsWith('/api/licensing/')
          ? 'X-KerfDesk-Licensing'
          : url.pathname.startsWith('/api/remote/')
            ? 'X-KerfDesk-Remote'
            : null;
        if (!ready && openingHeader !== null) {
          if (!trustedAppRequest(request, url, openingHeader))
            return new Response('Not Found', { status: 404, headers: HEADERS });
          return new Response('Workspace is not open', { status: 503, headers: HEADERS });
        }
        return fallback(request);
      },
  };
}
