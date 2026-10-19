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
const MAX_REPLY_BYTES = 4096;

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
  // Plain decimal octets only, and exactly the address fetch will connect to:
  // the URL parser reads a leading zero as octal (010.8.8.8 is 8.8.8.8).
  const bare = /^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(host);
  return bare &&
    urlHostname(host) === host &&
    !host.startsWith('127.') &&
    isAllowedPrivateNetworkHost(host)
    ? null
    : 'The Falcon address must be a private-network IPv4 address.';
}

function urlHostname(host: string): string | null {
  try {
    return new URL(`http://${host}`).hostname;
  } catch {
    return null;
  }
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
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        return { kind: 'failed', reason: `The Falcon answered HTTP ${response.status}.` };
      }
      const code = replyCode(await readShortReply(response));
      return code === null || code === 0
        ? { kind: 'ok' }
        : { kind: 'failed', reason: `The Falcon refused the pointer switch (code ${code}).` };
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

/** The reply's numeric `code`, when it is a JSON object with one; null
 * otherwise. Only a non-zero code is read as a refusal: an empty or other
 * 2xx reply is accepted, as the request's evidence says nothing more (ADR-635). */
function replyCode(reply: string): number | null {
  try {
    const value: unknown = JSON.parse(reply);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const code = (value as Record<string, unknown>)['code'];
    return typeof code === 'number' && Number.isFinite(code) ? code : null;
  } catch {
    return null;
  }
}

// A status reply is a few bytes; stop reading anything longer, and treat an
// unreadable body like an empty one.
async function readShortReply(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (reader === undefined) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REPLY_BYTES) return '';
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  } catch {
    return '';
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
