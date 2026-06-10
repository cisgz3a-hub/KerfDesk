import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile, type Origin } from './device-profile';
import { toMachineCoords, toSceneCoords } from './origin-transform';

function withOrigin(origin: Origin): DeviceProfile {
  return { ...DEFAULT_DEVICE_PROFILE, origin };
}

describe('toMachineCoords', () => {
  it('front-left: keeps X, flips Y so SVG top maps to bed back', () => {
    const dev = withOrigin('front-left');
    // Scene (50, 100) — 50mm right, 100mm down from SVG top.
    expect(toMachineCoords({ x: 50, y: 100 }, dev)).toEqual({
      x: 50,
      y: dev.bedHeight - 100,
    });
  });

  it('front-right: mirrors both X (bedW - X) and Y (bedH - Y)', () => {
    const dev = withOrigin('front-right');
    expect(toMachineCoords({ x: 50, y: 100 }, dev)).toEqual({
      x: dev.bedWidth - 50,
      y: dev.bedHeight - 100,
    });
  });

  it('rear-left: identity — rear origins have machine +Y matching SVG Y-down', () => {
    const dev = withOrigin('rear-left');
    expect(toMachineCoords({ x: 50, y: 100 }, dev)).toEqual({ x: 50, y: 100 });
  });

  it('rear-right: mirrors X only', () => {
    const dev = withOrigin('rear-right');
    expect(toMachineCoords({ x: 50, y: 100 }, dev)).toEqual({
      x: dev.bedWidth - 50,
      y: 100,
    });
  });

  it('center: centers X, flips Y around the bed midline', () => {
    const dev = withOrigin('center');
    // Bed center maps to (0, 0).
    expect(toMachineCoords({ x: dev.bedWidth / 2, y: dev.bedHeight / 2 }, dev)).toEqual({
      x: 0,
      y: 0,
    });
    // SVG (0, 0) — top-left of canvas — is at (-bedW/2, +bedH/2) on a
    // center-origin bed (left edge, back-of-bed in machine coords).
    expect(toMachineCoords({ x: 0, y: 0 }, dev)).toEqual({
      x: -dev.bedWidth / 2,
      y: dev.bedHeight / 2,
    });
  });
});

describe('toSceneCoords', () => {
  const ALL_ORIGINS: ReadonlyArray<Origin> = [
    'front-left',
    'front-right',
    'rear-left',
    'rear-right',
    'center',
  ];

  it('inverts toMachineCoords exactly for every origin (round trip)', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 50, y: 100 },
      { x: 399.5, y: 1 },
      { x: 123.25, y: 321.75 },
    ];
    for (const origin of ALL_ORIGINS) {
      const dev = withOrigin(origin);
      for (const p of points) {
        expect(toSceneCoords(toMachineCoords(p, dev), dev)).toEqual(p);
        expect(toMachineCoords(toSceneCoords(p, dev), dev)).toEqual(p);
      }
    }
  });

  it('center: machine origin (0, 0) maps back to the scene bed center', () => {
    const dev = withOrigin('center');
    // center is the one origin transform that is NOT its own inverse —
    // the X axis is translated, not mirrored. Pin the inverse explicitly.
    expect(toSceneCoords({ x: 0, y: 0 }, dev)).toEqual({
      x: dev.bedWidth / 2,
      y: dev.bedHeight / 2,
    });
  });
});
