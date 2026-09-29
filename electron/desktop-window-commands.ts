// File > Exit and Help > Open Data Folder in the desktop app (ADR-554).
// A page's own window.close() skips the close question and the job Abort
// handoff (desktop-window-close.ts), so Exit asks the main process to quit
// the way the operating system's Quit does: each window runs its close guard
// first, and Cancel keeps KerfDesk open. Open Data Folder shows where
// KerfDesk keeps its settings, licence record and support log (ADR-546), so
// a customer can find or back it up when support asks.

import { app, shell } from 'electron';
import { trustedAppRequest } from './app-route-guard.js';

type ProtocolHandler = (request: Request) => Promise<Response>;

export type DesktopWindowCommands = {
  /** Quits through every window's close guard. */
  readonly exit: () => void;
  /** Opens the data folder in the file manager: '' when it opened, else why not. */
  readonly openDataFolder: () => Promise<string>;
  readonly dataFolder: () => string;
};

const EXIT_PATH = '/api/desktop/exit';
const DATA_FOLDER_PATH = '/api/desktop/data-folder';
const HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

export const ELECTRON_WINDOW_COMMANDS: DesktopWindowCommands = {
  exit: () => app.quit(),
  openDataFolder: () => shell.openPath(app.getPath('userData')),
  dataFolder: () => app.getPath('userData'),
};

/**
 * `POST app://app/api/desktop/exit` answers 204 and then quits;
 * `POST app://app/api/desktop/data-folder` answers 204 once the file manager
 * opened the folder, or 500 with `{ "folder": path }` so the window can say
 * where it is. Both take the checks every KerfDesk route makes; other paths
 * go on to the next route.
 */
export function withDesktopWindowCommands(
  fallback: ProtocolHandler,
  commands: DesktopWindowCommands = ELECTRON_WINDOW_COMMANDS,
): ProtocolHandler {
  return async (request) => {
    const url = new URL(request.url);
    if (url.pathname !== EXIT_PATH && url.pathname !== DATA_FOLDER_PATH) return fallback(request);
    if (request.method !== 'POST' || !trustedAppRequest(request, url, 'X-KerfDesk-Desktop'))
      return new Response('Not Found', { status: 404, headers: HEADERS });
    if (url.pathname === EXIT_PATH) {
      // Answer first: quitting asks this same window whether it may close.
      setTimeout(commands.exit, 0);
      return new Response(null, { status: 204, headers: HEADERS });
    }
    const failure = await commands.openDataFolder().catch((error: unknown) => String(error));
    if (failure === '') return new Response(null, { status: 204, headers: HEADERS });
    console.warn(`The data folder could not be opened: ${failure}`);
    return Response.json({ folder: commands.dataFolder() }, { status: 500, headers: HEADERS });
  };
}
