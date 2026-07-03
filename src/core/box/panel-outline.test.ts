import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { Polyline, Vec2 } from '../scene';
import type { BoxSpec } from './box-spec';
import { buildPanelClaims, type PanelClaims } from './panel-claims';
import { panelOutline } from './panel-outline';

// Inner 30³ at T=5, target 10 → every axis: 3 cells of exactly 10 mm on a
// 40 mm outer span. Small enough to assert rings verbatim.
const CUBE: BoxSpec = {
  widthMm: 30,
  depthMm: 30,
  heightMm: 30,
  dimensionMode: 'inner',
  thicknessMm: 5,
  targetFingerWidthMm: 10,
  style: 'closed',
  clearanceMm: 0,
  relief: { kind: 'none' },
  partSpacingMm: 8,
};

function outlineOf(spec: BoxSpec, panel: string): Polyline {
  const claims = buildPanelClaims(spec).find((c) => c.panel === panel);
  if (claims === undefined) throw new Error(`missing panel ${panel}`);
  return panelOutline(claims);
}

function ring(outline: Polyline): ReadonlyArray<Vec2> {
  return outline.points.slice(0, -1);
}

function shoelace(points: ReadonlyArray<Vec2>): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (a === undefined || b === undefined) continue;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

describe('panelOutline — exact rings on the 30³ cube', () => {
  it('walks the bottom panel battlement verbatim', () => {
    const outline = outlineOf(CUBE, 'bottom');
    expect(outline.closed).toBe(true);
    expect(outline.points[0]).toEqual(outline.points[outline.points.length - 1]);
    expect(ring(outline)).toEqual([
      { x: 0, y: 0 },
      { x: 15, y: 0 },
      { x: 15, y: 5 },
      { x: 25, y: 5 },
      { x: 25, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 15 },
      { x: 35, y: 15 },
      { x: 35, y: 25 },
      { x: 40, y: 25 },
      { x: 40, y: 40 },
      { x: 25, y: 40 },
      { x: 25, y: 35 },
      { x: 15, y: 35 },
      { x: 15, y: 40 },
      { x: 0, y: 40 },
      { x: 0, y: 25 },
      { x: 5, y: 25 },
      { x: 5, y: 15 },
      { x: 0, y: 15 },
    ]);
  });

  it('cuts the wall corner squares back (front panel area)', () => {
    // Face 1600 − 4 corner squares (25) − 6 unowned cells (50) = 1200.
    expect(shoelace(ring(outlineOf(CUBE, 'front')))).toBe(1200);
  });

  it('notches the open-top side wall at the rim corners only', () => {
    const points = ring(outlineOf({ ...CUBE, style: 'open-top' }, 'left'));
    const has = (x: number, y: number): boolean => points.some((p) => p.x === x && p.y === y);
    // The rim stops T short of both ends; each unclaimed corner square merges
    // with the adjacent unowned finger cell into one straight recess down to
    // the cell floor (the mating Y panel fills the whole column with its tab
    // plus the corner square).
    expect(has(5, 40)).toBe(true);
    expect(has(35, 40)).toBe(true);
    expect(has(5, 25)).toBe(true);
    expect(has(35, 25)).toBe(true);
    expect(has(5, 35)).toBe(false);
    expect(has(35, 35)).toBe(false);
    expect(has(0, 40)).toBe(false);
    expect(has(40, 40)).toBe(false);
    // Face 1600 − 6 unowned cells (6·50) − 4 corner squares (4·25).
    expect(shoelace(points)).toBe(1200);
  });

  it('keeps the open-top front wall rim straight across', () => {
    const points = ring(outlineOf({ ...CUBE, style: 'open-top' }, 'front'));
    const rim = points.filter((p) => p.y === 40).map((p) => p.x);
    expect(Math.min(...rim)).toBe(0);
    expect(Math.max(...rim)).toBe(40);
  });
});

describe('panelOutline — structural properties over fuzzed specs', () => {
  const specArb = fc
    .record({
      w: fc.double({ min: 20, max: 600, noNaN: true }),
      d: fc.double({ min: 20, max: 600, noNaN: true }),
      h: fc.double({ min: 20, max: 600, noNaN: true }),
      finger: fc.double({ min: 1.5, max: 5, noNaN: true }),
      style: fc.constantFrom<BoxSpec['style']>('closed', 'open-top'),
    })
    .chain((base) =>
      fc
        .double({
          min: 1,
          max: Math.min(25, (Math.min(base.w, base.d, base.h) - 2) / 2),
          noNaN: true,
        })
        .map(
          (t): BoxSpec => ({
            widthMm: base.w,
            depthMm: base.d,
            heightMm: base.h,
            dimensionMode: 'inner',
            thicknessMm: t,
            targetFingerWidthMm: base.finger * t,
            style: base.style,
            clearanceMm: 0,
            relief: { kind: 'none' },
            partSpacingMm: 8,
          }),
        ),
    );

  // 60 s: 100 property runs × 6 panels can exceed the 5 s default under
  // full-suite worker load (the biggest fuzzed panels carry ~800 fingers).
  it('emits simple rectilinear rings whose area matches the claims exactly', () => {
    fc.assert(
      fc.property(specArb, (spec) => {
        for (const claims of buildPanelClaims(spec)) {
          const points = ring(panelOutline(claims));
          assertRectilinearSimple(points);
          const area = shoelace(points);
          const expected = expectedArea(claims);
          expect(Math.abs(area - expected)).toBeLessThanOrEqual(1e-6 * expected);
          expect(area).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 },
    );
  }, 60000);
});

function assertRectilinearSimple(points: ReadonlyArray<Vec2>): void {
  expect(points.length).toBeGreaterThanOrEqual(4);
  const seen = new Set<string>();
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const c = points[(i + 2) % points.length];
    if (a === undefined || b === undefined || c === undefined) continue;
    seen.add(`${a.x},${a.y}`);
    const abHorizontal = a.y === b.y;
    expect(abHorizontal ? a.x !== b.x : a.x === b.x).toBe(true);
    // Consecutive segments must turn: horizontal then vertical, alternating.
    expect(b.y === c.y).toBe(!abHorizontal);
  }
  expect(seen.size).toBe(points.length);
}

// Face area minus every bite the claims dictate: unowned interior cells are
// T-deep along their side; unclaimed corners are T² squares counted once via
// the two v sides.
function expectedArea(claims: PanelClaims): number {
  let area = claims.sizeUMm * claims.sizeVMm;
  for (const side of ['vMin', 'uMax', 'vMax', 'uMin'] as const) {
    const intervals = claims.sides[side];
    for (let i = 1; i < intervals.length - 1; i += 1) {
      const cell = intervals[i];
      if (cell !== undefined && !cell.owned) {
        area -= (cell.toMm - cell.fromMm) * claims.thicknessMm;
      }
    }
  }
  for (const side of ['vMin', 'vMax'] as const) {
    const intervals = claims.sides[side];
    const first = intervals[0];
    const last = intervals[intervals.length - 1];
    if (first !== undefined && !first.owned) area -= claims.thicknessMm * claims.thicknessMm;
    if (last !== undefined && !last.owned) area -= claims.thicknessMm * claims.thicknessMm;
  }
  return area;
}
