import {
  COOKIE_NAME,
  MAX_BYTES,
  PAIR_TTL_MS,
  secret,
  uuid,
  type SessionIdentity,
} from './protocol.js';

export const DEFAULT_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";

export function randomSecret(bytes = 32): string {
  const value = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...value))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
export function pairingCode(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-';
  let result = '';
  while (result.length < 12) {
    for (const byte of crypto.getRandomValues(new Uint8Array(24))) {
      if (byte >= 252) continue;
      result += alphabet[byte % alphabet.length];
      if (result.length === 12) break;
    }
  }
  return result;
}
/** Presentation lifetime only. The original stored expiry remains authoritative. */
export function remainingPairingMs(expiresAt: number): number {
  return Math.max(0, Math.min(PAIR_TTL_MS, expiresAt - Date.now()));
}
export async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
/** Compare the fixed-size digests with Web Crypto, never a secret string comparison. */
export function sameDigest(a: string, b: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(a) || !/^[a-f0-9]{64}$/.test(b)) return false;
  return crypto.subtle.timingSafeEqual(new TextEncoder().encode(a), new TextEncoder().encode(b));
}
export class RequestFailure extends Error {
  constructor(readonly status: number) {
    super('The request is unavailable.');
  }
}
export function json(value: unknown, status = 200, headers?: HeadersInit): Response {
  const output = new Headers(headers);
  output.set('Content-Type', 'application/json; charset=utf-8');
  output.set('Cache-Control', 'no-store');
  return new Response(JSON.stringify(value), { status, headers: output });
}
export async function boundedText(
  request: Request | Response,
  maximum = MAX_BYTES,
): Promise<string> {
  const length = request.headers.get('Content-Length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maximum))
    throw new RequestFailure(413);
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      total += item.value.byteLength;
      if (total > maximum) throw new RequestFailure(413);
      chunks.push(item.value);
    }
    const combined = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(combined);
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
export async function bodyJson(request: Request, maximum = MAX_BYTES): Promise<unknown> {
  if (request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json')
    throw new RequestFailure(415);
  try {
    return JSON.parse(await boundedText(request, maximum));
  } catch (error) {
    if (error instanceof RequestFailure) throw error;
    throw new RequestFailure(400);
  }
}
export function originAllowed(request: Request, origin: string, required: boolean): boolean {
  const supplied = request.headers.get('Origin');
  return supplied === origin || (!required && supplied === null);
}
export function controlCookie(
  deviceId: string,
  clientId: string,
  token: string,
  maxAge: number,
): string {
  return `${COOKIE_NAME}=${deviceId}.${clientId}.${token}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;
}
export function removeCookie(): string {
  return `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}
export async function sessionIdentity(request: Request): Promise<SessionIdentity | null> {
  const matches = (request.headers.get('Cookie') ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${COOKIE_NAME}=`));
  if (matches.length !== 1) return null;
  const parts = matches[0].slice(COOKIE_NAME.length + 1).split('.');
  if (
    parts.length !== 3 ||
    !uuid.safeParse(parts[0]).success ||
    !uuid.safeParse(parts[1]).success ||
    !secret.safeParse(parts[2]).success
  )
    return null;
  return { deviceId: parts[0], clientId: parts[1], digest: await digest(parts[2]) };
}
export async function csrfToken(identity: SessionIdentity): Promise<string> {
  return digest(`kerfdesk-csrf-v1:${identity.deviceId}:${identity.clientId}:${identity.digest}`);
}
export async function csrfAllowed(
  request: Request,
  identity: SessionIdentity,
  origin: string,
): Promise<boolean> {
  const supplied = request.headers.get('X-KerfDesk-CSRF');
  return (
    originAllowed(request, origin, true) &&
    supplied !== null &&
    sameDigest(supplied, await csrfToken(identity))
  );
}
export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ??
      character,
  );
}
export function safeResponse(response: Response): Response {
  if (response.status === 101) return response;
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store, no-transform');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set(
    'Referrer-Policy',
    headers.get('Referrer-Policy') === 'same-origin' ? 'same-origin' : 'no-referrer',
  );
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Content-Security-Policy', headers.get('Content-Security-Policy') ?? DEFAULT_CSP);
  // OAuth's provider handles protocol CORS. The phone API never grants it.
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
