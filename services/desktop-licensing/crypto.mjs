/* global crypto, TextEncoder, btoa, atob */
const encoder = new TextEncoder();

export function base64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
}

export function decode64(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new Error('Invalid encoded value');
  }
  return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), (c) =>
    c.charCodeAt(0),
  );
}

async function hmacKey(secret) {
  const bytes = decode64(secret);
  if (bytes.length !== 32) throw new Error('Secret must contain 256 bits');
  return crypto.subtle.importKey('raw', bytes, { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

export async function createCryptography(env) {
  const privateJwk = JSON.parse(env.SIGNING_PRIVATE_JWK);
  if (privateJwk.kty !== 'OKP' || privateJwk.crv !== 'Ed25519' || !privateJwk.d) {
    throw new Error('An Ed25519 signing key is required');
  }
  if (!/^[A-Za-z0-9_-]{1,64}$/u.test(env.SIGNING_KEY_ID ?? '')) {
    throw new Error('A signing key identifier is required');
  }
  // Node 24 can export the fully specified JOSE alg "Ed25519" while older
  // workerd expects "EdDSA". Import only the checked curve/key material; the
  // operation algorithm is explicitly Ed25519 in both runtimes.
  const keyMaterial = { kty: 'OKP', crv: 'Ed25519', x: privateJwk.x, d: privateJwk.d };
  const signingKey = await crypto.subtle.importKey('jwk', keyMaterial, 'Ed25519', false, ['sign']);
  const hashKey = await hmacKey(env.HASH_SECRET);
  const derivationKey = await hmacKey(env.DERIVATION_SECRET);
  return {
    id: () => crypto.randomUUID(),
    async hash(domain, value) {
      return base64url(
        await crypto.subtle.sign('HMAC', hashKey, encoder.encode(`${domain}:${value}`)),
      );
    },
    async matches(domain, value, expected) {
      return crypto.subtle.verify(
        'HMAC',
        hashKey,
        decode64(expected),
        encoder.encode(`${domain}:${value}`),
      );
    },
    async derive(domain, value) {
      return base64url(
        await crypto.subtle.sign('HMAC', derivationKey, encoder.encode(`${domain}:${value}`)),
      );
    },
    async sign(claims) {
      const bytes = encoder.encode(JSON.stringify(claims));
      return {
        keyId: env.SIGNING_KEY_ID,
        payload: base64url(bytes),
        signature: base64url(await crypto.subtle.sign('Ed25519', signingKey, bytes)),
      };
    },
  };
}

// Authentication comparisons use WebCrypto's MAC verifier, never string-prefix checks.
export async function authenticateAdmin(header, configured) {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(configured ?? '')) return false;
  const key = await hmacKey(configured);
  const expected = await crypto.subtle.sign('HMAC', key, encoder.encode(`Bearer ${configured}`));
  return crypto.subtle.verify('HMAC', key, expected, encoder.encode(header ?? ''));
}
