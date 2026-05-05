/**
 * T2-93: license status as a first-class discriminated union, refining
 * T1-80's flat-string `status`. Tests cover the new
 * `LicenseStatusDetail` type + its helpers (`statusAllowsPro`,
 * `statusUserMessage`, `buildStatusDetail`), plus EntitlementService
 * integration: `state.statusDetail.kind` matches `state.status` string
 * across all initialization paths.
 *
 * Run: npx tsx tests/license-status-machine.test.ts
 */
import {
  type LicenseStatusDetail,
  buildStatusDetail,
  statusAllowsPro,
  statusUserMessage,
} from '../src/entitlements/LicenseStatus';
import { EntitlementService } from '../src/entitlements/EntitlementService';
import { InMemoryStorageAdapter } from '../src/core/storage/InMemoryStorageAdapter';
import { setStorageForTest, getStorage } from '../src/core/storage/storage';

const STORAGE_KEY = 'laserforge_license';
const LICENSE_CACHE_KEY = 'laserforge_license_cache';

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

const SAVED_CODE = 'TEST-PURCHASE-1234567890';

console.log('\n=== T2-93 license status state machine ===\n');

void (async () => {

// ─── statusAllowsPro: each kind ───────────────────────────────

const cases: Array<[LicenseStatusDetail, boolean]> = [
  [{ kind: 'free' }, false],
  [{ kind: 'verified', lastVerifiedAt: 1 }, true],
  [{ kind: 'offline_grace', lastVerifiedAt: 1, graceUntil: 2 }, true],
  [{ kind: 'expired', expiredAt: 1 }, false],
  [{ kind: 'verification_failed', attemptedAt: 1, lastError: 'x' }, false],
  [{ kind: 'revoked', revokedAt: 1, reason: 'refunded' }, false],
  [{ kind: 'developer' }, true],
  [{ kind: 'tester', testerSlug: 'alice' }, true],
];
for (const [s, expected] of cases) {
  assert(statusAllowsPro(s) === expected,
    `statusAllowsPro({kind:'${s.kind}'}) === ${expected}`);
}

// ─── statusUserMessage: per-kind tone + actions ─────────────────

{
  const m = statusUserMessage({ kind: 'free' });
  assert(m.tone === 'neutral' && m.actions.includes('enter-license'),
    `free: tone=neutral, actions includes enter-license`);
}
{
  const m = statusUserMessage({ kind: 'verified', lastVerifiedAt: 1 });
  assert(m.tone === 'ok' && m.title === 'Pro verified',
    `verified: tone=ok, title='Pro verified'`);
}
{
  const m = statusUserMessage({ kind: 'offline_grace', lastVerifiedAt: 1, graceUntil: Date.now() + 86400000 });
  assert(m.tone === 'warn' && /grace/i.test(m.title),
    `offline_grace: tone=warn`);
}
{
  const m = statusUserMessage({ kind: 'expired', expiredAt: 1 });
  assert(m.tone === 'error' && m.actions.includes('renew'),
    `expired: tone=error, actions includes renew`);
}
{
  const m = statusUserMessage({ kind: 'verification_failed', attemptedAt: 1, lastError: 'HTTP 500' });
  assert(m.tone === 'error' && m.message === 'HTTP 500' &&
    m.actions.includes('retry') && m.actions.includes('contact-support'),
    `verification_failed: tone=error, message=lastError, actions={retry, contact-support}`);
}
{
  const m = statusUserMessage({ kind: 'revoked', revokedAt: 1, reason: 'refunded' });
  assert(m.tone === 'error' && /refunded/.test(m.message) && m.actions.includes('contact-support'),
    `revoked: tone=error, message names reason, actions includes contact-support`);
}
{
  const m = statusUserMessage({ kind: 'developer' });
  assert(m.tone === 'ok' && m.actions.length === 0,
    `developer: tone=ok, no actions`);
}
{
  const m = statusUserMessage({ kind: 'tester', testerSlug: 'beta-team' });
  assert(m.tone === 'ok' && /beta-team/.test(m.message),
    `tester: tone=ok, message names slug`);
}

// ─── buildStatusDetail: bridge from flat status ───────────────

{
  const d = buildStatusDetail({ status: 'verified', lastVerifiedAt: 12345 });
  assert(d.kind === 'verified' && (d as { lastVerifiedAt: number }).lastVerifiedAt === 12345,
    `buildStatusDetail(verified): kind + lastVerifiedAt populated`);
}
{
  const d = buildStatusDetail({ status: 'offline_grace', lastVerifiedAt: 100, graceUntil: 200 });
  assert(d.kind === 'offline_grace' &&
    (d as { graceUntil: number }).graceUntil === 200,
    `buildStatusDetail(offline_grace): graceUntil populated`);
}
{
  const d = buildStatusDetail({ status: 'verification_failed', lastError: 'boom' });
  assert(d.kind === 'verification_failed' &&
    (d as { lastError: string }).lastError === 'boom',
    `buildStatusDetail(verification_failed): lastError populated`);
}
{
  const d = buildStatusDetail({ status: 'revoked', revokedReason: 'refunded' });
  assert(d.kind === 'revoked' &&
    (d as { reason: string }).reason === 'refunded',
    `buildStatusDetail(revoked): reason populated`);
}
{
  const d = buildStatusDetail({ status: 'tester', testerSlug: 'qa-1' });
  assert(d.kind === 'tester' &&
    (d as { testerSlug: string }).testerSlug === 'qa-1',
    `buildStatusDetail(tester): testerSlug populated`);
}
{
  // Defaults: missing fields fall back to safe values
  const d = buildStatusDetail({ status: 'verification_failed', now: 999 });
  assert(d.kind === 'verification_failed' &&
    (d as { attemptedAt: number }).attemptedAt === 999 &&
    (d as { lastError: string }).lastError.length > 0,
    `buildStatusDetail(verification_failed) defaults: attemptedAt + non-empty lastError`);
}

// ─── EntitlementService integration: state.statusDetail.kind matches state.status ─────

{
  await freshAdapter();
  await getStorage().set(STORAGE_KEY, SAVED_CODE);
  installFetchMock({
    ok: true,
    body: { success: true, purchase: { email: 'paid@example.com', refunded: false } },
  });
  const svc = new EntitlementService();
  await svc.initialize();
  const s = svc.getState();
  const sd1 = s.statusDetail;
  if (sd1 == null) { failed++; console.error('  ✗ service-verified: statusDetail is undefined'); }
  else {
    assert(sd1.kind === 'verified' && s.status === 'verified',
      `service-verified: statusDetail.kind === status (got ${sd1.kind} / ${s.status})`);
    assert(sd1.kind === 'verified' && sd1.lastVerifiedAt === s.lastVerifiedAt,
      `service-verified: statusDetail.lastVerifiedAt matches state.lastVerifiedAt`);
  }
}

{
  await freshAdapter();
  await getStorage().set(STORAGE_KEY, SAVED_CODE);
  installFetchMock({
    ok: true,
    body: { success: true, purchase: { refunded: true } },
  });
  const svc = new EntitlementService();
  await svc.initialize();
  const s = svc.getState();
  assert(s.statusDetail != null && s.statusDetail.kind === 'revoked' && s.status === 'revoked',
    `service-revoked: statusDetail.kind === status`);
}

{
  await freshAdapter();
  installFetchMock({ throws: new Error('SHOULD NOT BE CALLED') });
  const svc = new EntitlementService();
  await svc.initialize();
  const s = svc.getState();
  const sd = s.statusDetail;
  if (sd == null) { failed++; console.error('  ✗ service-free: statusDetail is undefined'); }
  else {
    assert(sd.kind === 'free' && s.status === 'free',
      `service-free (no license): statusDetail.kind === 'free'`);
    assert(!statusAllowsPro(sd),
      `service-free: statusAllowsPro returns false`);
  }
}

{
  await freshAdapter();
  await getStorage().set(STORAGE_KEY, SAVED_CODE);
  installFetchMock({ ok: false, status: 500 });
  const svc = new EntitlementService();
  await svc.initialize();
  const s = svc.getState();
  const sd = s.statusDetail;
  if (sd == null) { failed++; console.error('  ✗ service-verification_failed: statusDetail is undefined'); }
  else {
    assert(sd.kind === 'verification_failed',
      `service-verification_failed: statusDetail.kind correct`);
    if (sd.kind === 'verification_failed') {
      assert(sd.lastError === s.lastError,
        `service-verification_failed: statusDetail.lastError matches state.lastError`);
    }
  }
}

// ─── Source-level pin ────────────────────────────────────────

{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const lsSrc = fs.readFileSync(
    path.resolve(here, '../src/entitlements/LicenseStatus.ts'),
    'utf-8',
  );
  assert(/T2-93/.test(lsSrc), 'T2-93 marker in LicenseStatus.ts');
  for (const k of ['free', 'verified', 'offline_grace', 'expired', 'verification_failed', 'revoked', 'developer', 'tester']) {
    assert(lsSrc.includes(`'${k}'`),
      `LicenseStatus.ts declares kind '${k}'`);
  }
  const svcSrc = fs.readFileSync(
    path.resolve(here, '../src/entitlements/EntitlementService.ts'),
    'utf-8',
  );
  assert(/T2-93/.test(svcSrc), 'T2-93 marker in EntitlementService.ts');
  assert(/deriveStatusDetail/.test(svcSrc),
    'service uses deriveStatusDetail to populate statusDetail at setState');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((e: unknown) => { console.error(e); process.exit(1); });
