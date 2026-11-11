import { trustedAppRequest } from './app-route-guard.js';
import { readBoundedJson } from './ai/bounded-json.js';
import {
  CAMERA_ADDRESS_SLOTS,
  validRememberedCameraAddress,
  type CameraAddressSlot,
  type CameraAddressStore,
} from './camera-address-store.js';
import type { ProtocolHandler } from './licensing-routes.js';

const PREFIX = '/api/camera-address/';
const HEADER = 'X-KerfDesk-Camera-Address';
const HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Content-Type': 'application/json',
};

/**
 * The remembered camera addresses in secure storage (ADR-692 and Amendment 1),
 * one route per slot: KerfDesk's own window reads one to reconnect and hands
 * over a new one on Connect. Like the other app routes it answers only a
 * same-origin app://app request with its own header, so no web page or other
 * program can read the address.
 */
export function withCameraAddressRoutes(
  fallback: ProtocolHandler,
  store: CameraAddressStore,
): ProtocolHandler {
  return async (request) => {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(PREFIX)) return fallback(request);
    const slot = url.pathname.slice(PREFIX.length);
    if (!CAMERA_ADDRESS_SLOTS.has(slot) || !trustedAppRequest(request, url, HEADER))
      return json({}, 404);
    return answer(request, store, slot as CameraAddressSlot);
  };
}

async function answer(
  request: Request,
  store: CameraAddressStore,
  slot: CameraAddressSlot,
): Promise<Response> {
  if (request.method === 'GET') return json({ address: await store.read(slot) });
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
  if (address !== null && !validRememberedCameraAddress(slot, address))
    return json({ error: 'Invalid camera address.' }, 400);
  return json({ saved: await store.write(slot, address) });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: HEADERS });
}
