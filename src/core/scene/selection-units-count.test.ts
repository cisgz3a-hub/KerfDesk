// S2-P3-3: Align and Distribute ask how many units a selection makes on every
// menu render. The count is the unit list's length, found without measuring a
// box per unit. Counted, not timed.
import { describe, expect, it, vi } from 'vitest';
import type * as HitTest from './hit-test';
import type { SceneGroup } from './scene';
import { IDENTITY_TRANSFORM, type SceneObject } from './scene-object';
import { selectionUnitCount, selectionUnits } from './selection-units';

const boxes = vi.hoisted(() => ({ calls: 0 }));
vi.mock('./hit-test', async (importOriginal) => {
  const actual = await importOriginal<typeof HitTest>();
  return {
    ...actual,
    combinedBBox: (...args: Parameters<typeof actual.combinedBBox>) => {
      boxes.calls += 1;
      return actual.combinedBBox(...args);
    },
  };
});

describe('selectionUnitCount', () => {
  it('equals the number of units for random groupings', () => {
    let seed = 7;
    const random = (n: number) => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return seed % n;
    };
    for (let trial = 0; trial < 200; trial += 1) {
      const all = Array.from({ length: 1 + random(30) }, (_, index) => box(`o${index}`));
      const groups: SceneGroup[] = Array.from({ length: random(6) }, (_, index) => ({
        id: `g${index}`,
        name: `g${index}`,
        objectIds: Array.from({ length: 1 + random(5) }, () => `o${random(all.length + 3)}`),
      }));
      const selected = all.filter(() => random(4) !== 0);
      expect(selectionUnitCount(selected, groups)).toBe(selectionUnits(selected, groups).length);
    }
  });

  it('measures no box for a selection of thousands', () => {
    const selected = Array.from({ length: 5000 }, (_, index) => box(`o${index}`));
    const groups = [{ id: 'g', name: 'g', objectIds: ['o1', 'o2', 'o3'] }];
    boxes.calls = 0;
    expect(selectionUnitCount(selected, groups)).toBe(4998);
    expect(boxes.calls).toBe(0);
    selectionUnits(selected, groups);
    // The unit list measures one box per unit.
    expect(boxes.calls).toBe(4998);
  });
});

function box(id: string): SceneObject {
  return {
    kind: 'shape',
    id,
    spec: { kind: 'rect', widthMm: 10, heightMm: 10, cornerRadiusMm: 0 },
    color: '#000000',
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    paths: [],
  };
}
