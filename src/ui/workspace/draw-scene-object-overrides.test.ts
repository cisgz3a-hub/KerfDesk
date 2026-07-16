import { describe, expect, it } from 'vitest';
import { createLayer, createProject, type Project } from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives';
import { drawScene } from './draw-scene';

function countingContext(): {
  readonly ctx: CanvasRenderingContext2D;
  readonly calls: { fill: number };
} {
  const calls = { fill: 0 };
  const ctx = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'fill') {
          return () => {
            calls.fill += 1;
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

describe('drawScene object operation overrides', () => {
  it('renders a selected-artwork fill override without changing the layer default', () => {
    const { ctx, calls } = countingContext();

    drawScene(ctx, 800, 600, objectOverrideProject(), {
      selectedId: null,
      preview: false,
      view: { zoomFactor: 1, panX: 0, panY: 0 },
    });

    expect(calls.fill).toBeGreaterThan(0);
  });
});

function objectOverrideProject(): Project {
  const project = createProject();
  const shape = createRectangle({
    id: 'selected-shape',
    color: '#000000',
    spec: { widthMm: 20, heightMm: 10, cornerRadiusMm: 0 },
  });
  return {
    ...project,
    scene: {
      layers: [createLayer({ id: '#000000', color: '#000000', mode: 'line' })],
      objects: [{ ...shape, operationOverride: { mode: 'fill' } }],
    },
  };
}
