/**
 * T1-254: local entitlement cache must not be a Pro authority unless it is a
 * signed entitlement token verified by the service. Raw JSON
 * `{ valid: true }` caches may be migrated for cleanup, but they must not
 * grant verified/offline_grace status.
 *
 * Run: npx tsx tests/entitlement-signed-cache-authority.test.ts
 */
import { EntitlementService } from '../src/entitlements/EntitlementService';
import { base64UrlEncode, type EntitlementVerifier } from '../src/entitlements/SignedEntitlementToken';
import { InMemoryStorageAdapter } from '../src/core/storage/InMemoryStorageAdapter';
import { setStorageForTest, getStorage } from '../src/core/storage/storage';

const STORAGE_KEY = 'laserforge_license';
const LICENSE_CACHE_KEY = 'laserforge_license_cache';
const SAVED_CODE = 'TEST-PURCHASE-1234567890';
const NOW = Date.now();
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

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

const memoryStore: Record<string, string> = {};
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  get length() { return Object.keys(memoryStore).length; },
  clear(): void { for (const k of Object.keys(memoryStore)) delete memoryStore[k]; },
  getItem: (k: string) => Object.prototype.hasOwnProperty.call(memoryStore, k) ? memoryStore[k] : null,
  key: (i: number) => Object.keys(memoryStore)[i] ?? null,
  removeItem: (k: string) => { delete memoryStore[k]; },
  setItem: (k: string, v: string) => { memoryStore[k] = v; },
} as Storage;

function installFetchMock(response: { ok?: boolean; status?: number; body?: unknown; throws?: Error }): void {
  (globalThis as unknown as { fetch: typeof fetch }).fetch = (async () => {
    if (response.throws) throw response.throws;
    return {
      ok: response.ok ?? true,
      status: response.status ?? 200,
      json: async () => response.body ?? {},
    } as Response;
  }) as typeof fetch;
}

async function freshAdapter(): Promise<void> {
  setStorageForTest(new InMemoryStorageAdapter());
  for (const k of Object.keys(memoryStore)) delete memoryStore[k];
}

const verifier: EntitlementVerifier = {
  knownKids: () => ['test-kid'],
  verifySignature: async ({ signatureBase64 }) => signatureBase64 === 'sig-good',
};

function signedToken(payloadOverrides: Record<string, unknown> = {}): string {
  const payload = {
    sub: 'license-id-1',
    tier: 'paid',
    features: ['nesting', 'variable_text'],
    iat: NOW - 60_000,
    exp: NOW + 30 * DAY_MS,
    jti: `tok-${Math.random().toString(36).slice(2)}`,
    ...payloadOverrides,
  };
  return JSON.stringify({
    payload: base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload))),
    signature: 'sig-good',
    alg: 'EdDSA',
    kid: 'test-kid',
  });
}

console.log('\n=== T1-254 signed entitlement cache authority ===\n');

void (async () => {
  // 1. Fresh raw JSON cache cannot bypass the network and grant Pro.
  {
    await freshAdapter();
    await getStorage().set(STORAGE_KEY, SAVED_CODE);
    await getStorage().set(LICENSE_CACHE_KEY, JSON.stringify({
      code: SAVED_CODE,
      name: 'forged@example.com',
      validatedAt: NOW,
      valid: true,
    }));
    installFetchMock({ throws: new Error('offline') });

    const svc = new EntitlementService({ signedTokenVerifier: verifier, now: () => NOW });
    await svc.initialize();
    const s = svc.getState();
    assert(s.status === 'verification_failed' && !s.hasPro,
      `raw cache rejected (got ${s.status}/${s.hasPro})`);
  }

  // 2. A recent signed token grants verified status and feature-scoped Pro.
  {
    await freshAdapter();
    await getStorage().set(STORAGE_KEY, SAVED_CODE);
    await getStorage().set(LICENSE_CACHE_KEY, signedToken());
    installFetchMock({ throws: new Error('SHOULD NOT BE CALLED') });

    const svc = new EntitlementService({ signedTokenVerifier: verifier, now: () => NOW });
    await svc.initialize();
    const s = svc.getState();
    assert(s.status === 'verified' && s.tier === 'paid' && s.hasPro,
      `signed cache grants verified paid state (got ${s.status}/${s.tier}/${s.hasPro})`);
    assert(s.lastVerifiedAt === NOW - 60_000,
      `signed cache carries server iat into lastVerifiedAt (got ${s.lastVerifiedAt})`);
    assert(svc.canUse('nesting') && !svc.canUse('tabs'),
      'signed cache uses token feature list as canUse authority');
  }

  // 3. An older-but-unexpired signed token grants offline_grace until signed exp.
  {
    await freshAdapter();
    await getStorage().set(STORAGE_KEY, SAVED_CODE);
    await getStorage().set(LICENSE_CACHE_KEY, signedToken({
      iat: NOW - WEEK_MS - 60_000,
      exp: NOW + 5 * DAY_MS,
      jti: 'older-token',
    }));
    installFetchMock({ throws: new Error('SHOULD NOT BE CALLED') });

    const svc = new EntitlementService({ signedTokenVerifier: verifier, now: () => NOW });
    await svc.initialize();
    const s = svc.getState();
    assert(s.status === 'offline_grace' && s.hasPro,
      `older signed token uses offline grace (got ${s.status}/${s.hasPro})`);
    assert(s.graceUntil === NOW + 5 * DAY_MS,
      `offline_grace ends at signed exp (got ${s.graceUntil})`);
  }

  // 4. A signed-looking cache with a bad signature does not grant Pro.
  {
    await freshAdapter();
    await getStorage().set(STORAGE_KEY, SAVED_CODE);
    const bad = JSON.parse(signedToken()) as Record<string, unknown>;
    bad.signature = 'sig-bad';
    await getStorage().set(LICENSE_CACHE_KEY, JSON.stringify(bad));
    installFetchMock({ throws: new Error('offline') });

    const svc = new EntitlementService({ signedTokenVerifier: verifier, now: () => NOW });
    await svc.initialize();
    const s = svc.getState();
    assert(s.status === 'verification_failed' && !s.hasPro,
      `bad signature cache rejected (got ${s.status}/${s.hasPro})`);
  }

  // 5. Source-level pin: raw cache authority helpers are gone from the service.
  {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const url = await import('node:url');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const src = fs.readFileSync(path.resolve(here, '../src/entitlements/EntitlementService.ts'), 'utf-8');
    assert(/T1-254/.test(src), 'T1-254 marker present in EntitlementService');
    assert(/verifyEntitlementToken/.test(src), 'service verifies signed entitlement tokens');
    assert(!/StoredLicenseCacheEntry/.test(src), 'service no longer consumes raw StoredLicenseCacheEntry');
    assert(!/cached && cached\.valid/.test(src), 'raw valid cache branch removed');
  }

  setStorageForTest(null);
  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((err: unknown) => {
  setStorageForTest(null);
  console.error(err);
  process.exit(1);
});
