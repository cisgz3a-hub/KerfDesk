/**
 * T2-96: entitlement lifecycle events and revocation polling.
 *
 * Run: npx tsx tests/lifecycle-revocation.test.ts
 */
import {
  ENTITLEMENT_REVOCATIONS_PATH,
  applyLifecycleEvent,
  applyRevocationsToEntitlement,
  findRevocationForPayload,
  mergeRevocationPollState,
  type EntitlementRevocation,
  type RevocationPollState,
} from '../src/entitlements/EntitlementLifecycle';
import type { EntitlementTokenPayload } from '../src/entitlements/SignedEntitlementToken';
import type { EntitlementState, ProFeature } from '../src/entitlements/types';
import { entitlementService } from '../src/entitlements';

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

console.log('\n=== T2-96 lifecycle revocation ===\n');

function payload(overrides: Partial<EntitlementTokenPayload> = {}): EntitlementTokenPayload {
  return {
    sub: 'lic-1',
    tier: 'paid',
    features: ['nesting', 'tabs'],
    iat: 1_000,
    exp: 100_000,
    jti: 'jti-current',
    ...overrides,
  };
}

function paidState(features: readonly ProFeature[] = ['nesting', 'tabs']): EntitlementState {
  return {
    tier: 'paid',
    hasPro: true,
    status: 'verified',
    statusDetail: { kind: 'verified', lastVerifiedAt: 1_000 },
    label: 'Pro',
    features,
  };
}

type WithState = { state: EntitlementState };
function withEntitlementState(state: EntitlementState, body: () => void): void {
  const svc = entitlementService as unknown as WithState;
  const original = svc.state;
  svc.state = state;
  try {
    body();
  } finally {
    svc.state = original;
  }
}

void (async () => {

// 1. Revocation endpoint is explicit and extends the T2-89 server contract.
{
  assert(ENTITLEMENT_REVOCATIONS_PATH === '/entitlement/revocations', 'revocations path');
}

// 2. Poll results merge into a local persisted set and advance lastSeen.
{
  const existing: RevocationPollState = {
    lastSeenRevocationAt: 10,
    revocations: [{ jti: 'old', revokedAt: 10, reason: 'manual' }],
  };
  const incoming: readonly EntitlementRevocation[] = [
    { jti: 'new', revokedAt: 25, reason: 'refunded' },
    { jti: 'old', revokedAt: 30, reason: 'chargebacked' },
  ];
  const merged = mergeRevocationPollState(existing, incoming);
  assert(merged.revocations.length === 2, 'merge de-duplicates by jti');
  assert(merged.lastSeenRevocationAt === 30, 'lastSeen advances to newest revokedAt');
  assert(merged.revocations.find((r) => r.jti === 'old')?.reason === 'chargebacked', 'newer duplicate wins');
}

// 3. Current token jti in the local revocation list is found immediately.
{
  const p = payload({ jti: 'jti-current' });
  const revocations: readonly EntitlementRevocation[] = [
    { jti: 'other', revokedAt: 10, reason: 'manual' },
    { jti: 'jti-current', revokedAt: 20, reason: 'refunded' },
  ];
  const hit = findRevocationForPayload(p, revocations);
  assert(hit?.reason === 'refunded', 'current token revocation found');
}

// 4. A current-token revocation overrides offline grace immediately.
{
  const before: EntitlementState = {
    ...paidState(['nesting']),
    status: 'offline_grace',
    statusDetail: { kind: 'offline_grace', lastVerifiedAt: 1_000, graceUntil: 999_999 },
  };
  const after = applyRevocationsToEntitlement(
    before,
    payload({ jti: 'jti-current' }),
    [{ jti: 'jti-current', revokedAt: 50_000, reason: 'manual', message: 'shared license' }],
  );
  assert(after.status === 'revoked', 'revocation overrides offline grace');
  assert(after.statusDetail?.kind === 'revoked', 'statusDetail revoked');
  assert(after.hasPro === false, 'revoked disables Pro');
  assert(after.features?.length === 0, 'revoked clears features');
}

// 5. Plan downgrade replaces features so T2-92 per-feature checks reflect the new plan.
{
  const after = applyLifecycleEvent(paidState(['nesting', 'tabs', 'boolean_ops']), {
    type: 'plan-downgraded',
    oldFeatures: ['nesting', 'tabs', 'boolean_ops'],
    newFeatures: ['nesting'],
    changedAt: 60_000,
  });
  assert(after.status === 'verified', 'downgrade preserves verified status');
  assert(after.features?.join(',') === 'nesting', 'downgrade replaces feature list');
  withEntitlementState(after, () => {
    assert(entitlementService.canUse('nesting') === true, 'retained feature still allowed');
    assert(entitlementService.canUse('tabs') === false, 'removed feature no longer allowed');
  });
}

// 6. Expiry lifecycle event disables Pro and records an expired detail state.
{
  const after = applyLifecycleEvent(paidState(), { type: 'expired', expiredAt: 70_000 });
  assert(after.tier === 'free', 'expired falls back to free tier');
  assert(after.hasPro === false, 'expired disables Pro');
  assert(after.statusDetail?.kind === 'expired', 'expired statusDetail');
}

// 7. Source-level pin for the lifecycle event catalog and revocation path.
{
  const fs = await import('node:fs');
  const path = await import('node:path');
  const url = await import('node:url');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(here, '..');
  const source = fs.readFileSync(path.join(repoRoot, 'src/entitlements/EntitlementLifecycle.ts'), 'utf-8');
  assert(/T2-96/.test(source), 'T2-96 marker');
  assert(/ENTITLEMENT_REVOCATIONS_PATH/.test(source), 'revocation path exported');
  for (const kind of ['refunded', 'chargebacked', 'manually-revoked', 'plan-upgraded', 'plan-downgraded', 'expired']) {
    assert(source.includes(kind), `lifecycle kind '${kind}' declared`);
  }
}

console.log(`\nT2-96 lifecycle revocation: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);

})();
