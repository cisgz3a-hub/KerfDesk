/**
 * T1-41: saved-origin G54 verification helper. Tests the pure
 * comparison logic (controller-query plumbing is exercised by
 * higher-level integration tests when those land — for now the
 * helper is the load-bearing safety surface).
 *
 * Hardware verification needed — Falcon A1 Pro front-origin burn test.
 *
 * Run: npx tsx tests/saved-origin-verifies-wcs.test.ts
 */
import {
  verifySavedOriginG54,
  describeSavedOriginDrift,
  G54_DRIFT_TOLERANCE_MM,
} from '../src/app/savedOriginVerify';

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

console.log('\n=== T1-41 saved-origin verification ===\n');

// ── Identity: same G54 → ok ──────────────────────────────────────
{
  const r = verifySavedOriginG54({ x: -100, y: -50, z: 0 }, { x: -100, y: -50, z: 0 });
  assert(r.ok === true, 'identical G54 → ok');
}

// ── Within tolerance → ok ────────────────────────────────────────
{
  const halfTol = G54_DRIFT_TOLERANCE_MM / 2;
  const r = verifySavedOriginG54(
    { x: -100, y: -50, z: 0 },
    { x: -100 + halfTol, y: -50 - halfTol, z: 0 + halfTol },
  );
  assert(r.ok === true, 'all axes within tolerance → ok');
}

// ── X axis drift > tolerance → blocked ──────────────────────────
{
  const r = verifySavedOriginG54({ x: -100, y: -50, z: 0 }, { x: -110, y: -50, z: 0 });
  assert(r.ok === false, 'X drift 10mm: blocked');
  if (!r.ok && r.reason === 'drift' && r.drift) {
    assert(r.drift.axis === 'x', 'X drift: drift.axis is "x"');
    assert(Math.abs(r.drift.deltaMm - (-10)) < 1e-9,
      `X drift: deltaMm = -10; got ${r.drift.deltaMm}`);
    assert(r.drift.expected === -100 && r.drift.actual === -110,
      'X drift: expected/actual carried in result');
  }
}

// ── Y axis drift > tolerance → blocked ──────────────────────────
{
  const r = verifySavedOriginG54({ x: 0, y: 100, z: 0 }, { x: 0, y: 95, z: 0 });
  assert(r.ok === false, 'Y drift 5mm: blocked');
  if (!r.ok && r.reason === 'drift' && r.drift) {
    assert(r.drift.axis === 'y', 'Y drift: drift.axis is "y"');
  }
}

// ── Z axis drift > tolerance → blocked ──────────────────────────
{
  const r = verifySavedOriginG54({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -2 });
  assert(r.ok === false, 'Z drift 2mm: blocked');
  if (!r.ok && r.reason === 'drift' && r.drift) {
    assert(r.drift.axis === 'z', 'Z drift: drift.axis is "z"');
  }
}

// ── Multiple axes drift: report first (X first) ─────────────────
{
  const r = verifySavedOriginG54({ x: 0, y: 0, z: 0 }, { x: 5, y: 5, z: 5 });
  assert(r.ok === false, 'multi-axis drift: blocked');
  if (!r.ok && r.reason === 'drift' && r.drift) {
    assert(r.drift.axis === 'x',
      'multi-axis drift: X reported first (deterministic ordering)');
  }
}

// ── No snapshot → blocked with no-snapshot reason ───────────────
{
  const r = verifySavedOriginG54(null, { x: 0, y: 0, z: 0 });
  assert(r.ok === false && r.reason === 'no-snapshot',
    'null expectedG54 → reason="no-snapshot" (Set Origin not run)');
}

// ── No current G54 → blocked with no-current-g54 reason ─────────
{
  const r = verifySavedOriginG54({ x: 0, y: 0, z: 0 }, null);
  assert(r.ok === false && r.reason === 'no-current-g54',
    'null currentG54 → reason="no-current-g54" ($# query timed out)');
}

// ── Both null → no-snapshot wins (caller fixes Set Origin first) ─
{
  const r = verifySavedOriginG54(null, null);
  assert(r.ok === false && r.reason === 'no-snapshot',
    'both null → no-snapshot wins (the more actionable message)');
}

// ── User-facing message format ───────────────────────────────────
{
  const r = verifySavedOriginG54({ x: -100, y: -50, z: 0 }, { x: -110, y: -50, z: 0 });
  if (!r.ok && r.reason === 'drift' && r.drift) {
    const msg = describeSavedOriginDrift(r.drift);
    assert(/saved origin is no longer valid/i.test(msg),
      'message: opens with "Saved origin is no longer valid"');
    assert(/X axis drifted by -10\.000 mm/.test(msg),
      'message: includes axis name + deltaMm with three decimals');
    assert(/expected -100\.000.*machine reports -110\.000/.test(msg),
      'message: includes expected and actual values for support diagnosis');
    assert(/Set Origin again|switch to absolute/i.test(msg),
      'message: tells the user what to do (re-set origin, or switch start mode)');
  }
}

// ── Custom tolerance ────────────────────────────────────────────
{
  const looser = verifySavedOriginG54({ x: 0, y: 0, z: 0 }, { x: 0.5, y: 0, z: 0 }, 1.0);
  assert(looser.ok === true, 'custom tolerance 1mm: 0.5mm drift → ok');
  const tighter = verifySavedOriginG54({ x: 0, y: 0, z: 0 }, { x: 0.005, y: 0, z: 0 }, 0.001);
  assert(tighter.ok === false, 'custom tolerance 0.001mm: 0.005mm drift → blocked');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
