import { createArtcraftRuntime } from './artcraft-runtime.js';
import { withArtcraftRoutes } from './artcraft-routes.js';
import { createArtcraftWindowHost, type ArtcraftWindowHost } from './artcraft-window-host.js';
import type { BrowserWindow } from 'electron';
import type { ProtocolHandler } from './licensing-routes.js';

let mainWindow: BrowserWindow | undefined;
let host: ArtcraftWindowHost | undefined;
let disposing: Promise<void> | undefined;

/** Registered by main, never selected using renderer-supplied handles. */
export function installDesktopArtcraftWindow(window: BrowserWindow): void {
  mainWindow = window;
  window.once('closed', () => {
    if (mainWindow === window) mainWindow = undefined;
  });
}
export function getDesktopArtcraftHost(): ArtcraftWindowHost {
  if (disposing) throw new Error('The editor host is closing.');
  if (!mainWindow || mainWindow.isDestroyed()) throw new Error('KerfDesk window is unavailable.');
  host ??= createArtcraftWindowHost(mainWindow.getNativeWindowHandle());
  return host;
}
/** Called by the existing close guard after consent, before HWND destruction. */
export async function detachDesktopArtcraftWindows(): Promise<void> {
  if (!host) return;
  if (disposing) return disposing;
  const current = host;
  disposing = current.dispose().then(() => {
    if (host === current) host = undefined;
  });
  try {
    await disposing;
  } finally {
    disposing = undefined;
  }
}

/** Opt-in prototype. Editors are unmodified local apps, never remote web content. */
export function withDesktopArtcraft(
  fallback: ProtocolHandler,
  userDataPath: string,
): ProtocolHandler {
  return withArtcraftRoutes(
    fallback,
    createArtcraftRuntime(
      userDataPath,
      process.env['KERFDESK_ARTCRAFT_ROOT'],
      getDesktopArtcraftHost,
    ),
  );
}
