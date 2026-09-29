// Windows restarting, shutting down or signing out during a job (ADR-548).
// Electron does not run the close handoff then: Windows ends the process
// without a window close or before-quit. A stream cut off mid-job can leave
// the machine running its buffered moves, with a spindle or constant-power
// laser still on. So while the window reports a running job, KerfDesk asks
// Windows to wait and says why, and when Windows ends the session anyway the
// window sends the same Abort as closing KerfDesk. Each step goes to the
// support log (ADR-546).

import { trustedAppRequest } from './app-route-guard.js';

export type SessionEndPhase = 'asked' | 'ending';

/** Whether the window has a job running, as it last reported. */
export type DesktopJobActivity = {
  readonly busy: () => boolean;
  readonly set: (busy: boolean) => void;
};

interface SessionEndEvent {
  readonly reasons: ReadonlyArray<string>;
  preventDefault(): void;
}

interface SessionEndTarget {
  on(
    event: 'query-session-end' | 'session-end',
    listener: (event: SessionEndEvent) => void,
  ): unknown;
  readonly webContents: {
    executeJavaScript(code: string): Promise<unknown>;
    on(event: 'render-process-gone' | 'did-finish-load', listener: () => void): unknown;
  };
}

type ProtocolHandler = (request: Request) => Promise<Response>;

const ACTIVITY_PATH = '/api/desktop/activity';
const HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const REASONS = ['shutdown', 'close-app', 'critical', 'logoff'] as const;

export function createDesktopJobActivity(): DesktopJobActivity {
  let busy = false;
  return {
    busy: () => busy,
    set: (next) => {
      busy = next;
    },
  };
}

/** The main window's reports, shared by its route and its guard. */
export const DESKTOP_JOB_ACTIVITY = createDesktopJobActivity();

export function installSessionEndGuard(
  window: SessionEndTarget,
  activity: DesktopJobActivity = DESKTOP_JOB_ACTIVITY,
  log: (message: string) => void = (message) => console.warn(message),
): void {
  // A new or crashed page has no job; it reports one when a job starts.
  window.webContents.on('did-finish-load', () => activity.set(false));
  window.webContents.on('render-process-gone', () => activity.set(false));
  window.on('query-session-end', (event) => {
    if (!activity.busy()) return;
    const reasons = knownReasons(event.reasons);
    // A critical session end cannot be delayed; stop the job straight away.
    if (reasons.includes('critical')) {
      log(`Windows is ending the session (${describe(reasons)}) during a job; sending Abort.`);
      notify(window, 'ending', reasons);
      return;
    }
    event.preventDefault();
    log(`Windows asked to end the session (${describe(reasons)}) during a job; asked it to wait.`);
    notify(window, 'asked', reasons);
  });
  window.on('session-end', (event) => {
    if (!activity.busy()) return;
    const reasons = knownReasons(event.reasons);
    log(`Windows is ending the session (${describe(reasons)}) during a job; sending Abort.`);
    notify(window, 'ending', reasons);
  });
}

/** The window's job reports: `POST app://app/api/desktop/activity` `{ "busy": boolean }`. */
export function withDesktopActivityRoute(
  fallback: ProtocolHandler,
  activity: Pick<DesktopJobActivity, 'set'> = DESKTOP_JOB_ACTIVITY,
): ProtocolHandler {
  return async (request) => {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/desktop/')) return fallback(request);
    if (
      url.pathname !== ACTIVITY_PATH ||
      request.method !== 'POST' ||
      request.headers.get('Content-Type') !== 'application/json' ||
      !trustedAppRequest(request, url, 'X-KerfDesk-Desktop')
    )
      return new Response('Not Found', { status: 404, headers: HEADERS });
    const busy = busyReport(await request.text());
    if (busy === null) return new Response('Bad Request', { status: 400, headers: HEADERS });
    activity.set(busy);
    return new Response(null, { status: 204, headers: HEADERS });
  };
}

/** Fixed renderer-only event, as the close handoff's; it grants the page nothing. */
export function sessionEndScript(phase: SessionEndPhase, reasons: ReadonlyArray<string>): string {
  const detail = JSON.stringify({ phase, reasons: knownReasons(reasons) });
  return `window.dispatchEvent(new CustomEvent('kerfdesk:session-end', { detail: ${detail} }))`;
}

function notify(
  window: SessionEndTarget,
  phase: SessionEndPhase,
  reasons: ReadonlyArray<string>,
): void {
  window.webContents
    .executeJavaScript(sessionEndScript(phase, reasons))
    .catch((error: unknown) => console.warn('Could not tell the window Windows is ending:', error));
}

function busyReport(text: string): boolean | null {
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const keys = Object.keys(value);
    if (keys.length !== 1 || !('busy' in value) || typeof value.busy !== 'boolean') return null;
    return value.busy;
  } catch {
    return null;
  }
}

function knownReasons(reasons: ReadonlyArray<string>): ReadonlyArray<string> {
  return REASONS.filter((reason) => reasons.includes(reason));
}

function describe(reasons: ReadonlyArray<string>): string {
  return reasons.length === 0 ? 'no reason given' : reasons.join(', ');
}
