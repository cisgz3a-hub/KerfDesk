// L5-P2-1 (rolling audit v7): Design Studio bakes a closed path without its
// seam vertex. Compile cuts the closing edge, but the main canvas stroked it
// open: a chamfered rectangle showed 7 of its 8 edges, a triangle 2 of 3.
import { beforeEach, describe, expect, it } from 'vitest';
import type { Sketch } from '../../core/design';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { isVectorSceneObject, paintObjectDisplay, resolveObjectDisplay } from './object-display';
import type { ViewTransform } from './view-transform';

type Call = readonly [string, number, number];

function recordingContext(): { readonly ctx: CanvasRenderingContext2D; readonly calls: Call[] } {
  const calls: Call[] = [];
  const ctx = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'moveTo' || prop === 'lineTo')
          return (x: number, y: number) => calls.push([prop, x, y]);
        return () => undefined;
      },
      set: () => true,
    },
  ) as CanvasRenderingContext2D;
  return { ctx, calls };
}

const view: ViewTransform = { scale: 1, offsetX: 0, offsetY: 0 };

function strokedEdges(sketch: Sketch): number {
  useStore.getState().applyDesignSketch(sketch, ['output'], null);
  const { project } = useStore.getState();
  const object = project.scene.objects[0];
  if (object === undefined || !isVectorSceneObject(object)) throw new Error('No vector output');
  const layers = new Map(project.scene.layers.map((layer) => [layer.color, layer]));
  const { ctx, calls } = recordingContext();
  paintObjectDisplay(
    ctx,
    object,
    resolveObjectDisplay(object, layers, view, undefined, 'design'),
    view,
  );
  const start = calls[0];
  const end = calls[calls.length - 1];
  expect(start?.[0]).toBe('moveTo');
  expect(end?.[1]).toBeCloseTo(start?.[1] ?? NaN, 9);
  expect(end?.[2]).toBeCloseTo(start?.[2] ?? NaN, 9);
  return calls.filter(([kind]) => kind === 'lineTo').length;
}

beforeEach(resetStore);

describe('a closed Design Studio path on the main canvas', () => {
  it('strokes all three edges of a closed triangle', () => {
    const triangle: Sketch = {
      entities: [
        {
          id: 'triangle',
          kind: 'path',
          closed: true,
          points: [
            { x: 10, y: 10 },
            { x: 60, y: 10 },
            { x: 35, y: 50 },
          ],
        },
      ],
    };
    expect(strokedEdges(triangle)).toBe(3);
  });

  it('strokes all eight edges of a chamfered rectangle', () => {
    const chamfered: Sketch = {
      entities: [
        {
          id: 'chamfered',
          kind: 'path',
          closed: true,
          points: [
            { x: 20, y: 35 },
            { x: 25, y: 30 },
            { x: 55, y: 30 },
            { x: 60, y: 35 },
            { x: 60, y: 45 },
            { x: 55, y: 50 },
            { x: 25, y: 50 },
            { x: 20, y: 45 },
          ],
        },
      ],
    };
    expect(strokedEdges(chamfered)).toBe(8);
  });
});
