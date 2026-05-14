/**
 * T1-256: server entitlement adapters need a real private-key signer
 * instead of only the T2-89 signing interface. The private key must be
 * server-only config, never a Vite/client public-key env value.
 *
 * Run: npx tsx tests/server-webcrypto-entitlement-signer.test.ts
 */
import { webcrypto } from 'node:crypto';
import {
  verifyEntitlementToken,
  type EntitlementTokenPayload,
} from '../src/entitlements/SignedEntitlementToken';
import {
  createWebCryptoEntitlementVerifier,
} from '../src/entitlements/WebCryptoEntitlementVerifier';
import {
  createConfiguredServerEntitlementSignerFromEnv,
  createWebCryptoServerEntitlementSigner,
  parseEntitlementSigningPrivateKeyConfig,
} from '../src/entitlements/ServerWebCryptoEntitlementSigner';

let passed = 0;
let failed = 0;
function assert(cond: boolean, message: string): void {
  if (cond) {
    passed++;
    console.log(`  PASS ${message}`);
  } else {
    failed++;
    console.error(`  FAIL ${message}`);
  }
}

const subtle = webcrypto.subtle;

function payload(overrides: Partial<EntitlementTokenPayload> = {}): EntitlementTokenPayload {
  return {
    sub: 'license-server-1',
    tier: 'paid',
    features: ['nesting', 'box-studio'],
    iat: Date.now() - 60_000,
    exp: Date.now() + 86_400_000,
    jti: 'jti-server-webcrypto',
    deviceId: 'device-1',
    ...overrides,
  };
}

async function generateKeyConfig(kid = 'kid-server-es256'): Promise<{
  kid: string;
  publicJwk: JsonWebKey;
  privateJwk: JsonWebKey;
}> {
  const keyPair = await subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );
  return {
    kid,
    publicJwk: await subtle.exportKey('jwk', keyPair.publicKey),
    privateJwk: await subtle.exportKey('jwk', keyPair.privateKey),
  };
}

console.log('\n=== T1-256 server WebCrypto entitlement signer ===\n');

void (async () => {
  // 1. A real server-side ES256 private JWK signs a token the production verifier accepts.
  {
    const keys = await generateKeyConfig();
    const signer = createWebCryptoServerEntitlementSigner({
      kid: keys.kid,
      alg: 'ES256',
      jwk: keys.privateJwk,
    }, webcrypto);
    const token = await signer.signEntitlement(payload());
    const verifier = createWebCryptoEntitlementVerifier([
      { kid: keys.kid, alg: 'ES256', jwk: keys.publicJwk },
    ], webcrypto);
    const result = await verifyEntitlementToken({
      token,
      verifier,
      now: Date.now(),
      replayMode: 'ignore',
      expectedDeviceId: 'device-1',
    });

    assert(token.kid === keys.kid, 'signed token carries configured kid');
    assert(token.alg === 'ES256', 'signed token carries ES256 alg');
    assert(result.ok, 'verifier accepts token signed by server WebCrypto signer');
  }

  // 2. Server env parser accepts private-key config and rejects public-only keys.
  {
    const keys = await generateKeyConfig('kid-env-signer');
    const raw = JSON.stringify({ kid: keys.kid, alg: 'ES256', jwk: keys.privateJwk });
    const parsed = parseEntitlementSigningPrivateKeyConfig(raw);
    assert(parsed?.kid === keys.kid, 'server private-key env parser accepts config JSON');

    const publicOnly = JSON.stringify({ kid: keys.kid, alg: 'ES256', jwk: keys.publicJwk });
    assert(parseEntitlementSigningPrivateKeyConfig(publicOnly) === null,
      'server private-key env parser rejects public-only JWK');
    assert(parseEntitlementSigningPrivateKeyConfig(undefined) === null,
      'missing private-key env returns null');
    assert(parseEntitlementSigningPrivateKeyConfig('{bad') === null,
      'invalid private-key env returns null');
  }

  // 3. Configured signer factory reads server-only env, not Vite/client public-key env.
  {
    const keys = await generateKeyConfig('kid-env-factory');
    const raw = JSON.stringify({ kid: keys.kid, alg: 'ES256', jwk: keys.privateJwk });
    const signer = createConfiguredServerEntitlementSignerFromEnv(
      { ENTITLEMENT_SIGNING_PRIVATE_JWK: raw },
      webcrypto,
    );
    assert(signer != null, 'configured server signer reads ENTITLEMENT_SIGNING_PRIVATE_JWK');
    assert(createConfiguredServerEntitlementSignerFromEnv({
      VITE_ENTITLEMENT_PUBLIC_KEYS_JWK: JSON.stringify([{ kid: keys.kid, alg: 'ES256', jwk: keys.publicJwk }]),
    }, webcrypto) === null, 'server signer does not read Vite public-key env');
  }

  // 4. Source-level pins for the server-only custody boundary.
  {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const url = await import('node:url');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const source = fs.readFileSync(
      path.resolve(here, '../src/entitlements/ServerWebCryptoEntitlementSigner.ts'),
      'utf8',
    );
    assert(/T1-256/.test(source), 'server signer carries T1-256 marker');
    assert(/ENTITLEMENT_SIGNING_PRIVATE_JWK/.test(source),
      'server signer uses server-only private-key env');
    assert(!/VITE_ENTITLEMENT_PUBLIC_KEYS_JWK/.test(source),
      'server signer source never reads client public-key env');
    assert(/\.sign\(/.test(source), 'server signer uses SubtleCrypto.sign');
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
