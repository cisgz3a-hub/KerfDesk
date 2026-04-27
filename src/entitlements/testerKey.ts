/** Must match scripts/generate-tester-key.mjs (message). */
export const TESTER_KEY_MESSAGE_PREFIX = 'LaserForge|tester|v1|';

// T1-77: the previous `DEFAULT_TESTER_HMAC_SECRET` export was removed because
// any string literal in the client bundle is trivially extractable via DevTools
// or source maps, allowing unlimited valid tester keys to be minted offline.
// The secret is now strictly env-required (VITE_TESTER_HMAC_SECRET, set at
// build time) with no source-controlled fallback. Builds that don't set the
// env var simply refuse all tester codes — correct, because tester program is
// not a feature for end users.

let _testHmacSecretOverride: string | null = null;

/**
 * Test-only injection point. Production code paths never call this; tests
 * (e.g. tests/entitlement-storage-migration.test.ts) call it to install a
 * known secret so they can synthesize a valid tester code via the same HMAC
 * recipe `verifyTesterCode` uses. Calling with `null` clears the override and
 * restores production resolution (env var only). T1-77.
 */
export function __setTesterHmacSecretForTest(secret: string | null): void {
  _testHmacSecretOverride = secret;
}

function resolveTesterHmacSecret(): string | null {
  if (_testHmacSecretOverride !== null) return _testHmacSecretOverride;
  const env = (import.meta as ImportMeta & {
    env?: { VITE_TESTER_HMAC_SECRET?: string };
  }).env;
  return env?.VITE_TESTER_HMAC_SECRET ?? null;
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
  const secret = resolveTesterHmacSecret();
  if (!secret) {
    // T1-77: no tester HMAC secret configured. All tester keys reject.
    // Production builds that don't set VITE_TESTER_HMAC_SECRET don't ship a
    // hardcoded fallback (which would be commercial-critically extractable).
    // Tester program isn't a feature for end users — internal/QA builds set
    // the env var; production end-user builds don't.
    return false;
  }
  const parsed = parseTesterCode(code);
  if (!parsed) return false;
  const message = `${TESTER_KEY_MESSAGE_PREFIX}${parsed.slug}`;
  const hex = await hmacSha256Hex(secret, message);
  const expected = hex.slice(0, 8).toUpperCase();
  return expected === parsed.sig;
}
