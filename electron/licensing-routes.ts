import { trustedAppRequest } from './app-route-guard.js';
import type { LicensingRuntime } from './licensing-runtime.js';
import { isLicenceCheckoutOperation } from './licensing-commerce.js';
import { validActivationId } from './licensing-devices.js';
import { findLicenceKey } from '../public/licence-key-text.mjs';
import type { LicenceLink } from './licence-link.js';
import { record } from './licensing-verification.js';
import type { EarlyUpdates } from './update-ring-store.js';
import type { DesktopUpdates } from './update-status.js';

const PREFIX = '/api/licensing/';
const HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
export type ProtocolHandler = (request: Request) => Promise<Response>;
export type RequestUpdateClose = (cancelInstall: () => void) => void;
/** Licence-key entry helpers a commercial desktop build supplies. */
export type LicenceEntry = {
  /** Help > Licence > Paste key reads the clipboard through this. */
  readonly readClipboard?: (() => string) | undefined;
  /** kerfdesk://licence (licence-link.ts), consumed once by the renderer. */
  readonly licenceLink?: LicenceLink | null | undefined;
};

export function withLicensingRoutes(
  fallback: ProtocolHandler,
  runtime: LicensingRuntime,
  earlyUpdates?: EarlyUpdates,
  updates?: DesktopUpdates,
  requestUpdateClose?: RequestUpdateClose,
  entry: LicenceEntry = {},
): ProtocolHandler {
  return async (request) => {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(PREFIX)) return fallback(request);
    if (!trustedAppRequest(request, url, 'X-KerfDesk-Licensing')) return missing();
    const action = url.pathname.slice(PREFIX.length);
    if (action === 'early-updates') return earlyUpdateRoute(request, earlyUpdates);
    if (
      [
        'update-status',
        'check-updates',
        'download-update',
        'install-update-on-quit',
        'install-update-and-close',
      ].includes(action)
    )
      return updateRoute(action, request, updates, requestUpdateClose);
    if (action === 'status' && request.method === 'GET') return response(await runtime.status());
    if (action === 'licence-link' && request.method === 'GET')
      return entry.licenceLink === undefined ? missing() : response(entry.licenceLink.consume());
    if (!jsonPost(request)) return missing();
    const body = await readBody(request);
    if (!record(body)) return response({ error: 'invalid_request' }, 400);
    if (action === 'clipboard-key') return clipboardKey(body, entry.readClipboard);
    return dispatch(action, body, runtime);
  };
}

function jsonPost(request: Request): boolean {
  return request.method === 'POST' && request.headers.get('Content-Type') === 'application/json';
}

/**
 * Help > Licence's "Get new versions early (beta)" (ADR-541). A build without
 * commercial updates reports it unavailable and refuses to change it.
 */
async function earlyUpdateRoute(
  request: Request,
  earlyUpdates: EarlyUpdates | undefined,
): Promise<Response> {
  if (earlyUpdates === undefined) return missing();
  const current = await earlyUpdates.read();
  if (request.method === 'GET') return response(current);
  if (!current.available || !jsonPost(request)) return missing();
  const body = await readBody(request);
  if (!record(body) || Object.keys(body).length !== 1 || typeof body.enabled !== 'boolean')
    return response({ error: 'invalid_request' }, 400);
  try {
    return response(await earlyUpdates.write(body.enabled));
  } catch {
    return response({ error: 'unavailable' }, 503);
  }
}

/**
 * Help > Check for Updates (ADR-547): `update-status` reads where updates
 * stand; `check-updates` starts a check and answers at once, so a long
 * download never holds the request open.
 */
async function updateRoute(
  action: string,
  request: Request,
  updates: DesktopUpdates | undefined,
  requestUpdateClose: RequestUpdateClose | undefined,
): Promise<Response> {
  if (updates === undefined) return missing();
  if (action === 'update-status')
    return request.method === 'GET' ? response(updates.status()) : missing();
  if (!jsonPost(request)) return missing();
  const body = await readBody(request);
  if (!record(body) || Object.keys(body).length !== 0)
    return response({ error: 'invalid_request' }, 400);
  if (action === 'check-updates') return response(updates.check());
  if (action === 'download-update')
    return updates.download === undefined ? missing() : response(updates.download());
  return installUpdateRoute(action, updates, requestUpdateClose);
}

async function installUpdateRoute(
  action: string,
  updates: DesktopUpdates,
  requestUpdateClose: RequestUpdateClose | undefined,
): Promise<Response> {
  if (updates.installOnQuit === undefined) return missing();
  if (
    action === 'install-update-and-close' &&
    (requestUpdateClose === undefined || updates.cancelInstallOnQuit === undefined)
  )
    return missing();
  const status = await updates.installOnQuit();
  if (
    action === 'install-update-and-close' &&
    status.mode === 'manual' &&
    status.state === 'ready' &&
    status.installOnQuit === true
  )
    setTimeout(() => requestUpdateClose?.(() => updates.cancelInstallOnQuit?.(status)), 0);
  return response(status);
}

async function dispatch(
  action: string,
  body: Record<string, unknown>,
  runtime: LicensingRuntime,
): Promise<Response> {
  if (action === 'activate')
    return Object.keys(body).length === 1 && typeof body.licenseKey === 'string'
      ? response(await runtime.activate(body.licenseKey))
      : response({ error: 'invalid_request' }, 400);
  if (action === 'checkout') return checkout(body, runtime);
  if (action === 'devices' || action === 'release-device') return devices(action, body, runtime);
  if (Object.keys(body).length !== 0) return response({ error: 'invalid_request' }, 400);
  const actions = {
    trial: runtime.startTrial,
    refresh: runtime.refresh,
    deactivate: runtime.deactivate,
    reset: runtime.resetStore,
    'claim-payment': runtime.claimPayment,
    'open-purchase-page': runtime.openPurchasePage,
    'discard-payment': runtime.discardPayment,
  };
  return Object.hasOwn(actions, action)
    ? response(await actions[action as keyof typeof actions]())
    : missing();
}
async function checkout(
  body: Record<string, unknown>,
  runtime: LicensingRuntime,
): Promise<Response> {
  if (
    !isLicenceCheckoutOperation(body.operation) ||
    Object.keys(body).some((key) => key !== 'operation' && key !== 'licenseKey') ||
    (body.licenseKey !== undefined && typeof body.licenseKey !== 'string')
  )
    return response({ error: 'invalid_request' }, 400);
  return response(await runtime.checkout(body.operation, body.licenseKey as string | undefined));
}

/** Help > Licence > Manage devices: list the key's seats, or free one of them. */
async function devices(
  action: 'devices' | 'release-device',
  body: Record<string, unknown>,
  runtime: LicensingRuntime,
): Promise<Response> {
  const allowed = action === 'devices' ? ['licenseKey'] : ['licenseKey', 'activationId'];
  if (
    Object.keys(body).some((key) => !allowed.includes(key)) ||
    (body.licenseKey !== undefined && typeof body.licenseKey !== 'string') ||
    (action === 'release-device' && !validActivationId(body.activationId))
  )
    return response({ error: 'invalid_request' }, 400);
  const licenseKey = body.licenseKey as string | undefined;
  return response(
    action === 'devices'
      ? await runtime.devices(licenseKey)
      : await runtime.releaseDevice(body.activationId as string, licenseKey),
  );
}

/**
 * Help > Licence > Paste key. The renderer may not read the clipboard (ADR-482), so
 * the main process reads it only on that explicit click and returns the KerfDesk key
 * it contains, or null: other clipboard text never reaches the renderer.
 */
function clipboardKey(
  body: Record<string, unknown>,
  readClipboard: (() => string) | undefined,
): Response {
  if (readClipboard === undefined) return missing();
  if (Object.keys(body).length !== 0) return response({ error: 'invalid_request' }, 400);
  let text = '';
  try {
    text = readClipboard();
  } catch {
    text = '';
  }
  return response({ licenseKey: findLicenceKey(text) });
}

async function readBody(request: Request): Promise<unknown> {
  if (request.body === null) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 2048) {
        await reader.cancel();
        return null;
      }
      chunks.push(next.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

function response(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: HEADERS });
}
function missing(): Response {
  return new Response('Not Found', { status: 404, headers: HEADERS });
}
