/**
 * T2-89: stack-agnostic server-side entitlement service contract.
 *
 * Run: npx tsx tests/server-entitlement-service.test.ts
 */
import {
  ENTITLEMENT_ACTIVATE_PATH,
  ENTITLEMENT_PUBLIC_KEY_PATH,
  ENTITLEMENT_REFRESH_PATH,
  activateServerEntitlement,
  normalizeLicenseCode,
  refreshServerEntitlement,
  type EntitlementBusinessRules,
  type GumroadLicenseRecord,
  type GumroadLicenseVerifier,
  type ServerEntitlementSigner,
} from '../src/entitlements/ServerEntitlementService';
import {
  base64UrlEncode,
  decodePayload,
  type EntitlementTokenPayload,
  type SignedEntitlementToken,
} from '../src/entitlements/SignedEntitlementToken';
import type { ProFeature } from '../src/entitlements/types';

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) {
    passed++;
    console.log(`  ok ${m}`);
  } else {
    failed++;
    console.error(`  fail ${m}`);
  }
}

console.log('\n=== T2-89 server entitlement service ===\n');

function tokenFromPayload(payload: EntitlementTokenPayload): SignedEntitlementToken {
  return {
    payload: base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload))),
    signature: `sig-${payload.jti}`,
    alg: 'EdDSA',
    kid: 'kid-server-1',
  };
}

function signer(): ServerEntitlementSigner {
  return {
    signEntitlement: async (payload) => tokenFromPayload(payload),
  };
}

function validVerifier(overrides: Partial<GumroadLicenseRecord> = {}): GumroadLicenseVerifier {
  return {
    verifyLicense: async (licenseCode) => ({
      ok: true,
      record: {
        licenseId: `lic-${licenseCode}`,
        purchaserEmail: 'user@example.com',
        productId: 'laserforge-pro',
        ...overrides,
      },
    }),
  };
}

function rules(features: readonly ProFeature[] = ['nesting', 'tabs']): EntitlementBusinessRules {
  return {
    evaluate: () => ({ ok: true, tier: 'paid', features }),
  };
}

void (async () => {

// 1. Endpoint constants match the roadmap contract.
{
  assert(ENTITLEMENT_ACTIVATE_PATH === '/entitlement/activate', 'activate path');
  assert(ENTITLEMENT_REFRESH_PATH === '/entitlement/refresh', 'refresh path');
  assert(ENTITLEMENT_PUBLIC_KEY_PATH === '/entitlement/public-key', 'public key path');
}

// 2. License codes are normalized before server verification.
{
  assert(normalizeLicenseCode('  abcd-1234  ') === 'ABCD-1234', 'normalizes trim + uppercase');
}

// 3. Empty license codes fail before Gumroad is called.
{
  let called = false;
  const result = await activateServerEntitlement({
    request: { licenseCode: '   ' },
    gumroad: { verifyLicense: async () => { called = true; return { ok: false, reason: 'invalid' }; } },
    businessRules: rules(),
    signer: signer(),
    now: 1_000,
    tokenTtlMs: 60_000,
    jtiFactory: () => 'jti-empty',
  });
  assert(!called, 'blank code does not call Gumroad');
  assert(!result.ok && result.reason === 'invalid-license-code', 'blank code rejected');
}

// 4. Valid Gumroad purchase applies business rules and signs a device-bound payload.
{
  const result = await activateServerEntitlement({
    request: { licenseCode: ' lf-123 ', deviceId: 'device-a' },
    gumroad: validVerifier(),
    businessRules: rules(['nesting', 'boolean_ops']),
    signer: signer(),
    now: 10_000,
    tokenTtlMs: 86_400_000,
    jtiFactory: () => 'jti-activate',
  });
  assert(result.ok, 'valid purchase accepted');
  if (result.ok) {
    const payload = decodePayload(result.token);
    assert(result.status === 'verified', 'verified status returned');
    assert(result.expiresAt === 86_410_000, 'expiresAt is now + ttl');
    assert(result.features.includes('nesting'), 'features returned');
    assert(payload?.sub === 'lic-LF-123', 'subject uses Gumroad license id');
    assert(payload?.tier === 'paid', 'payload tier from business rules');
    assert(payload?.features.includes('boolean_ops') === true, 'payload features from business rules');
    assert(payload?.iat === 10_000 && payload.exp === 86_410_000, 'payload time window');
    assert(payload?.jti === 'jti-activate', 'payload jti from injected factory');
    assert(payload?.deviceId === 'device-a', 'payload device binding');
  }
}

// 5. Refunded/chargebacked/disputed purchases are revoked without signing.
{
  let signed = false;
  const result = await activateServerEntitlement({
    request: { licenseCode: 'LF-REFUND' },
    gumroad: validVerifier({ refunded: true }),
    businessRules: rules(),
    signer: { signEntitlement: async (payload) => { signed = true; return tokenFromPayload(payload); } },
    now: 1,
    tokenTtlMs: 60_000,
    jtiFactory: () => 'jti-revoked',
  });
  assert(!signed, 'revoked purchase is not signed');
  assert(!result.ok && result.status === 'revoked' && result.reason === 'gumroad-revoked', 'revoked status returned');
}

// 6. LaserForge business rules can deny an otherwise-valid purchase.
{
  const result = await activateServerEntitlement({
    request: { licenseCode: 'LF-LIMIT', deviceId: 'new-device' },
    gumroad: validVerifier(),
    businessRules: {
      evaluate: () => ({ ok: false, reason: 'device-limit-exceeded', message: 'Seat limit reached.' }),
    },
    signer: signer(),
    now: 1,
    tokenTtlMs: 60_000,
    jtiFactory: () => 'jti-denied',
  });
  assert(!result.ok && result.status === 'verification_failed', 'business-rule denial fails verification');
  assert(!result.ok && result.reason === 'device-limit-exceeded', 'business-rule reason carried');
}

// 7. Refresh preserves entitlement subject/features/device but rotates jti and expiry.
{
  const currentPayload: EntitlementTokenPayload = {
    sub: 'lic-LF-123',
    tier: 'paid',
    features: ['nesting', 'tabs'],
    iat: 10_000,
    exp: 100_000,
    jti: 'jti-old',
    deviceId: 'device-a',
  };
  const result = await refreshServerEntitlement({
    currentPayload,
    signer: signer(),
    now: 50_000,
    tokenTtlMs: 120_000,
    jtiFactory: () => 'jti-refresh',
  });
  assert(result.ok, 'refresh accepted');
  if (result.ok) {
    const refreshed = decodePayload(result.token);
    assert(refreshed?.sub === currentPayload.sub, 'refresh preserves subject');
    assert(refreshed?.features.join(',') === currentPayload.features.join(','), 'refresh preserves features');
    assert(refreshed?.deviceId === currentPayload.deviceId, 'refresh preserves device');
    assert(refreshed?.jti === 'jti-refresh', 'refresh rotates jti');
    assert(refreshed?.iat === 50_000 && refreshed.exp === 170_000, 'refresh extends expiry');
  }
}

// 8. Source-level pin: the service keeps Gumroad verification behind an injected server dependency.
{
  const fs = await import('node:fs');
  const path = await import('node:path');
  const url = await import('node:url');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(here, '..');
  const source = fs.readFileSync(path.join(repoRoot, 'src/entitlements/ServerEntitlementService.ts'), 'utf-8');
  assert(/interface GumroadLicenseVerifier/.test(source), 'Gumroad verifier interface is explicit');
  assert(/signEntitlement/.test(source), 'token signer dependency is explicit');
  assert(!/https:\/\/api\.gumroad\.com\/v2\/licenses\/verify/.test(source), 'server contract does not embed client direct-verify URL');
}

console.log(`\nT2-89 server entitlement service: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);

})();
