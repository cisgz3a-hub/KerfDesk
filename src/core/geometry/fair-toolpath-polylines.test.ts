import { describe, expect, it } from 'vitest';
import { polylineDeviationBounds } from '../../__fixtures__/polyline-deviation-bounds';
import type { Polyline, Vec2 } from '../scene';
import { fairToolpathPolylines } from './fair-toolpath-polylines';

const MM_PER_PX = 0.1; // the 254-DPI import default
const ENLARGED_MM_PER_PX = 1000;
const DEVIATION_ORACLE_ERROR_MM = 0.005;
const FLOAT_TOLERANCE_MM = 1e-6;
const TINY_RING_SIDE_PX = 0.01;
const OPTIONS = {
  mmPerPx: MM_PER_PX,
  minSegmentMm: 0.4,
  maxDeviationMm: 0.05,
  cornerAngleDeg: 60,
};
const COARSE_POLYLINE: Polyline = {
  points: [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 20, y: 0 },
    { x: 30, y: 0 },
  ],
  closed: false,
};

function pointsInMm(points: ReadonlyArray<Vec2>, mmPerPx: number): Vec2[] {
  return points.map((point) => ({ x: point.x * mmPerPx, y: point.y * mmPerPx }));
}

// Deterministic jitter in [-amp, amp] without any PRNG state.
function jitter(i: number, amp: number): number {
  const h = Math.sin(i * 12.9898) * 43758.5453;
  return (h - Math.floor(h) - 0.5) * 2 * amp;
}

// A 200px (20 mm) jittered square ring: four drawn corners joined by
// nominally straight sides sampled at ~1px pitch with +-0.45px lateral noise.
function jitteredSquare(): Polyline {
  const points: Vec2[] = [];
  const side = 200;
  const perSide = 200;
  let i = 0;
  const push = (x: number, y: number): number => points.push({ x, y });
  for (let k = 0; k < perSide; k += 1, i += 1) push((k / perSide) * side, jitter(i, 0.45));
  for (let k = 0; k < perSide; k += 1, i += 1) push(side + jitter(i, 0.45), (k / perSide) * side);
  for (let k = 0; k < perSide; k += 1, i += 1)
    push(side - (k / perSide) * side, side + jitter(i, 0.45));
  for (let k = 0; k < perSide; k += 1, i += 1) push(jitter(i, 0.45), side - (k / perSide) * side);
  const first = points[0];
  if (first === undefined) throw new Error('expected a jittered square start point');
  points.push({ ...first });
  return { points, closed: true };
}

describe('fairToolpathPolylines', () => {
  it('pins the four drawn corners of a jittered square and flattens its sides', () => {
    const source = jitteredSquare();
    const [faired] = fairToolpathPolylines([source], OPTIONS);
    if (faired === undefined) throw new Error('expected one faired square');
    const points = faired.points;
    // Every true corner survives within the jitter envelope.
    for (const corner of [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 200 },
      { x: 0, y: 200 },
    ]) {
      const nearest = Math.min(...points.map((p) => Math.hypot(p.x - corner.x, p.y - corner.y)));
      expect(nearest).toBeLessThanOrEqual(0.7);
    }
    // Sides are flat again: every vertex on the bottom run sits within the
    // deviation budget of y = 0 (jitter was +-0.45px, clamp adds 0.5px).
    const bottom = points.filter((p) => p.x > 10 && p.x < 190 && Math.abs(p.y) < 5);
    expect(bottom.length).toBeGreaterThan(10);
    for (const p of bottom) {
      expect(Math.abs(p.y)).toBeLessThanOrEqual(0.5);
    }
    // The chord target yields when simplification conflicts with the boundary
    // budget, while the dense source still loses redundant points.
    const deviation = polylineDeviationBounds(
      pointsInMm(source.points, MM_PER_PX),
      pointsInMm(points, MM_PER_PX),
      DEVIATION_ORACLE_ERROR_MM,
    );
    expect(deviation.upperBound).toBeLessThanOrEqual(
      OPTIONS.maxDeviationMm + DEVIATION_ORACLE_ERROR_MM + FLOAT_TOLERANCE_MM,
    );
    expect(points.length).toBeLessThan(source.points.length);
  });

  it('keeps open-chain endpoints exact', () => {
    const points: Vec2[] = [];
    for (let i = 0; i <= 300; i += 1) points.push({ x: i, y: jitter(i, 0.45) });
    const [faired] = fairToolpathPolylines([{ points, closed: false }], OPTIONS);
    if (faired === undefined) throw new Error('expected one faired open chain');
    const out = faired.points;
    expect(out[0]).toEqual(points[0]);
    expect(out[out.length - 1]).toEqual(points[points.length - 1]);
    expect(faired.closed).toBe(false);
  });

  it('never densifies a chain whose source chords already exceed the floor', () => {
    const [faired] = fairToolpathPolylines([COARSE_POLYLINE], {
      ...OPTIONS,
      mmPerPx: ENLARGED_MM_PER_PX,
    });
    if (faired === undefined) throw new Error('expected one faired chain');

    expect(faired.points.length).toBeLessThanOrEqual(COARSE_POLYLINE.points.length);
  });

  it('bounds the cyclic corner window for a sub-pixel closed ring', () => {
    const points: Vec2[] = [
      { x: 0, y: 0 },
      { x: TINY_RING_SIDE_PX, y: 0 },
      { x: TINY_RING_SIDE_PX, y: TINY_RING_SIDE_PX },
      { x: 0, y: TINY_RING_SIDE_PX },
      { x: 0, y: 0 },
    ];
    const [faired] = fairToolpathPolylines([{ points, closed: true }], OPTIONS);
    if (faired === undefined) throw new Error('expected one tiny faired ring');

    expect(faired.closed).toBe(true);
    expect(faired.points.length).toBeGreaterThan(1);
    expect(
      faired.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)),
    ).toBe(true);
  });

  it('lets nearby corners undershoot the segment floor rather than dropping them', () => {
    // A 2px-wide (0.2 mm) notch: two 90deg corners closer than the 4px floor.
    const points: Vec2[] = [];
    for (let x = 0; x <= 100; x += 1) points.push({ x, y: 0 });
    points.push({ x: 100, y: 30 }, { x: 102, y: 30 }, { x: 102, y: 0 });
    for (let x = 103; x <= 200; x += 1) points.push({ x, y: 0 });
    const [faired] = fairToolpathPolylines([{ points, closed: false }], OPTIONS);
    if (faired === undefined) throw new Error('expected one faired notched chain');
    const out = faired.points;
    for (const corner of [
      { x: 100, y: 30 },
      { x: 102, y: 30 },
    ]) {
      const nearest = Math.min(...out.map((p) => Math.hypot(p.x - corner.x, p.y - corner.y)));
      expect(nearest).toBeLessThanOrEqual(1e-6);
    }
  });

  it('returns input unchanged when the scale is unusable', () => {
    const polyline = jitteredSquare();
    for (const mmPerPx of [0, -1, Number.NaN]) {
      const result = fairToolpathPolylines([polyline], { ...OPTIONS, mmPerPx });
      expect(result[0]).toBe(polyline);
    }
  });

  it('leaves tiny polylines alone', () => {
    const tiny: Polyline = {
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
      ],
      closed: false,
    };
    expect(fairToolpathPolylines([tiny], OPTIONS)[0]).toBe(tiny);
  });
});
