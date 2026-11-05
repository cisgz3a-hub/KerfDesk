// Perf audit S1, S2-P3-2: an object on the canvas keeps the display it
// resolved while the view only pans, or zooms within its curve tolerance
// bucket, instead of resolving every path again on every frame.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRectangle } from '../../core/shapes/primitives';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { createDisplayPolylineCache, type DisplayPolylineCache } from './display-polylines';
import { drawScene } from './draw-scene';
import type * as ObjectDisplayModule from './object-display';
import type { ViewState } from './view-transform';

const resolves = vi.hoisted(() => ({ count: 0 }));

vi.mock('./object-display', async (importOriginal) => {
  const actual = await importOriginal<typeof ObjectDisplayModule>();
  return {
    ...actual,
    resolveObjectDisplay: (...args: Parameters<typeof actual.resolveObjectDisplay>) => {
      resolves.count += 1;
      return actual.resolveObjectDisplay(...args);
    },
  };
});

const LINE = '#ff0000';
let cache: DisplayPolylineCache;

beforeEach(() => {
  vi.stubGlobal('Path2D', undefined);
  cache = createDisplayPolylineCache();
  resolves.count = 0;
});
afterEach(() => vi.unstubAllGlobals());

function scene(count: number): Project {
  const objects: SceneObject[] = Array.from({ length: count }, (_, index) =>
    createRectangle({
      id: `r${index}`,
      color: LINE,
      spec: { widthMm: 8, heightMm: 6, cornerRadiusMm: 0 },
      transform: {
        ...IDENTITY_TRANSFORM,
        x: 10 + (index % 10) * 10,
        y: 10 + Math.floor(index / 10) * 8,
      },
    }),
  );
  return {
    ...createProject(),
    scene: { layers: [createLayer({ id: LINE, color: LINE, mode: 'line' })], objects },
  };
}

function draw(current: Project, view: ViewState): void {
  const canvas = { width: 800, height: 600 };
  const ctx = new Proxy(
    {},
    {
      get: (_target, prop) =>
        prop === 'canvas'
          ? canvas
          : prop === 'measureText'
            ? () => ({ width: 0 })
            : () => undefined,
      set: () => true,
    },
  ) as CanvasRenderingContext2D;
  drawScene(ctx, 800, 600, current, {
    selectedId: null,
    preview: false,
    view,
    displayPolylineCache: cache,
  });
}

describe('on-canvas object displays (perf audit S2-P3-2)', () => {
  it('resolve once while the view pans, and again when the operations change', () => {
    const current = scene(40);
    draw(current, { zoomFactor: 1, panX: 0, panY: 0 });
    const first = resolves.count;
    expect(first).toBeGreaterThan(0);
    for (let frame = 1; frame <= 20; frame += 1) {
      draw(current, { zoomFactor: 1, panX: frame * 3, panY: -frame * 2 });
    }
    expect(resolves.count).toBe(first);
    const recoloured = {
      ...current,
      scene: { ...current.scene, layers: [createLayer({ id: LINE, color: LINE, mode: 'fill' })] },
    };
    draw(recoloured, { zoomFactor: 1, panX: 60, panY: -40 });
    expect(resolves.count).toBe(2 * first);
  });
});
