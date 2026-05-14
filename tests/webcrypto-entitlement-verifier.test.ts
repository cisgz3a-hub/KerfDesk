/**
 * T1-255: production entitlement cache verification must have a real
 * WebCrypto public-key verifier, not only the T2-90 test stub interface.
 *
 * Run: npx tsx tests/webcrypto-entitlement-verifier.test.ts
 */
import { webcrypto } from 'node:crypto';
import {
  base64UrlDecode,
  base64UrlEncode,
  verifyEntitlementToken,
  type EntitlementTokenPayload,
  type SignedEntitlementToken,
} from '../src/entitlements/SignedEntitlementToken';
import {
  createConfiguredEntitlementVerifierFromEnv,
  createWebCryptoEntitlementVerifier,
  parseEntitlementPublicKeyConfig,
} from '../src/entitlements/WebCryptoEntitlementVerifier';

let passed = 0;
let failed = 0;
function assert(cond: boolean, message: string): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

const subtle = webcrypto.subtle;
const encoder = new TextEncoder();

function payload(overrides: Partial<EntitlementTokenPayload> = {}): EntitlementTokenPayload {
  return {
    sub: 'license-1',
    tier: 'paid',
    features: ['nesting'],
    iat: Date.now() - 60_000,
    exp: Date.now() + 86_400_000,
    jti: 'jti-webcrypto',
    ...overrides,
  };
}

function tokenPayloadBase64(p: EntitlementTokenPayload): string {
  return base64UrlEncode(encoder.encode(JSON.stringify(p)));
}

async function generateSignedToken(kid = 'kid-webcrypto'): Promise<{
  token: SignedEntitlementToken;
  publicJwk: JsonWebKey;
}> {
  const keyPair = await subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );
  const publicJwk = await subtle.exportKey('jwk', keyPair.publicKey);
  const payloadBase64 = tokenPayloadBase64(payload());
  const signature = new Uint8Array(await subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    keyPair.privateKey,
    encoder.encode(payloadBase64),
  ));
  return {
    publicJwk,
    token: {
      payload: payloadBase64,
      signature: base64UrlEncode(signature),
      alg: 'ES256',
      kid,
    },
  };
}

console.log('\n=== T1-255 WebCrypto entitlement verifier ===\n');

void (async () => {
  // 1. A real WebCrypto P-256 public key verifies an ES256 entitlement token.
  {
    const { token, publicJwk } = await generateSignedToken();
    const verifier = createWebCryptoEntitlementVerifier([
      { kid: token.kid, alg: 'ES256', jwk: publicJwk },
    ], webcrypto);
    const result = await verifyEntitlementToken({
      token,
      verifier,
      now: Date.now(),
      replayMode: 'ignore',
    });
    assert(result.ok, 'real WebCrypto ES256 token verifies');
  }

  // 2. A tampered signature fails.
  {
    const { token, publicJwk } = await generateSignedToken();
    const verifier = createWebCryptoEntitlementVerifier([
      { kid: token.kid, alg: 'ES256', jwk: publicJwk },
    ], webcrypto);
    const signatureBytes = base64UrlDecode(token.signature);
    signatureBytes[0] ^= 0xff;
    const result = await verifyEntitlementToken({
      token: { ...token, signature: base64UrlEncode(signatureBytes) },
      verifier,
      now: Date.now(),
      replayMode: 'ignore',
    });
    assert(!result.ok && result.reason === 'bad-signature',
      `tampered signature fails as bad-signature (got ${result.ok ? 'ok' : result.reason})`);
  }

  // 3. Unknown kids are not accepted.
  {
    const { token, publicJwk } = await generateSignedToken('kid-live');
    const verifier = createWebCryptoEntitlementVerifier([
      { kid: 'kid-other', alg: 'ES256', jwk: publicJwk },
    ], webcrypto);
    assert(!verifier.knownKids().includes(token.kid), 'knownKids excludes unknown kid');
    const result = await verifyEntitlementToken({
      token,
      verifier,
      now: Date.now(),
      replayMode: 'ignore',
    });
    assert(!result.ok && result.reason === 'unknown-kid',
      `unknown kid fails before signature check (got ${result.ok ? 'ok' : result.reason})`);
  }

  // 4. Env parser accepts a JSON key list and ignores missing/invalid env safely.
  {
    const { publicJwk } = await generateSignedToken('kid-env');
    const envJson = JSON.stringify([{ kid: 'kid-env', alg: 'ES256', jwk: publicJwk }]);
    const parsed = parseEntitlementPublicKeyConfig(envJson);
    assert(parsed.length === 1 && parsed[0]?.kid === 'kid-env', 'env parser accepts key list JSON');
    assert(parseEntitlementPublicKeyConfig(undefined).length === 0, 'missing env -> no keys');
    assert(parseEntitlementPublicKeyConfig('{nope').length === 0, 'invalid env JSON -> no keys');
  }

  // 5. Configured verifier factory reads Vite-style env and returns null when no public keys are configured.
  {
    const { publicJwk } = await generateSignedToken('kid-env-factory');
    const envJson = JSON.stringify([{ kid: 'kid-env-factory', alg: 'ES256', jwk: publicJwk }]);
    const verifier = createConfiguredEntitlementVerifierFromEnv(
      { VITE_ENTITLEMENT_PUBLIC_KEYS_JWK: envJson },
      webcrypto,
    );
    assert(verifier?.knownKids().includes('kid-env-factory') === true,
      'configured verifier exposes env key kid');
    assert(createConfiguredEntitlementVerifierFromEnv({}, webcrypto) === null,
      'no env key -> null verifier');
  }

  // 6. Source-level pins for production singleton wiring.
  {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const url = await import('node:url');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const svcSource = fs.readFileSync(path.resolve(here, '../src/entitlements/EntitlementService.ts'), 'utf8');
    const verifierSource = fs.readFileSync(path.resolve(here, '../src/entitlements/WebCryptoEntitlementVerifier.ts'), 'utf8');
    assert(/T1-255/.test(verifierSource), 'WebCrypto verifier carries T1-255 marker');
    assert(/\.verify\(/.test(verifierSource), 'verifier uses SubtleCrypto.verify');
    assert(/createConfiguredEntitlementVerifierFromEnv/.test(svcSource),
      'EntitlementService singleton uses configured verifier factory');
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
