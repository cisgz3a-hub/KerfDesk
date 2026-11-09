import { trustedAppRequest } from './app-route-guard.js';
import { readBoundedJson } from './ai/bounded-json.js';
import { validRememberedCameraAddress, type CameraAddressStore } from './camera-address-store.js';
import type { ProtocolHandler } from './licensing-routes.js';

const PREFIX = '/api/camera-address/';
const RTSP_PATH = '/api/camera-address/rtsp';
const HEADER = 'X-KerfDesk-Camera-Address';
const HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Content-Type': 'application/json',
};

/**
 * The remembered RTSP address in secure storage (ADR-692): KerfDesk's own
 * window reads it to reconnect and hands over a new one on Connect. Like the
 * other app routes it answers only a same-origin app://app request with its
 * own header, so no web page or other program can read the address.
 */
export function withCameraAddressRoutes(
  fallback: ProtocolHandler,
  store: CameraAddressStore,
): ProtocolHandler {
  return async (request) => {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(PREFIX)) return fallback(request);
    if (url.pathname !== RTSP_PATH || !trustedAppRequest(request, url, HEADER))
      return json({}, 404);
    if (request.method === 'GET') return json({ address: await store.read() });
    if (request.method !== 'POST' || request.headers.get('Content-Type') !== 'application/json')
      return json({}, 404);
    let body: unknown;
    try {
      body = await readBoundedJson(request, 8_192);
    } catch {
      return json({ error: 'Invalid camera address.' }, 400);
    }
    const address =
      typeof body === 'object' && body !== null ? (body as Record<string, unknown>)['address'] : 0;
    if (address !== null && !validRememberedCameraAddress(address))
      return json({ error: 'Invalid camera address.' }, 400);
    return json({ saved: await store.write(address) });
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: HEADERS });
}
