/**
 * T2-21: property-based tests for geometry invariants. Run each
 * property over many random inputs to catch edge cases hand-fixture
 * tests miss — near-zero segments, near-collinear points, large/small
 * coordinate values, rotated/scaled transforms.
 *
 * Built on the in-house `tests/helpers/propertyTesting.ts` mini-
 * framework (no fast-check dependency added — same execution shape:
 * deterministic seeded PRNG, generator/predicate API, first-failing-
 * counterexample reporting).
 *
 * Property categories (audit 2F section 10):
 *   - Geometry transform invariants
 *   - Closed path invariants
 *   - Bounds invariants
 *   - Output invariants (using T2-18 parser)
 *
 * Run: npx tsx tests/property-geometry.test.ts
 */
import {
  forAll,
  describeFailure,
  type Arbitrary,
  type Pt,
  affineTransform,
  applyAffine,
  bounds,
  convexPolygon,
  point,
  realIn,
} from './helpers/propertyTesting';
import { parseGcode } from './helpers/parseGcode';
import { analyzeBurnBounds } from './helpers/analyzeBurnBounds';

let passed = 0;
let failed = 0;

function check(name: string, result: ReturnType<typeof forAll>): void {
  if (result.ok) {
    passed++;
    console.log(`  ✓ ${name} (${result.runs} cases, seed=${result.seed})`);
  } else {
    failed++;
    console.error(`  ✗ ${name}\n${describeFailure(result)}`);
  }
}

const RUNS = 200;
const EPS = 1e-9;

console.log('\n=== T2-21 property-based geometry invariants ===\n');

void (async () => {

// ─── TRANSFORM INVARIANTS ─────────────────────────────────────

// 1. Bounds of transformed polygon contain every transformed point
check(
  'transform: bounds contain every transformed point',
  forAll(
    [convexPolygon(8, 50), affineTransform()],
    (poly, t) => {
      const xformed = poly.map((p) => applyAffine(p, t));
      const b = bounds(xformed);
      // Numerical tolerance scales with coordinate magnitude — large
      // scale + large translation means the bound endpoints are
      // floating-point sums of products with O(100*5*50) ≈ 25000
      // magnitude, so 1e-6 absolute is plenty.
      const tol = 1e-6 * Math.max(1, Math.abs(b.maxX) + Math.abs(b.maxY));
      return xformed.every((p) =>
        p.x >= b.minX - tol &&
        p.x <= b.maxX + tol &&
        p.y >= b.minY - tol &&
        p.y <= b.maxY + tol,
      );
    },
    { runs: RUNS, seed: 0xa1b2c3 },
  ),
);

// 2. Identity transform leaves points unchanged
check(
  'transform: identity is a no-op',
  forAll(
    [point(100)],
    (p) => {
      const t = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
      const out = applyAffine(p, t);
      return Math.abs(out.x - p.x) < EPS && Math.abs(out.y - p.y) < EPS;
    },
    { runs: RUNS, seed: 0xbeef },
  ),
);

// 3. Pure translation is invertible (apply, apply -t, recover original)
check(
  'transform: translation is invertible',
  forAll(
    [point(100), realIn(-200, 200), realIn(-200, 200)],
    (p, tx, ty) => {
      const fwd = { a: 1, b: 0, c: 0, d: 1, tx, ty };
      const inv = { a: 1, b: 0, c: 0, d: 1, tx: -tx, ty: -ty };
      const after = applyAffine(applyAffine(p, fwd), inv);
      return Math.abs(after.x - p.x) < 1e-9 && Math.abs(after.y - p.y) < 1e-9;
    },
    { runs: RUNS, seed: 0x1234 },
  ),
);

// 4. Bounds.minX <= maxX, minY <= maxY for any non-empty point set
check(
  'bounds: minX ≤ maxX and minY ≤ maxY',
  forAll(
    [convexPolygon(12, 80)],
    (poly) => {
      const b = bounds(poly);
      return b.minX <= b.maxX + EPS && b.minY <= b.maxY + EPS;
    },
    { runs: RUNS, seed: 0xdead },
  ),
);

// ─── CLOSED PATH INVARIANTS ────────────────────────────────────

// 5. Number of points after transform equals number before
check(
  'closed path: transform preserves vertex count',
  forAll(
    [convexPolygon(20, 50), affineTransform()],
    (poly, t) => poly.map((p) => applyAffine(p, t)).length === poly.length,
    { runs: RUNS, seed: 0xc0de },
  ),
);

// 6. No transformed coordinate is NaN or Infinity for finite inputs
//    + bounded transform parameters
check(
  'closed path: no NaN/Infinity after transform',
  forAll(
    [convexPolygon(16, 80), affineTransform()],
    (poly, t) => poly.every((p) => {
      const out = applyAffine(p, t);
      return Number.isFinite(out.x) && Number.isFinite(out.y);
    }),
    { runs: RUNS, seed: 0x42 },
  ),
);

// 7. Polygon area sign preserved across positive-determinant transform.
//    A rotation+positive-scale doesn't flip CCW/CW. (Skipped when
//    determinant is near zero — degenerate transform.)
function signedArea(poly: Pt[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}
check(
  'closed path: positive-det transform preserves winding',
  forAll(
    [convexPolygon(8, 30), affineTransform()],
    (poly, t) => {
      const det = t.a * t.d - t.b * t.c;
      if (Math.abs(det) < 0.01) return true; // skip near-degenerate
      const before = signedArea(poly);
      const after = signedArea(poly.map((p) => applyAffine(p, t)));
      // Both should have the same sign as `det × before` modulo
      // floating-point noise. Specifically, `after ≈ det × before`.
      return Math.sign(after) === Math.sign(det * before);
    },
    { runs: RUNS, seed: 0xfeed },
  ),
);

// ─── BOUNDS INVARIANTS ─────────────────────────────────────────

// 8. bounds of {p} is a single-point AABB
check(
  'bounds: single point produces zero-area AABB',
  forAll(
    [point(100)],
    (p) => {
      const b = bounds([p]);
      return b.minX === p.x && b.maxX === p.x && b.minY === p.y && b.maxY === p.y;
    },
    { runs: RUNS, seed: 0x99 },
  ),
);

// 9. bounds is monotonic — adding a point can only widen, never narrow
check(
  'bounds: adding a point cannot shrink any dimension',
  forAll(
    [convexPolygon(6, 50), point(100)],
    (poly, p) => {
      const b1 = bounds(poly);
      const b2 = bounds([...poly, p]);
      return (
        b2.minX <= b1.minX + EPS &&
        b2.minY <= b1.minY + EPS &&
        b2.maxX >= b1.maxX - EPS &&
        b2.maxY >= b1.maxY - EPS
      );
    },
    { runs: RUNS, seed: 0xfff },
  ),
);

// 10. Empty polygon = empty AABB (Infinity/-Infinity convention)
check(
  'bounds: empty input produces Infinity AABB',
  forAll(
    [{ sample: () => [] as Pt[] } as Arbitrary<Pt[]>],
    (empty) => {
      const b = bounds(empty);
      return b.minX === Infinity && b.maxX === -Infinity;
    },
    { runs: 1 },
  ),
);

// ─── OUTPUT INVARIANTS (use T2-18 parser + T2-19 analyzer) ──────

/**
 * Build a synthetic g-code job from random burn segments. Each call
 * produces valid header → modal-M4 raster pattern → footer gcode.
 * Tests then assert parseGcode/analyzeBurnBounds invariants.
 */
function arbitraryBurnJob(): Arbitrary<{ gcode: string; segments: { from: Pt; to: Pt; power: number }[] }> {
  return {
    sample(rng) {
      const n = rng.int(1, 6);
      const segments: { from: Pt; to: Pt; power: number }[] = [];
      let curX = 0, curY = 0;
      const lines: string[] = ['G21', 'G90', 'M5 S0'];
      // Per-segment M4/M5 cycling. M5 before each G0 zeros the spindle
      // so `noBurnDuringRapid` (parser-level: G0 with active M3/M4 + S>0
      // = violation) holds across all generated jobs. We're not pinning
      // T1-31's modal-M4 emission shape here — that's covered by
      // raster-output-uses-modal-m4. Property tests pin the parser
      // contract, which is conservative on G0+laser-on.
      for (let i = 0; i < n; i++) {
        const startX = rng.float(0, 200);
        const startY = rng.float(0, 200);
        lines.push('M5 S0');
        lines.push(`G0 X${startX.toFixed(3)} Y${startY.toFixed(3)}`);
        curX = startX;
        curY = startY;
        const endX = rng.float(0, 200);
        const endY = rng.float(0, 200);
        const power = rng.int(100, 800);
        lines.push(`M4 S${power}`);
        lines.push(`G1 X${endX.toFixed(3)} Y${endY.toFixed(3)} F1000`);
        segments.push({ from: { x: curX, y: curY }, to: { x: endX, y: endY }, power });
        curX = endX;
        curY = endY;
      }
      lines.push('M5 S0');
      return { gcode: lines.join('\n'), segments };
    },
  };
}

// 11. Every emitted coordinate parses as finite
check(
  'output: parsed move endpoints are finite',
  forAll(
    [arbitraryBurnJob()],
    ({ gcode }) => {
      const parsed = parseGcode(gcode);
      return parsed.moves.every((m) => {
        if (m.toXY) return Number.isFinite(m.toXY.x) && Number.isFinite(m.toXY.y);
        return true;
      });
    },
    { runs: RUNS, seed: 0xd00d },
  ),
);

// 12. noBurnDuringRapid invariant holds across all generated jobs
check(
  'output: noBurnDuringRapid holds for random jobs',
  forAll(
    [arbitraryBurnJob()],
    ({ gcode }) => parseGcode(gcode).asserts.noBurnDuringRapid,
    { runs: RUNS, seed: 0xa5a5 },
  ),
);

// 13. burnBounds is contained within totalBounds
check(
  'output: burnBounds ⊆ totalBounds',
  forAll(
    [arbitraryBurnJob()],
    ({ gcode }) => {
      const a = analyzeBurnBounds(parseGcode(gcode));
      // Empty-AABB sentinel: skip the containment check if no burn
      // moves produced (vacuously true).
      if (a.burnBounds.minX === Infinity) return true;
      return (
        a.burnBounds.minX >= a.totalBounds.minX - EPS &&
        a.burnBounds.maxX <= a.totalBounds.maxX + EPS &&
        a.burnBounds.minY >= a.totalBounds.minY - EPS &&
        a.burnBounds.maxY <= a.totalBounds.maxY + EPS
      );
    },
    { runs: RUNS, seed: 0xbabe },
  ),
);

// 14. Number of burn segments == number of segments declared by the
//     synthetic generator
check(
  'output: parser recovers all generator burn segments',
  forAll(
    [arbitraryBurnJob()],
    ({ gcode, segments }) => {
      const a = analyzeBurnBounds(parseGcode(gcode));
      return a.burnSegments.length === segments.length;
    },
    { runs: RUNS, seed: 0x7777 },
  ),
);

// 15. spindleNeverExceedsMax(1000) holds when generator caps power at 800
check(
  'output: spindleNeverExceedsMax respects generator power ceiling',
  forAll(
    [arbitraryBurnJob()],
    ({ gcode }) => parseGcode(gcode).asserts.spindleNeverExceedsMax(1000),
    { runs: RUNS, seed: 0xbeefc0de },
  ),
);

// 16. endsLaserOff holds for every generated job (we always emit M5 S0
//     at the end)
check(
  'output: endsLaserOff for every generated job',
  forAll(
    [arbitraryBurnJob()],
    ({ gcode }) => parseGcode(gcode).asserts.endsLaserOff,
    { runs: RUNS, seed: 0xdeadbeef },
  ),
);

// 17. unitsDeclared and distanceModeDeclared hold for every job
check(
  'output: every job declares units + distance mode',
  forAll(
    [arbitraryBurnJob()],
    ({ gcode }) => {
      const p = parseGcode(gcode);
      return p.asserts.unitsDeclared && p.asserts.distanceModeDeclared;
    },
    { runs: RUNS, seed: 0xc0ffee },
  ),
);

// 18. totalDistanceBurn ≥ each individual burn segment's straight-line
//     distance — sums are non-negative and at least the largest piece
check(
  'output: totalDistanceBurn ≥ longest single segment',
  forAll(
    [arbitraryBurnJob()],
    ({ gcode }) => {
      const a = analyzeBurnBounds(parseGcode(gcode));
      if (a.burnSegments.length === 0) return true;
      const maxLen = a.burnSegments.reduce((m, s) => {
        const d = Math.hypot(s.toXY.x - s.fromXY.x, s.toXY.y - s.fromXY.y);
        return d > m ? d : m;
      }, 0);
      return a.totalDistanceBurn >= maxLen - EPS;
    },
    { runs: RUNS, seed: 0xface },
  ),
);

// 19. Source-level pin (one assertion to track propertyTesting helper presence)
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const helperSrc = fs.readFileSync(path.resolve(here, 'helpers/propertyTesting.ts'), 'utf-8');
  const ok = /T2-21/.test(helperSrc) &&
    /export function forAll/.test(helperSrc) &&
    /export function makeRng/.test(helperSrc);
  if (ok) {
    passed++;
    console.log(`  ✓ T2-21 helper source: marker + forAll + makeRng exported`);
  } else {
    failed++;
    console.error(`  ✗ T2-21 helper source-pin missing pieces`);
  }
}

// 20. Run-count surfacing — assert that a passing property reports its
//     `runs` accurately. Catches a regression where we silently bail
//     after fewer cases than requested.
{
  const r = forAll(
    [point(10)],
    () => true,
    { runs: 50, seed: 1 },
  );
  if (r.ok && r.runs === 50) {
    passed++;
    console.log(`  ✓ forAll reports actual runs count (got ${r.runs})`);
  } else {
    failed++;
    console.error(`  ✗ forAll runs count mismatch: ${JSON.stringify(r)}`);
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

})().catch((e: unknown) => { console.error(e); process.exit(1); });
