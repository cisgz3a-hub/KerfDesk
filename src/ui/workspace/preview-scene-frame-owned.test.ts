import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../../core/devices';
import type { Toolpath, ToolpathStep } from '../../core/job';
import { mapOwnedToolpathToScene, mapToolpathToScene } from './preview-scene-frame';

const origins: DeviceProfile['origin'][] = [
  'front-left',
  'front-right',
  'rear-left',
  'rear-right',
  'center',
];

describe('owned scene mapping', () => {
  it.each(origins)('matches pure mapping without mutating shared geometry (%s)', (origin) => {
    for (const offset of [
      { x: 0, y: -0 },
      { x: -10.0625, y: 90.125 },
    ]) {
      const device = { ...DEFAULT_DEVICE_PROFILE, origin, bedWidth: 301.25, bedHeight: 202.5 };
      const route = aliasedRoute();
      const originalSteps = [...route.steps];
      const before = structuredClone(route);
      const expected = mapToolpathToScene(route, offset, device);
      const array = route.steps;

      const mapped = mapOwnedToolpathToScene(route, offset, device);

      expect(mapped).toStrictEqual(expected);
      expect(mapped.steps).toBe(array);
      expect(originalSteps).toStrictEqual(before.steps);
      mapped.steps.forEach((step, index) => {
        expect(step).not.toBe(originalSteps[index]);
      });
      const mappedCut = mapped.steps[1];
      const originalCut = originalSteps[1];
      if (mappedCut?.kind !== 'cut' || originalCut?.kind !== 'cut') throw new Error('missing cut');
      expect(mappedCut.polyline).not.toBe(originalCut.polyline);
      expect(mappedCut.polyline[0]).not.toBe(originalCut.polyline[0]);
      expect(mappedCut.source).toBe(originalCut.source);
      expect(mappedCut.zs).toBe(originalCut.zs);
      expect(mappedCut.z).toBe(originalCut.z);
      expect(mapped.steps[1]).not.toBe(mapped.steps[3]);
    }
  });

  it('preserves negative zero, empty routes and existing optional-field presence', () => {
    const device = { ...DEFAULT_DEVICE_PROFILE, origin: 'rear-left' as const };
    const steps: ToolpathStep[] = [
      { kind: 'travel', from: { x: -0, y: -0 }, to: { x: 0, y: 0 }, length: -0 },
    ];
    const result = mapOwnedToolpathToScene({ steps, totalLength: -0 }, { x: 0, y: 0 }, device);
    const first = result.steps[0];
    if (first?.kind !== 'travel') throw new Error('missing travel');
    expect(Object.is(first.from.x, -0)).toBe(true);
    expect(Object.is(first.from.y, -0)).toBe(true);
    expect(Object.is(first.length, -0)).toBe(true);
    expect(Object.is(result.totalLength, -0)).toBe(true);
    expect(Object.hasOwn(first, 'motion')).toBe(false);
    expect(Object.hasOwn(first, 'z')).toBe(false);
    const empty = { steps: [], totalLength: 0 };
    expect(mapOwnedToolpathToScene(empty, { x: 1, y: 2 }, device)).toStrictEqual(empty);
  });
});

function aliasedRoute(): Toolpath {
  const from = Object.freeze({ x: -0, y: 23.0625 });
  const to = Object.freeze({ x: -7.125, y: 2.5 });
  const z = Object.freeze({ from: -0.25, to: -1.5 });
  const source = Object.freeze({
    kind: 'raster' as const,
    objectId: 'image',
    source: 'image.png',
    passIndex: 2,
    rowIndex: 5,
    spanIndex: 7,
    pixelStartX: 9,
    pixelEndX: 11,
  });
  const cut: ToolpathStep = Object.freeze({
    kind: 'cut',
    color: '#123456',
    length: 17.25,
    polyline: Object.freeze([from, to, from]),
    source,
    z,
    zs: Object.freeze([-0.25, -1.5, -0.25]),
    groupId: 'group',
    toolId: 'tool',
    passIndex: 2,
  });
  return {
    steps: [
      Object.freeze({ kind: 'travel', from, to, length: 4.5, motion: 'feed', z }),
      cut,
      Object.freeze({
        kind: 'plunge',
        at: from,
        fromZ: 3,
        toZ: -0.25,
        length: 3.25,
        toolId: 'tool',
      }),
      cut,
    ],
    totalLength: 42.25,
  };
}
