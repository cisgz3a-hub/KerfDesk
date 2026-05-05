/**
 * T1-80: license-validation outcomes are surfaced as a `status` on
 * `EntitlementState` instead of silently downgrading to free. Pre-T1-80
 * a Gumroad outage during init silently removed the user's stored
 * license and rendered "Free" — paid users assumed they'd been revoked.
 *
 * The four outcomes the audit calls out:
 *   - verified            → tier=paid, hasPro=true, status='verified'
 *   - offline_grace       → tier=paid, hasPro=true, status='offline_grace'
 *   - verification_failed → tier=free, hasPro=false, status='verification_failed',
 *                           code preserved (user can retry)
 *   - revoked             → tier=free, hasPro=false, status='revoked',
 *                           code preserved (user can contact support)
 *
 * Code is removed from storage only on explicit `deactivate()`.
 *
 * Run: npx tsx tests/license-status-states.test.ts
 */
import { EntitlementService } from '../src/entitlements/EntitlementService';
import { InMemoryStorageAdapter } from '../src/core/storage/InMemoryStorageAdapter';
import { setStorageForTest, getStorage } from '../src/core/storage/storage';

const STORAGE_KEY = 'laserforge_license';
const LICENSE_CACHE_KEY = 'laserforge_license_cache';
const LICENSE_CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const LICENSE_OFFLINE_GRACE = 30 * 24 * 60 * 60 * 1000;

let passed = 0;
let failed = 0;
function assert(c: boolean, m: string): void {
  if (c) {
    passed++;
    console.log(`  ✓ ${m}`);
  } else {
    failed++;
    console.error(`  ✗ ${m}`);
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

type GumroadResponse = {
  ok?: boolean;
  status?: number;
  body?: unknown;
  throws?: Error;
};

function installFetchMock(response: GumroadResponse): void {
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

const SAVED_CODE = 'TEST-PURCHASE-1234567890';

console.log('\n=== T1-80 license status states ===\n');

void (async () => {

// 1. Verified — Gumroad confirms valid, not refunded
{
  await freshAdapter();
  await getStorage().set(STORAGE_KEY, SAVED_CODE);
  installFetchMock({
    ok: true,
    body: { success: true, purchase: { email: 'paid@example.com', refunded: false, chargebacked: false, disputed: false } },
  });
  const svc = new EntitlementService();
  await svc.initialize();
  const s = svc.getState();
  assert(s.tier === 'paid' && s.hasPro && s.status === 'verified',
    `verified: tier=paid, hasPro=true, status=verified (got ${s.tier}/${s.hasPro}/${s.status})`);
  assert(typeof s.lastVerifiedAt === 'number',
    `verified: lastVerifiedAt populated (got ${s.lastVerifiedAt})`);
  assert(s.code === SAVED_CODE,
    `verified: code preserved (got ${s.code})`);
}

// 2. Revoked — Gumroad confirms refunded
{
  await freshAdapter();
  await getStorage().set(STORAGE_KEY, SAVED_CODE);
  installFetchMock({
    ok: true,
    body: { success: true, purchase: { email: 'refunded@example.com', refunded: true } },
  });
  const svc = new EntitlementService();
  await svc.initialize();
  const s = svc.getState();
  assert(s.tier === 'free' && !s.hasPro && s.status === 'revoked',
    `revoked: tier=free, hasPro=false, status=revoked (got ${s.tier}/${s.hasPro}/${s.status})`);
  assert(s.code === SAVED_CODE,
    `revoked: code preserved (so UI can show "contact support"; got ${s.code})`);
  // Code must still be in storage for the user / support to read.
  const stored = await getStorage().get(STORAGE_KEY);
  assert(stored === SAVED_CODE, `revoked: storage still has the code (got ${stored})`);
}

// 3. Verification failed — Gumroad returns success: false (not refunded, just invalid)
{
  await freshAdapter();
  await getStorage().set(STORAGE_KEY, SAVED_CODE);
  installFetchMock({ ok: true, body: { success: false } });
  const svc = new EntitlementService();
  await svc.initialize();
  const s = svc.getState();
  assert(s.tier === 'free' && !s.hasPro && s.status === 'verification_failed',
    `verification_failed (success:false): status correct (got ${s.tier}/${s.hasPro}/${s.status})`);
  assert(s.code === SAVED_CODE,
    `verification_failed: code preserved (user can retry; got ${s.code})`);
  assert(typeof s.lastError === 'string' && s.lastError.length > 0,
    `verification_failed: lastError populated (got ${s.lastError})`);
}

// 4. Verification failed — HTTP 500 from Gumroad
{
  await freshAdapter();
  await getStorage().set(STORAGE_KEY, SAVED_CODE);
  installFetchMock({ ok: false, status: 500 });
  const svc = new EntitlementService();
  await svc.initialize();
  const s = svc.getState();
  assert(s.status === 'verification_failed',
    `HTTP 500: status=verification_failed (got ${s.status})`);
  assert(s.code === SAVED_CODE,
    `HTTP 500: code preserved (got ${s.code})`);
  assert(typeof s.lastError === 'string' && /500/.test(s.lastError ?? ''),
    `HTTP 500: lastError mentions 500 (got ${s.lastError})`);
}

// 5. Offline grace — network throws, cache valid + within grace
{
  await freshAdapter();
  await getStorage().set(STORAGE_KEY, SAVED_CODE);
  // Pre-seed the license cache as valid, validated 10 days ago (well
  // within LICENSE_OFFLINE_GRACE = 30 days, but past
  // LICENSE_CACHE_MAX_AGE = 7 days so the offline path actually fires
  // the grace branch).
  const cached = {
    code: SAVED_CODE.toUpperCase().trim(),
    name: 'cached@example.com',
    validatedAt: Date.now() - 10 * 24 * 60 * 60 * 1000,
    valid: true,
  };
  await getStorage().set(LICENSE_CACHE_KEY, JSON.stringify(cached));
  installFetchMock({ throws: new Error('network unreachable') });

  const svc = new EntitlementService();
  await svc.initialize();
  const s = svc.getState();
  assert(s.status === 'offline_grace' && s.tier === 'paid' && s.hasPro,
    `offline_grace: status=offline_grace, tier=paid, hasPro=true (got ${s.status}/${s.tier}/${s.hasPro})`);
  assert(typeof s.graceUntil === 'number' && (s.graceUntil ?? 0) > Date.now(),
    `offline_grace: graceUntil > now (got ${s.graceUntil})`);
  assert(s.label === 'cached@example.com',
    `offline_grace: cached name surfaced (got ${s.label})`);
}

// 6. Offline grace expired — cache is older than 30 days → verification_failed
{
  await freshAdapter();
  await getStorage().set(STORAGE_KEY, SAVED_CODE);
  const cached = {
    code: SAVED_CODE.toUpperCase().trim(),
    name: 'old@example.com',
    validatedAt: Date.now() - (LICENSE_OFFLINE_GRACE + 24 * 60 * 60 * 1000),
    valid: true,
  };
  await getStorage().set(LICENSE_CACHE_KEY, JSON.stringify(cached));
  installFetchMock({ throws: new Error('network unreachable') });

  const svc = new EntitlementService();
  await svc.initialize();
  const s = svc.getState();
  assert(s.status === 'verification_failed' && !s.hasPro,
    `offline grace expired: status=verification_failed, hasPro=false (got ${s.status}/${s.hasPro})`);
  assert(s.code === SAVED_CODE,
    `offline grace expired: code still preserved (got ${s.code})`);
}

// 7. Cache fresh path → verified without hitting fetch
{
  await freshAdapter();
  await getStorage().set(STORAGE_KEY, SAVED_CODE);
  const cached = {
    code: SAVED_CODE.toUpperCase().trim(),
    name: 'cache-fresh@example.com',
    validatedAt: Date.now() - 60_000, // 1 minute ago
    valid: true,
  };
  await getStorage().set(LICENSE_CACHE_KEY, JSON.stringify(cached));
  // Throwing fetch confirms we never reach the network.
  installFetchMock({ throws: new Error('SHOULD NOT BE CALLED') });

  const svc = new EntitlementService();
  await svc.initialize();
  const s = svc.getState();
  assert(s.status === 'verified' && s.tier === 'paid' && s.hasPro,
    `fresh cache: verified without network call (got ${s.status}/${s.tier}/${s.hasPro})`);
  assert(s.label === 'cache-fresh@example.com',
    `fresh cache: cached name (got ${s.label})`);
}

// 8. No saved license → free (status='free')
{
  await freshAdapter();
  installFetchMock({ throws: new Error('SHOULD NOT BE CALLED') });
  const svc = new EntitlementService();
  await svc.initialize();
  const s = svc.getState();
  assert(s.status === 'free' && s.tier === 'free' && !s.hasPro,
    `no license: status=free (got ${s.status}/${s.tier}/${s.hasPro})`);
  assert(s.code == null, `no license: no code in state (got ${s.code})`);
}

// 9. Explicit deactivate clears the code (the only path that does)
{
  await freshAdapter();
  await getStorage().set(STORAGE_KEY, SAVED_CODE);
  installFetchMock({
    ok: true,
    body: { success: true, purchase: { email: 'paid@example.com', refunded: false } },
  });
  const svc = new EntitlementService();
  await svc.initialize();
  // sanity: verified
  if (svc.getState().status !== 'verified') {
    failed++;
    console.error('  ✗ pre-deactivate: expected verified');
  }
  svc.deactivate();
  // deactivate dispatches storage removes async; give it a tick
  await new Promise<void>(resolve => setTimeout(resolve, 10));
  const stored = await getStorage().get(STORAGE_KEY);
  assert(stored == null, `deactivate: storage code removed (got ${stored})`);
  const s = svc.getState();
  assert(s.status === 'free' && !s.hasPro, `deactivate: status=free (got ${s.status})`);
  assert(s.code == null, `deactivate: state code cleared (got ${s.code})`);
}

// 10. revoked + verification_failed paths do NOT call storage.remove
{
  await freshAdapter();
  await getStorage().set(STORAGE_KEY, SAVED_CODE);
  installFetchMock({
    ok: true,
    body: { success: true, purchase: { refunded: true } },
  });
  const svc = new EntitlementService();
  await svc.initialize();
  // Storage code must still be there.
  const stored = await getStorage().get(STORAGE_KEY);
  assert(stored === SAVED_CODE,
    `revoked path: storage NOT cleared (got ${stored})`);
}

// 11. Source-level pin
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const svcSrc = fs.readFileSync(
    path.resolve(here, '../src/entitlements/EntitlementService.ts'),
    'utf-8',
  );
  assert(/T1-80/.test(svcSrc), 'T1-80 marker in EntitlementService.ts');
  assert(/StoredCodeValidation/.test(svcSrc),
    'StoredCodeValidation discriminated union declared');
  assert(/verifyGumroadStructured/.test(svcSrc),
    'verifyGumroadStructured method exists');
  // The OLD silent-delete path is gone.
  assert(!/await getStorage\(\)\.remove\(STORAGE_KEY\);\s*\n\s*this\.setState\(\{ tier: 'free', hasPro: false \}\);/m.test(svcSrc),
    `OLD silent storage.remove + setState({free, hasPro:false}) shape gone from runInitialize`);

  const typesSrc = fs.readFileSync(
    path.resolve(here, '../src/entitlements/types.ts'),
    'utf-8',
  );
  assert(/T1-80/.test(typesSrc), 'T1-80 marker in types.ts');
  for (const v of ['free', 'verified', 'offline_grace', 'verification_failed', 'revoked', 'developer', 'tester']) {
    assert(typesSrc.includes(`'${v}'`),
      `LicenseStatus includes '${v}'`);
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((e: unknown) => { console.error(e); process.exit(1); });
