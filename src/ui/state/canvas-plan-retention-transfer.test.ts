import { describe, expect, it } from 'vitest';
import {
  createProject,
  DEFAULT_OUTPUT_SCOPE,
  IDENTITY_TRANSFORM,
  type Project,
} from '../../core/scene';
import {
  packProjectMessage,
  unpackProjectMessage,
  PACK_MIN_POINTS,
} from '../packed-project-transfer';
import { canvasPlanRetentionKey } from './canvas-motion-plan';

const placement = { startFrom: 'absolute' as const, anchor: 'front-left' as const };

function denseProject(): Project {
  return {
    ...createProject(),
    scene: {
      layers: [],
      objects: [
        {
          kind: 'imported-svg',
          id: 'trace',
          source: 'trace.svg',
          transform: IDENTITY_TRANSFORM,
          bounds: { minX: 0, minY: 0, maxX: 20, maxY: 10 },
          paths: [
            {
              color: '#000000',
              curves: [
                {
                  closed: false,
                  segments: [{ to: { y: 10, x: 20 }, kind: 'line' }],
                  start: { y: 0, x: 0 },
                },
              ],
              polylines: [
                {
                  closed: false,
                  points: Array.from({ length: PACK_MIN_POINTS + 1 }, (_, i) => ({
                    y: i % 10,
                    x: i / 100,
                  })),
                },
              ],
              fillRule: 'evenodd',
            },
          ],
        },
      ],
    },
  };
}

describe('retained execution identity across packed geometry', () => {
  it('keeps identity when the worker reconstructs the same values in a different property order', () => {
    const original = denseProject();
    const packed = packProjectMessage(original);
    const received = unpackProjectMessage(
      structuredClone(packed.message, { transfer: packed.transfer }),
    );
    expect(received).toEqual(original);
    expect(JSON.stringify(received.scene)).not.toBe(JSON.stringify(original.scene));
    expect(canvasPlanRetentionKey(received, DEFAULT_OUTPUT_SCOPE, placement)).toBe(
      canvasPlanRetentionKey(original, DEFAULT_OUTPUT_SCOPE, placement),
    );
  });

  it('still invalidates a changed point, segment, ordering, or placement after transport', () => {
    const original = denseProject();
    const packed = packProjectMessage(original);
    const received = unpackProjectMessage(
      structuredClone(packed.message, { transfer: packed.transfer }),
    );
    const key = canvasPlanRetentionKey(original, DEFAULT_OUTPUT_SCOPE, placement);
    for (const mutation of ['point', 'segment', 'order'] as const) {
      const changed = JSON.parse(JSON.stringify(received)) as Project;
      const object = changed.scene.objects[0];
      if (object?.kind !== 'imported-svg') throw new Error('Expected imported geometry');
      const path = object.paths[0]!;
      if (mutation === 'point') Object.assign(path.polylines[0]!.points[0]!, { x: 1 });
      if (mutation === 'segment') Object.assign(path.curves![0]!.segments[0]!.to, { x: 21 });
      if (mutation === 'order') (path.polylines[0]!.points as unknown[]).reverse();
      expect(canvasPlanRetentionKey(changed, DEFAULT_OUTPUT_SCOPE, placement)).not.toBe(key);
    }
    expect(
      canvasPlanRetentionKey(received, DEFAULT_OUTPUT_SCOPE, { ...placement, anchor: 'center' }),
    ).not.toBe(key);
  });
});
