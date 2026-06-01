import { describe, expect, it } from 'vitest';

import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type TracedImage,
} from '../../core/scene';
import { drawScene } from './draw-scene';

function countingContext(): {
  readonly ctx: CanvasRenderingContext2D;
  readonly calls: { lineTo: number; fillText: string[] };
} {
  const calls = { lineTo: 0, fillText: [] as string[] };
  const ctx = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'lineTo') {
          return () => {
            calls.lineTo += 1;
          };
        }
        if (prop === 'fillText') {
          return (text: string) => {
            calls.fillText.push(text);
          };
        }
        if (prop === 'measureText') return () => ({ width: 280 });
        return () => undefined;
      },
      set() {
        return true;
      },
    },
  ) as CanvasRenderingContext2D;
  return { ctx, calls };
}

function tracedLineProject(segmentCount: number): Project {
  const points = Array.from({ length: segmentCount + 1 }, (_, x) => ({ x, y: 0 }));
  const traced: TracedImage = {
    kind: 'traced-image',
    id: 'trace-1',
    source: 'trace.png',
    traceMode: 'centerline',
    bounds: { minX: 0, minY: 0, maxX: segmentCount, maxY: 0 },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: '#000000', polylines: [{ closed: false, points }] }],
  };
  const project = createProject();
  return {
    ...project,
    scene: {
      layers: [createLayer({ id: '#000000', color: '#000000', mode: 'line' })],
      objects: [traced],
    },
  };
}

describe('drawScene large vector traces', () => {
  it('samples oversized traces instead of sending every segment to Canvas2D', () => {
    const { ctx, calls } = countingContext();

    drawScene(ctx, 800, 600, tracedLineProject(30_000), {
      selectedId: null,
      preview: false,
      view: { zoomFactor: 1, panX: 0, panY: 0 },
    });

    expect(calls.lineTo).toBeLessThan(12_000);
    expect(calls.fillText).toContain('Large scene - display simplified for performance');
  });
});
