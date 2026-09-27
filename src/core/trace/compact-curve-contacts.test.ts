import { describe, expect, it } from 'vitest';
import type { CurveSubpath, Polyline, Vec2 } from '../scene';
import { CurveContactCache } from './compact-curve-contacts';
import { pieceMeetsItself, piecesMeet } from './compact-curve-meet';
import { sampleCompactCurve } from './compact-curve-fit';
import { intersectingContourLoopsSteps } from './contour-intersections';
import { curvedTraceRing } from './trace-curves';
import { runTraceSteps } from './trace-steps';

// ADR-483: the crossing guard tests the fitted curves, not only their
// compatibility samples. Every fixture below is a real trace output whose
// curves meet while its samples do not show it.

// A 0.65 x 0.04 px sliver from the Sharp owl trace (bake-off, 2026-09-26):
// both cubics overshoot their chords, so each doubles back on itself in a
// loop about 0.01 px across. Its flattened curve self-crosses; its evenly
// spaced samples did not show it, so the topology repair never saw it.
const SLIVER: CurveSubpath = {
  start: { x: 243.36651785714287, y: 147.43508099745077 },
  segments: [
    { kind: 'line', to: { x: 243.69100421875004, y: 147.4529053680133 } },
    {
      kind: 'cubic',
      control1: { x: 243.79932940154856, y: 147.4529053680133 },
      control2: { x: 243.25819267434434, y: 147.4707297385758 },
      to: { x: 243.36651785714287, y: 147.4707297385758 },
    },
    {
      kind: 'cubic',
      control1: { x: 243.4748430399414, y: 147.4707297385758 },
      control2: { x: 242.93370631273717, y: 147.4529053680133 },
      to: { x: 243.0420314955357, y: 147.4529053680133 },
    },
    { kind: 'line', to: { x: 243.36651785714287, y: 147.43508099745077 } },
  ],
  closed: true,
};

// A 6 degree spike from the Sharp trace of the bake-off's 4000 px mosaic
// (working grid): the two cubics leaving the tip bend into each other and
// cross within 0.005 px of it.
const SPIKE: CurveSubpath = {
  start: { x: 1676.3776022072832, y: 1186.4986847544799 },
  segments: [
    {
      kind: 'cubic',
      control1: { x: 1676.3994704007619, y: 1185.663570220285 },
      control2: { x: 1677.5834743977582, y: 1185.177690244791 },
      to: { x: 1675.9210902400303, y: 1183.9641655144453 },
    },
    {
      kind: 'cubic',
      control1: { x: 1677.181304444276, y: 1185.1097963246043 },
      control2: { x: 1681.8344905810784, y: 1184.3918246619344 },
      to: { x: 1683.619284243479, y: 1184.5256289943438 },
    },
    { kind: 'line', to: { x: 1676.3776022072832, y: 1186.4986847544799 } },
  ],
  closed: true,
};

// From the Sharp trace of the owl at 2x (source px): the first cubic leaves
// its seam along a short arm almost at right angles to the closing line, then
// turns and runs beside that line within 0.01 px, crossing it.
const BESIDE_LINE: CurveSubpath = {
  start: { x: 520.525537890625, y: 1527.3220081734628 },
  segments: [
    {
      kind: 'cubic',
      control1: { x: 520.4544834881902, y: 1527.30231452882 },
      control2: { x: 520.4496576516799, y: 1528.0820933298187 },
      to: { x: 520.1492521131302, y: 1528.4244843037807 },
    },
    {
      kind: 'cubic',
      control1: { x: 518.5346454217149, y: 1530.2647524969311 },
      control2: { x: 517.3833294949573, y: 1532.4299251019172 },
      to: { x: 515.9040570651262, y: 1534.3731030743966 },
    },
    {
      kind: 'cubic',
      control1: { x: 514.812996683128, y: 1535.8063242026954 },
      control2: { x: 508.22189038168057, y: 1540.6573220506177 },
      to: { x: 510.9580506127529, y: 1542.4557021275998 },
    },
    {
      kind: 'cubic',
      control1: { x: 513.3519273684597, y: 1544.0291115410266 },
      control2: { x: 518.3013803992519, y: 1535.2928892375644 },
      to: { x: 519.0117658867588, y: 1533.4801652850638 },
    },
    { kind: 'line', to: { x: 520.525537890625, y: 1527.3220081734628 } },
  ],
  closed: true,
};

// From the Line Art trace of the owl (bake-off, source px): the two legs of a
// narrow spike cross each other twice about half a pixel from the tip, a lens
// 0.09 px long and far thinner than the 0.02 px sampling error. Closed here
// by a line.
const SPIKE_LENS: CurveSubpath = {
  start: { x: 560.0630435965045, y: 1016.3339366508603 },
  segments: [
    {
      kind: 'cubic',
      control1: { x: 561.270997638973, y: 1015.1341597715772 },
      control2: { x: 559.6434065390893, y: 1016.0151715563885 },
      to: { x: 560.5166099869376, y: 1014.7680920734712 },
    },
    {
      kind: 'cubic',
      control1: { x: 560.6478413288563, y: 1014.5806719316636 },
      control2: { x: 560.2790034710008, y: 1014.0619249302443 },
      to: { x: 560.5069380113738, y: 1014.0817698278742 },
    },
    {
      kind: 'cubic',
      control1: { x: 560.7113172756882, y: 1014.0995639084524 },
      control2: { x: 560.4897595874991, y: 1014.4996488049851 },
      to: { x: 560.5501630864784, y: 1014.6957072919129 },
    },
    {
      kind: 'cubic',
      control1: { x: 561.018878602003, y: 1016.2170703971328 },
      control2: { x: 560.4386331493048, y: 1018.2432731516582 },
      to: { x: 562.5173702518482, y: 1019.1311028660747 },
    },
    { kind: 'line', to: { x: 560.0630435965045, y: 1016.3339366508603 } },
  ],
  closed: true,
};

// From the Line Art trace of the hummingbird's luma: two outlines pass
// through each other in a lens 0.07 px long (a stretch of each, closed by a
// line).
const LENS_A: CurveSubpath = {
  start: { x: 758.3698065303088, y: 386.0208528885605 },
  segments: [
    {
      kind: 'cubic',
      control1: { x: 758.426196930184, y: 386.0598013020321 },
      control2: { x: 760.5172149525426, y: 389.261640546485 },
      to: { x: 760.5468259964805, y: 389.40739528297024 },
    },
    {
      kind: 'cubic',
      control1: { x: 760.7292666086252, y: 390.305424525141 },
      control2: { x: 759.1631950017274, y: 392.1943718428755 },
      to: { x: 760.9084606029572, y: 393.40407825544713 },
    },
    {
      kind: 'cubic',
      control1: { x: 763.8505449772264, y: 395.44334284152063 },
      control2: { x: 764.3123863482117, y: 389.94822194954065 },
      to: { x: 764.9964084373192, y: 389.40786209402523 },
    },
    { kind: 'line', to: { x: 758.3698065303088, y: 386.0208528885605 } },
  ],
  closed: true,
};

const LENS_B: CurveSubpath = {
  start: { x: 754.4655724517809, y: 394.0030511830897 },
  segments: [
    {
      kind: 'cubic',
      control1: { x: 755.8902770915818, y: 394.07862034786643 },
      control2: { x: 758.127254207067, y: 395.47451942722694 },
      to: { x: 759.5929890076011, y: 393.9323375892679 },
    },
    {
      kind: 'cubic',
      control1: { x: 762.0088515165105, y: 391.3904730699232 },
      control2: { x: 756.8954570051966, y: 391.63984482380835 },
      to: { x: 755.6040867918945, y: 390.9709136915989 },
    },
    {
      kind: 'cubic',
      control1: { x: 754.4367705244136, y: 390.3662426341368 },
      control2: { x: 754.0140439213737, y: 389.3967458229574 },
      to: { x: 752.9372123731835, y: 388.677828845117 },
    },
    { kind: 'line', to: { x: 754.4655724517809, y: 394.0030511830897 } },
  ],
  closed: true,
};

const ring = (curve: CurveSubpath): Polyline => curvedTraceRing(sampleCompactCurve(curve), curve);

function sampleConflicts(rings: ReadonlyArray<Polyline>): Set<number> {
  return runTraceSteps(intersectingContourLoopsSteps(rings));
}

function curveConflicts(rings: ReadonlyArray<Polyline>): Set<number> {
  return runTraceSteps(new CurveContactCache().conflictsSteps(rings));
}

const circle = (cx: number, cy: number, r: number, parts = 8): CurveSubpath => {
  // A circle of `parts` cubics (the standard tangent-length approximation).
  const k = (4 / 3) * Math.tan(Math.PI / (2 * parts));
  const at = (angle: number, radius: number): Vec2 => ({
    x: cx + radius * Math.cos(angle),
    y: cy + radius * Math.sin(angle),
  });
  const tangent = (angle: number, sign: number): Vec2 => ({
    x: -sign * Math.sin(angle) * r * k,
    y: sign * Math.cos(angle) * r * k,
  });
  const segments = Array.from({ length: parts }, (_, i) => {
    const a0 = (2 * Math.PI * i) / parts;
    const a1 = (2 * Math.PI * (i + 1)) / parts;
    const p0 = at(a0, r);
    const p3 = i === parts - 1 ? at(0, r) : at(a1, r);
    const t0 = tangent(a0, 1);
    const t1 = tangent(a1, -1);
    return {
      kind: 'cubic' as const,
      control1: { x: p0.x + t0.x, y: p0.y + t0.y },
      control2: { x: p3.x + t1.x, y: p3.y + t1.y },
      to: p3,
    };
  });
  return { start: at(0, r), segments, closed: true };
};

describe('the crossing guard on the fitted curves (ADR-483)', () => {
  it.each<[string, CurveSubpath]>([
    ['a sliver whose cubics double back on themselves', SLIVER],
    ['spike legs that cross beside the tip', SPIKE],
    ['a leg that turns to run beside its neighbour', BESIDE_LINE],
    ['spike legs that cross in a lens half a pixel from the tip', SPIKE_LENS],
  ])('sees %s', (_name, curve) => {
    expect([...curveConflicts([ring(curve)])]).toEqual([0]);
  });

  it('sees two outlines that pass through each other between their samples', () => {
    const rings = [ring(LENS_A), ring(LENS_B)];
    // Neither is flagged on its own, and their samples do not meet.
    expect(curveConflicts([rings[0]!]).size).toBe(0);
    expect(curveConflicts([rings[1]!]).size).toBe(0);
    expect(sampleConflicts(rings).size).toBe(0);
    expect([...curveConflicts(rings)].sort()).toEqual([0, 1]);
  });

  it('leaves clean outlines alone: circles, nested rings, a near miss', () => {
    const rings = [
      ring(circle(0, 0, 10)),
      ring(circle(0, 0, 9.999)),
      ring(circle(30, 0, 5)),
      ring(circle(30, 0, 0.3, 3)),
      ring(circle(40.002, 0, 5)),
    ];
    expect(curveConflicts(rings).size).toBe(0);
  });

  it('sees a crossing between a fitted curve and a straight ring', () => {
    const square: Polyline = {
      closed: true,
      points: [
        { x: 9, y: -1 },
        { x: 12, y: -1 },
        { x: 12, y: 1 },
        { x: 9, y: 1 },
      ],
    };
    expect([...curveConflicts([ring(circle(0, 0, 10)), square])].sort()).toEqual([0, 1]);
    const apart: Polyline = {
      ...square,
      points: square.points.map((p) => ({ x: p.x + 1.01, y: p.y })),
    };
    expect(curveConflicts([ring(circle(0, 0, 10)), apart]).size).toBe(0);
  });

  it('re-tests only changed rings across rounds, with the same result as from scratch', () => {
    let state = 11;
    const next = (): number => {
      state = (Math.imul(state, 1103515245) + 12345) >>> 0;
      return state / 4294967296;
    };
    const randomRing = (): Polyline =>
      ring(circle(next() * 60, next() * 60, 1 + next() * 6, 3 + Math.floor(next() * 6)));
    const rings = Array.from({ length: 40 }, randomRing);
    const cache = new CurveContactCache();
    for (let round = 0; round < 12; round += 1) {
      const incremental = runTraceSteps(cache.conflictsSteps(rings));
      const fresh = curveConflicts(rings);
      expect([...incremental].sort((a, b) => a - b)).toEqual([...fresh].sort((a, b) => a - b));
      // Replace a few rings, as a repair round backs off a few; sometimes many.
      const replace = round % 4 === 3 ? 15 : 3;
      for (let k = 0; k < replace; k += 1) rings[Math.floor(next() * rings.length)] = randomRing();
    }
  });

  it('tests pieces exactly: shared joints, loops and near misses', () => {
    const a = { p0: { x: 0, y: 0 }, p1: { x: 1, y: 0 }, p2: { x: 2, y: 0 }, p3: { x: 3, y: 0 } };
    const b = { p0: { x: 3, y: 0 }, p1: { x: 4, y: 1 }, p2: { x: 5, y: 1 }, p3: { x: 6, y: 0 } };
    // Neighbours meet only at their joint.
    expect(piecesMeet(a, b, true)).toBe(false);
    // A neighbour that comes back across the first piece.
    const back = {
      p0: { x: 3, y: 0 },
      p1: { x: 4, y: 2 },
      p2: { x: 0, y: 2 },
      p3: { x: 1, y: -1 },
    };
    expect(piecesMeet(a, back, true)).toBe(true);
    // A cubic with a loop, and one without.
    expect(
      pieceMeetsItself({
        p0: { x: 0, y: 0 },
        p1: { x: 8, y: 4 },
        p2: { x: -4, y: 4 },
        p3: { x: 4, y: 0 },
      }),
    ).toBe(true);
    // A cusp (the curve stops and turns on itself) is not a loop.
    expect(
      pieceMeetsItself({
        p0: { x: 0, y: 0 },
        p1: { x: 4, y: 3 },
        p2: { x: 0, y: 3 },
        p3: { x: 4, y: 0 },
      }),
    ).toBe(false);
    expect(pieceMeetsItself(b)).toBe(false);
    // A miss by a thousandth of a pixel is not a meeting.
    const above = {
      p0: { x: 0, y: 0.001 },
      p1: { x: 1, y: 0.001 },
      p2: { x: 2, y: 0.001 },
      p3: { x: 3, y: 0.001 },
    };
    expect(piecesMeet(a, above, false)).toBe(false);
  });
});
