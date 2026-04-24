/** Must match scripts/generate-tester-key.mjs (message + default secret). */
export const TESTER_KEY_MESSAGE_PREFIX = 'LaserForge|tester|v1|';

export const DEFAULT_TESTER_HMAC_SECRET =
  'bf5c9e2a-7d41-4c8e-9a1b-laserforge-tester-hmac-v1';

export function getTesterHmacSecret(): string {
  const env = (import.meta as ImportMeta & { env?: { VITE_TESTER_HMAC_SECRET?: string } }).env;
  return env?.VITE_TESTER_HMAC_SECRET ?? DEFAULT_TESTER_HMAC_SECRET;
}

/** TF-SLUG-HEX8 (hex is first 8 chars of HMAC-SHA256 hex digest). */
export const TESTER_KEY_RE = /^TF-([A-Z0-9]{1,20})-([A-F0-9]{8})$/;

export function parseTesterCode(raw: string): { slug: string; sig: string } | null {
  const upper = raw.toUpperCase().trim();
  const m = upper.match(TESTER_KEY_RE);
  if (!m) return null;
  return { slug: m[1], sig: m[2] };
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const buf = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  const bytes = new Uint8Array(buf);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function verifyTesterCode(code: string): Promise<boolean> {
  if (!crypto.subtle) return false;
  const parsed = parseTesterCode(code);
  if (!parsed) return false;
  const message = `${TESTER_KEY_MESSAGE_PREFIX}${parsed.slug}`;
  const hex = await hmacSha256Hex(getTesterHmacSecret(), message);
  const expected = hex.slice(0, 8).toUpperCase();
  return expected === parsed.sig;
}
