// /falcon/pointer for the camera bridge (ADR-635).
//
// The Falcon A1 Pro has no G-code for the red pointer on its head. Creality's
// own software (Falcon Design Space) switches it with one JSON POST to the
// machine's embedded HTTP server, the same server that serves its camera:
// `POST /device/assistLight` with `{"switch":1}` (on) or `{"switch":0}` (off).
// The renderer cannot reach that server itself (no CORS, CSP), so the bridge
// sends exactly that request and nothing else: fixed port, path and body, to a
// private-network host only.

import type { ServerResponse } from 'node:http';
import { writeJson } from './bridge-json.js';
import { runQueuedForHost } from './camera-frame-proxy.js';
import { isAllowedPrivateNetworkHost } from './private-network-host-policy.js';

export const FALCON_HTTP_PORT = 8080;
export const FALCON_POINTER_PATH = '/device/assistLight';
const FALCON_POINTER_TIMEOUT_MS = 5000;

export type FalconPointerResult =
  | { readonly kind: 'ok' }
  | { readonly kind: 'rejected'; readonly reason: string }
  | { readonly kind: 'failed'; readonly reason: string };

/** The exact body Creality's software sends for assist light 0. */
export function falconPointerBody(on: boolean): string {
  return JSON.stringify({ switch: on ? 1 : 0 });
}

/** A bare private-network IPv4 address: no name, port, user, path or loopback. */
export function falconPointerHostIssue(host: string): string | null {
  const bare = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host);
  return bare && !host.startsWith('127.') && isAllowedPrivateNetworkHost(host)
    ? null
    : 'The Falcon address must be a private-network IPv4 address.';
}

export async function handleFalconPointerRequest(
  method: string | undefined,
  requestUrl: URL,
  res: ServerResponse,
): Promise<void> {
  if (method !== 'POST') {
    writeJson(res, { kind: 'rejected', reason: 'Use POST to switch the pointer.' }, 405);
    return;
  }
  const host = requestUrl.searchParams.get('host') ?? '';
  const state = requestUrl.searchParams.get('state');
  const hostIssue = falconPointerHostIssue(host);
  if (hostIssue !== null || (state !== 'on' && state !== 'off')) {
    writeJson(res, { kind: 'rejected', reason: hostIssue ?? 'State must be on or off.' }, 400);
    return;
  }
  const result = await switchFalconPointer(host, state === 'on');
  writeJson(res, result, result.kind === 'ok' ? 200 : 502);
}

/** `port` is a parameter so tests can aim at a loopback mock; the route always uses 8080. */
export function switchFalconPointer(
  host: string,
  on: boolean,
  port = FALCON_HTTP_PORT,
  timeoutMs = FALCON_POINTER_TIMEOUT_MS,
): Promise<FalconPointerResult> {
  const authority = `${host}:${port}`;
  return runQueuedForHost(authority, async () => {
    try {
      const response = await fetch(`http://${authority}${FALCON_POINTER_PATH}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: falconPointerBody(on),
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
      await response.body?.cancel().catch(() => undefined);
      return response.ok
        ? { kind: 'ok' }
        : { kind: 'failed', reason: `The Falcon answered HTTP ${response.status}.` };
    } catch (error) {
      return {
        kind: 'failed',
        reason:
          error instanceof Error && error.name === 'TimeoutError'
            ? `The Falcon at ${host} did not answer within ${timeoutMs / 1000} s.`
            : `KerfDesk could not reach the Falcon at ${host}.`,
      };
    }
  });
}
