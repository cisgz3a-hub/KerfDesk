import { expect, it } from 'vitest';
import { copyAlongPathCount, copyAlongPathLayout, type CopyAlongPathSpec } from './copy-along-path';
import { pathWalk } from './path-walk';

const source = { minX: -10, minY: -1, maxX: 10, maxY: 1 };
const spec: CopyAlongPathSpec = {
  mode: 'gap',
  count: 5,
  spacingMm: 2,
  startOffsetMm: 0,
  endOffsetMm: 0,
  rotateCopies: false,
};

it.each([undefined, 100])(
  'keeps the projected upright gap after discontinuous guide bends at end scale %s',
  (endScalePercent) => {
    const walk = pathWalk({
      closed: false,
      points: [
        { x: 0, y: 0 },
        { x: 0, y: 1 },
        { x: 9, y: 1 },
        { x: 9, y: 101 },
      ],
    });
    if (walk === null) throw new Error('Expected a guide');
    const guide = { walk, closed: false };
    const request = { ...spec, ...(endScalePercent === undefined ? {} : { endScalePercent }) };
    const result = copyAlongPathLayout(guide, source, request, 100);
    if (result.kind !== 'placed') throw new Error(result.kind);
    // Independently recover arc distance and upright extent at each centre.
    const samples = result.placements.map((placement) => ({
      distance: placement.dx < 9 ? (placement.dy === 0 ? 0 : 1 + placement.dx) : 9 + placement.dy,
      extent: placement.dx < 9 && placement.dy === 1 ? 20 : 2,
    }));
    expect(samples.length).toBeGreaterThan(2);
    for (let index = 1; index < samples.length; index += 1) {
      const before = samples[index - 1]!;
      const after = samples[index]!;
      expect(
        after.distance - before.distance - (before.extent + after.extent) / 2,
      ).toBeGreaterThanOrEqual(2 - 1e-6);
    }
    expect(copyAlongPathCount(guide, source, request, 100)).toMatchObject({
      kind: 'counted',
      count: result.placements.length,
    });
  },
);
