import { describe, expect, it } from 'vitest';
import { buildOffsetLadder } from '../geometry/offset-ladder';
import type { Polyline } from '../scene';
import { THIN_DETAIL_RESOLUTION_MM, vcarveThinDetailRings } from './vcarve-thin-detail';

const DELTA_MM = 0.5;

function rect(x: number, y: number, w: number, h: number): Polyline {
  return {
    closed: true,
    points: [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ],
  };
}

function firstRingOf(contours: ReadonlyArray<Polyline>): ReadonlyArray<Polyline> {
  return buildOffsetLadder(contours, 1, () => DELTA_MM).rings[0] ?? [];
}

describe('vcarveThinDetailRings', () => {
  it('a band thinner than 2·δ (empty first ring) becomes detail rings to its centerline', () => {
    const band = [rect(0, 0, 10, 0.5)];
    const detail = vcarveThinDetailRings(band, [], DELTA_MM);
    expect(detail.offsetFailed).toBe(false);
    expect(detail.residualThin).toBe(false);
    expect(detail.rings.length).toBeGreaterThan(0);
    // Fine rings stop at the 0.25 mm half-width: insets 0.05..0.20 = 4 steps.
    expect(detail.rings.length).toBeLessThanOrEqual(Math.ceil(0.25 / THIN_DETAIL_RESOLUTION_MM));
    for (const ring of detail.rings) {
      for (const polyline of ring) {
        for (const point of polyline.points) {
          expect(point.y).toBeGreaterThanOrEqual(-1e-6);
          expect(point.y).toBeLessThanOrEqual(0.5 + 1e-6);
        }
      }
    }
  });

  it('artwork the first ring covers produces at most corner-wedge detail', () => {
    // 20 mm square: the round-grown first ring covers everything except the
    // sharp-corner wedges (a bit's disc cannot reach a mitered corner tip).
    // Those wedges are sub-δ scale: any detail ring must stop within a few
    // fine steps, and nothing may be flagged as lost.
    const wide = [rect(0, 0, 20, 20)];
    const detail = vcarveThinDetailRings(wide, firstRingOf(wide), DELTA_MM);
    expect(detail.offsetFailed).toBe(false);
    expect(detail.residualThin).toBe(false);
    expect(detail.rings.length).toBeLessThanOrEqual(3);
  });

  it('a partially-thin glyph rescues only the thin tail (the "Drive" case)', () => {
    // 6×6 body with a 6×0.5 tail: the body survives the δ ladder, the tail
    // vanishes from it. Detail rings must appear in the tail and stay inside
    // its band.
    const glyph: Polyline = {
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: 6, y: 0 },
        { x: 6, y: 2.75 },
        { x: 12, y: 2.75 },
        { x: 12, y: 3.25 },
        { x: 6, y: 3.25 },
        { x: 6, y: 6 },
        { x: 0, y: 6 },
      ],
    };
    const detail = vcarveThinDetailRings([glyph], firstRingOf([glyph]), DELTA_MM);
    expect(detail.offsetFailed).toBe(false);
    expect(detail.residualThin).toBe(false);
    const tailRings = detail.rings
      .flat()
      .filter((polyline) => polyline.points.some((point) => point.x > 6.5));
    expect(tailRings.length).toBeGreaterThan(0);
    for (const polyline of tailRings) {
      for (const point of polyline.points) {
        if (point.x <= 6.5) continue;
        expect(point.y).toBeGreaterThanOrEqual(2.75 - 1e-6);
        expect(point.y).toBeLessThanOrEqual(3.25 + 1e-6);
      }
    }
  });

  it('artwork below the fine pitch reports residualThin instead of vanishing silently', () => {
    // 0.06 mm band: even the 0.05 mm pitch cannot ring it, but at 10 mm long
    // it is real, visible artwork — the advisory must fire.
    const hairline = [rect(0, 0, 10, 0.06)];
    const detail = vcarveThinDetailRings(hairline, [], DELTA_MM);
    expect(detail.rings).toEqual([]);
    expect(detail.residualThin).toBe(true);
  });

  it('rounding-scale dust does not raise the advisory', () => {
    // 0.04 × 0.2 mm sliver (0.008 mm²) is below the residual area floor.
    const dust = [rect(0, 0, 0.2, 0.04)];
    const detail = vcarveThinDetailRings(dust, [], DELTA_MM);
    expect(detail.rings).toEqual([]);
    expect(detail.residualThin).toBe(false);
  });

  it('is deterministic: two identical runs produce deeply equal rings', () => {
    const glyph = [rect(0, 0, 10, 0.5), rect(0, 2, 10, 3)];
    const first = firstRingOf(glyph);
    const a = vcarveThinDetailRings(glyph, first, DELTA_MM);
    const b = vcarveThinDetailRings(glyph, first, DELTA_MM);
    expect(a).toEqual(b);
  });
});
