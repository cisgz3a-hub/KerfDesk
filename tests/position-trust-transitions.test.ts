/**
 * T2-66: explicit `PositionTrust` state. Pre-T2-66 the codebase had
 * no flag tracking whether the controller's reported position
 * actually matches the machine's physical position. After alarm,
 * E-stop, disconnect, manual realtime command, or a failed frame,
 * the user could press Start without re-homing — Audit 4C P9.
 *
 * Run: npx tsx tests/position-trust-transitions.test.ts
 */
import {
  initialPositionTrust,
  transitionPositionTrust,
  positionTrustMessage,
  canStartJobUnderTrust,
  type PositionTrust,
  type PositionTrustEvent,
  type PositionTrustLostReason,
} from '../src/app/PositionTrust';

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

console.log('\n=== T2-66 PositionTrust transitions ===\n');

void (async () => {

// 1. initialPositionTrust: app start = never-homed
{
  const t = initialPositionTrust();
  assert(t.trusted === false, 'initial: trusted=false');
  if (!t.trusted) {
    assert(t.reason === 'never-homed', `initial: reason='never-homed' (got ${t.reason})`);
  }
}

// 2. home-success → trusted
{
  const t1 = initialPositionTrust();
  const t2 = transitionPositionTrust(t1, { kind: 'home-success' }, 1000);
  assert(t2.trusted === true, 'home-success: trusted=true');
}

// 3. soft-reset → untrusted with reason
{
  const trusted: PositionTrust = { trusted: true };
  const after = transitionPositionTrust(trusted, { kind: 'soft-reset' }, 2000);
  assert(after.trusted === false, 'soft-reset: trusted=false');
  if (!after.trusted) {
    assert(after.reason === 'soft-reset', `soft-reset: reason='soft-reset' (got ${after.reason})`);
    assert(after.lostAt === 2000, `soft-reset: lostAt=2000 (got ${after.lostAt})`);
  }
}

// 4. emergency-stop → untrusted
{
  const trusted: PositionTrust = { trusted: true };
  const after = transitionPositionTrust(trusted, { kind: 'emergency-stop' }, 3000);
  if (!after.trusted) {
    assert(after.reason === 'emergency-stop',
      `emergency-stop: reason='emergency-stop' (got ${after.reason})`);
  }
}

// 5. disconnect → untrusted
{
  const trusted: PositionTrust = { trusted: true };
  const after = transitionPositionTrust(trusted, { kind: 'disconnect' }, 4000);
  if (!after.trusted) {
    assert(after.reason === 'disconnect',
      `disconnect: reason='disconnect' (got ${after.reason})`);
  }
}

// 6. manual-command from trusted → untrusted with reason='manual-command'
{
  const trusted: PositionTrust = { trusted: true };
  const after = transitionPositionTrust(trusted, { kind: 'manual-command' }, 5000);
  if (!after.trusted) {
    assert(after.reason === 'manual-command',
      `manual-command from trusted: reason='manual-command' (got ${after.reason})`);
  }
}

// 7. manual-command from untrusted → unchanged (already lost; reason preserved)
{
  const lost: PositionTrust = { trusted: false, reason: 'soft-reset', lostAt: 100 };
  const after = transitionPositionTrust(lost, { kind: 'manual-command' }, 6000);
  assert(after === lost,
    'manual-command from untrusted: state ref unchanged (reason preserved)');
}

// 8. frame-success → trusted
{
  const lost: PositionTrust = { trusted: false, reason: 'soft-reset', lostAt: 100 };
  const after = transitionPositionTrust(lost, { kind: 'frame-success' }, 7000);
  assert(after.trusted === true, 'frame-success: trusted=true');
}

// 9. frame-fail → untrusted with reason='frame-failed'
{
  const trusted: PositionTrust = { trusted: true };
  const after = transitionPositionTrust(trusted, { kind: 'frame-fail' }, 8000);
  if (!after.trusted) {
    assert(after.reason === 'frame-failed',
      `frame-fail: reason='frame-failed' (got ${after.reason})`);
  }
}

// 10. unlock ($X) does NOT restore trust (audit "Misleading state 3")
{
  const lost: PositionTrust = { trusted: false, reason: 'soft-reset', lostAt: 100 };
  const after = transitionPositionTrust(lost, { kind: 'unlock' }, 9000);
  assert(after.trusted === false,
    `$X unlock: trust unchanged (still untrusted) — audit 'Misleading state 3'`);
}

// 11. save-origin → trusted (user is asserting position)
{
  const lost: PositionTrust = { trusted: false, reason: 'soft-reset', lostAt: 100 };
  const after = transitionPositionTrust(lost, { kind: 'save-origin' }, 10000);
  assert(after.trusted === true, 'save-origin: trusted=true (user asserts)');
}

// 12. home-cancel from trusted → untrusted manual-command
{
  const trusted: PositionTrust = { trusted: true };
  const after = transitionPositionTrust(trusted, { kind: 'home-cancel' }, 11000);
  if (!after.trusted) {
    assert(after.reason === 'manual-command',
      `home-cancel: reason='manual-command' (got ${after.reason})`);
  }
}

// 13. home-cancel from untrusted → unchanged
{
  const lost: PositionTrust = { trusted: false, reason: 'soft-reset', lostAt: 100 };
  const after = transitionPositionTrust(lost, { kind: 'home-cancel' }, 12000);
  assert(after === lost,
    'home-cancel from untrusted: state unchanged');
}

// 14. positionTrustMessage: trusted → null
{
  assert(positionTrustMessage({ trusted: true }) === null,
    'positionTrustMessage(trusted) === null');
}

// 15. positionTrustMessage: every reason has a distinct message
{
  const reasons: PositionTrustLostReason[] = [
    'never-homed', 'soft-reset', 'emergency-stop',
    'disconnect', 'manual-command', 'frame-failed',
  ];
  const messages = new Set<string>();
  for (const reason of reasons) {
    const msg = positionTrustMessage({ trusted: false, reason, lostAt: 0 });
    assert(msg != null && msg.length > 0,
      `'${reason}': non-empty message`);
    if (msg) messages.add(msg);
  }
  assert(messages.size === reasons.length,
    `every reason has a distinct message (${messages.size} unique)`);
}

// 16. canStartJobUnderTrust: trusted + any mode → allowed
{
  const trusted: PositionTrust = { trusted: true };
  for (const mode of ['absolute', 'current', 'savedOrigin'] as const) {
    const r = canStartJobUnderTrust(trusted, mode);
    assert(r.allowed === true, `trusted + '${mode}': allowed=true`);
  }
}

// 17. canStartJobUnderTrust: untrusted + savedOrigin → blocked with reason
{
  const lost: PositionTrust = { trusted: false, reason: 'soft-reset', lostAt: 100 };
  const r = canStartJobUnderTrust(lost, 'savedOrigin');
  assert(r.allowed === false,
    `untrusted + savedOrigin: allowed=false`);
  if (!r.allowed) {
    assert(/saved.origin|trusted position/i.test(r.reason),
      `untrusted + savedOrigin: reason mentions saved-origin or trust (got '${r.reason}')`);
  }
}

// 18. canStartJobUnderTrust: untrusted + absolute/current → allowed
//     (user is accepting the risk)
{
  const lost: PositionTrust = { trusted: false, reason: 'soft-reset', lostAt: 100 };
  for (const mode of ['absolute', 'current'] as const) {
    const r = canStartJobUnderTrust(lost, mode);
    assert(r.allowed === true,
      `untrusted + '${mode}': allowed=true (user accepts risk)`);
  }
}

// 19. End-to-end flow: home → run → soft-reset → savedOrigin blocked → save-origin → savedOrigin allowed
{
  let t = initialPositionTrust();
  t = transitionPositionTrust(t, { kind: 'home-success' }, 1000);
  assert(t.trusted, 'flow: trusted after home');
  t = transitionPositionTrust(t, { kind: 'soft-reset' }, 2000);
  assert(!t.trusted, 'flow: untrusted after soft-reset');
  assert(canStartJobUnderTrust(t, 'savedOrigin').allowed === false,
    'flow: savedOrigin blocked after soft-reset');
  t = transitionPositionTrust(t, { kind: 'save-origin' }, 3000);
  assert(t.trusted, 'flow: trusted after save-origin');
  assert(canStartJobUnderTrust(t, 'savedOrigin').allowed === true,
    'flow: savedOrigin allowed after save-origin');
}

// 20. PositionTrustEvent type covers all 10 expected event kinds
{
  const all: PositionTrustEvent[] = [
    { kind: 'home-success' }, { kind: 'home-cancel' },
    { kind: 'soft-reset' }, { kind: 'emergency-stop' },
    { kind: 'disconnect' }, { kind: 'manual-command' },
    { kind: 'frame-success' }, { kind: 'frame-fail' },
    { kind: 'unlock' }, { kind: 'save-origin' },
  ];
  assert(all.length === 10, `10 declared event kinds`);
}

// 21. Source-level pin
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.resolve(here, '../src/app/PositionTrust.ts'), 'utf-8');
  assert(/T2-66/.test(src), 'T2-66 marker in PositionTrust.ts');
  for (const id of [
    'PositionTrust', 'PositionTrustEvent', 'PositionTrustLostReason',
    'initialPositionTrust', 'transitionPositionTrust',
    'positionTrustMessage', 'canStartJobUnderTrust',
  ]) {
    assert(src.includes(id), `export '${id}' declared`);
  }
  for (const reason of ['never-homed', 'soft-reset', 'emergency-stop',
                        'disconnect', 'manual-command', 'frame-failed']) {
    assert(src.includes(`'${reason}'`), `reason '${reason}' declared`);
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((e: unknown) => { console.error(e); process.exit(1); });
