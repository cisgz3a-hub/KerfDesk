import { describe, expect, it } from 'vitest';
import { DEFAULT_CNC_LAYER_SETTINGS, type Polyline } from '../scene';
import { helicalPocketPassesBySourceRegion } from './cnc-helical-pocket-passes';
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

function shifted(polyline: Polyline, xMm: number): Polyline {
  return {
    ...polyline,
    points: polyline.points.map((point) => ({ x: point.x + xMm, y: point.y })),
  };
}

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

  it('finishes every depth in source-region order when derived rings arrive reversed', () => {
    const result = helicalPocketPassesBySourceRegion(
      {
        ...DEFAULT_CNC_LAYER_SETTINGS,
        cutType: 'pocket',
        helixEntry: { maxDiameterMm: 4, minDiameterMm: 2, angleDeg: 5 },
      },
      [square, shifted(square, 40)],
      [shifted(insetSquare, 40), insetSquare],
      [-1, -2],
    );
    if (result === null) throw new Error('expected source-region helical passes');

    expect(
      result.map((pass) => {
        if (pass.kind !== 'helical-contour') throw new Error('expected a helical contour pass');
        return {
          owner: pass.start.x < 30 ? 'A' : 'B',
          startZMm: pass.startZMm,
          zMm: pass.zMm,
        };
      }),
    ).toEqual([
      { owner: 'A', startZMm: 0, zMm: -1 },
      { owner: 'A', startZMm: -1, zMm: -2 },
      { owner: 'B', startZMm: 0, zMm: -1 },
      { owner: 'B', startZMm: -1, zMm: -2 },
    ]);
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

  it('matches the helix rotation to a clockwise finish ring', () => {
    const clockwise = { ...square, points: [...square.points].reverse() };
    const result = planHelicalPocketPasses([clockwise], [-2], {
      maxDiameterMm: 10,
      minDiameterMm: 4,
      angleDeg: 5,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.passes[0]).toMatchObject({ kind: 'helical-contour', clockwise: true });
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
