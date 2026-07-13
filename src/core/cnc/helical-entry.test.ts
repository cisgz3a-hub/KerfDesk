import { describe, expect, it } from 'vitest';
import type { Polyline } from '../scene';
import { planHelicalPocketPasses } from './helical-entry';

const square: Polyline = {
  closed: true,
  points: [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
    { x: 20, y: 20 },
    { x: 0, y: 20 },
  ],
};

const insetSquare: Polyline = {
  closed: true,
  points: [
    { x: 4, y: 4 },
    { x: 16, y: 4 },
    { x: 16, y: 16 },
    { x: 4, y: 16 },
  ],
};

describe('planHelicalPocketPasses', () => {
  it('places a bounded tangent circle and creates a depth ladder of native helix passes', () => {
    const result = planHelicalPocketPasses([square], [-2, -4], {
      maxDiameterMm: 10,
      minDiameterMm: 4,
      angleDeg: 5,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.passes).toHaveLength(2);
    expect(result.passes[0]).toMatchObject({
      kind: 'helical-contour',
      start: { x: 10, y: 0 },
      center: { x: 10, y: 5 },
      startZMm: 0,
      zMm: -2,
      revolutions: 1,
    });
    expect(result.passes[0]?.kind === 'helical-contour' && result.passes[0].polyline[0]).toEqual({
      x: 10,
      y: 0,
    });
    expect(result.passes[1]).toMatchObject({ startZMm: -2, zMm: -4 });
  });

  it('uses a local tangent helix for every offset ring instead of reusing one center entry', () => {
    const result = planHelicalPocketPasses([square, insetSquare], [-2], {
      maxDiameterMm: 4,
      minDiameterMm: 2,
      angleDeg: 5,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.passes).toHaveLength(2);
    expect(result.passes[0]).toMatchObject({
      kind: 'helical-contour',
      start: { x: 10, y: 0 },
      center: { x: 10, y: 2 },
    });
    expect(result.passes[1]).toMatchObject({
      kind: 'helical-contour',
      start: { x: 10, y: 4 },
      center: { x: 10, y: 6 },
    });
    for (const pass of result.passes) {
      expect(pass.kind).toBe('helical-contour');
      if (pass.kind === 'helical-contour') expect(pass.polyline[0]).toEqual(pass.start);
    }
  });

  it('adds revolutions until the configured maximum ramp angle is respected', () => {
    const result = planHelicalPocketPasses([square], [-10], {
      maxDiameterMm: 4,
      minDiameterMm: 2,
      angleDeg: 2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.passes[0]).toMatchObject({ kind: 'helical-contour', revolutions: 23 });
  });

  it('refuses a minimum diameter that cannot fit the pocket', () => {
    expect(
      planHelicalPocketPasses([square], [-2], {
        maxDiameterMm: 30,
        minDiameterMm: 25,
        angleDeg: 5,
      }),
    ).toEqual({
      ok: false,
      reason: 'The configured minimum helix diameter does not fit this pocket.',
    });
  });

  it('refuses open raster pocket sweeps and invalid settings', () => {
    expect(
      planHelicalPocketPasses([{ ...square, closed: false }], [-2], {
        maxDiameterMm: 10,
        minDiameterMm: 2,
        angleDeg: 5,
      }),
    ).toMatchObject({ ok: false, reason: 'Helical entry requires closed offset-pocket rings.' });
    expect(
      planHelicalPocketPasses([square], [-2], {
        maxDiameterMm: 2,
        minDiameterMm: 4,
        angleDeg: 5,
      }),
    ).toMatchObject({ ok: false, reason: 'Helix minimum diameter exceeds its maximum diameter.' });
  });
});
