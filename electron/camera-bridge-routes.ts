import { trustedAppRequest } from './app-route-guard.js';
import type { CameraBridgeKeys } from './camera-bridge-keys.js';
import type { CameraBridgeStatus } from './camera-bridge-lifecycle.js';
import type { ProtocolHandler } from './licensing-routes.js';

const PREFIX = '/api/camera-bridge/';
const CONNECTION_PATH = '/api/camera-bridge/connection';
const HEADER = 'X-KerfDesk-Camera-Bridge';
const HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const STOPPED_REASON =
  "KerfDesk's network-camera bridge is not running, so network cameras cannot connect. Restart KerfDesk.";

export type CameraBridgeConnectionSource = {
  /** Where the bridge listens, e.g. http://127.0.0.1:51731. */
  readonly origin: string;
  readonly keys: CameraBridgeKeys;
  /** Start the bridge again if it is wanted but could not start, then say where it stands. */
  readonly status: () => Promise<CameraBridgeStatus>;
};

/**
 * Tells KerfDesk's own window how to reach its camera bridge and prove it is
 * that bridge (rolling audit v2 04-P2-1, ADR-141 Amendment 2): the bridge's
 * address and this launch's keys while it runs, or the reason it does not, so
 * the camera panel says that instead of "available only in KerfDesk Desktop".
 * It answers only a same-origin app://app request with its own header, like
 * the other app routes, so no web page or other program can read the keys.
 */
export function withCameraBridgeRoutes(
  fallback: ProtocolHandler,
  bridge: CameraBridgeConnectionSource,
): ProtocolHandler {
  return async (request) => {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(PREFIX)) return fallback(request);
    if (
      url.pathname !== CONNECTION_PATH ||
      request.method !== 'GET' ||
      !trustedAppRequest(request, url, HEADER)
    )
      return new Response('Not Found', { status: 404, headers: HEADERS });
    const status = await bridge.status();
    const body =
      status.kind === 'running'
        ? {
            kind: 'running',
            origin: bridge.origin,
            proofKey: bridge.keys.proofKey,
            clientToken: bridge.keys.clientToken,
          }
        : {
            kind: 'unavailable',
            reason: status.kind === 'failed' ? status.reason : STOPPED_REASON,
          };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { ...HEADERS, 'Content-Type': 'application/json' },
    });
  };
}
