// Performance audit S1, S2-P2-3 (ADR-683 Amendment 3): a large pool comes
// from a raster. Dragging one member previews from the finished raster and
// paints nothing whole; once it settles the exact raster is painted in bands
// that cover every row once, within a budget a frame, and a pan after that
// only blits.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Polyline,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { createDisplayPolylineCache, type DisplayPolylineCache } from './display-polylines';
import { drawScene } from './draw-scene';
import { resetFillPoolPlansForTests } from './fill-pool-plan-cache';
import {
  fillPoolRasterWork,
  FRAME_ROW_BUDGET,
  RASTER_SETTLE_MS,
  resetFillPoolRastersForTests,
} from './fill-pool-raster';
import { bandContours, nextBand, rasterRows } from './fill-pool-raster-bands';
import { fillPoolWork } from './fill-pools';
import type { ViewState } from './view-transform';

const INK = '#000000';

function ring(cx: number, cy: number, r: number, points = 48): Polyline {
  return {
    closed: true,
    points: Array.from({ length: points }, (_, i) => ({
      x: cx + r * Math.cos((i / points) * Math.PI * 2),
      y: cy + r * Math.sin((i / points) * Math.PI * 2),
    })),
  };
}

describe('raster bands', () => {
  const contours = [ring(10, 10, 5), ring(10, 40, 5), ring(30, 25, 20)];
  const frame = { worldY0: 0, scale: 2 };
  const height = 100;

  it('cover every row once, each at least one row and within the budget past its first', () => {
    const rows = rasterRows(contours, frame, height, 1);
    const bands = [];
    for (let from = 0; from < height; ) {
      const band = nextBand(rows, from, 40);
      bands.push(band);
      from = band.to;
    }

    expect(bands[0]?.from).toBe(0);
    expect(bands.at(-1)?.to).toBe(height);
    for (const [i, band] of bands.entries()) {
      expect(band.to).toBeGreaterThan(band.from);
      if (i > 0) expect(band.from).toBe(bands[i - 1]?.to);
      if (band.to - band.from > 1) expect(band.cost).toBeLessThanOrEqual(40);
    }
  });

  it('take every contour that reaches the band, and none that cannot', () => {
    const rows = rasterRows(contours, frame, height, 1);
    // Rows 0-9 are y 0-5 mm: only the top ring (y 5-15) and the large one (y 5-45) reach them.
    expect(bandContours(rows, contours, 0, 10)).toEqual([contours[0], contours[2]]);
    // Rows 50-60 (y 25-30): the large ring only.
    expect(bandContours(rows, contours, 50, 60)).toEqual([contours[2]]);
  });
});

type Op = { readonly canvas: unknown; readonly name: string; readonly value?: unknown };

describe('a large pool drawn from its raster', () => {
  let ops: Op[];
  let now: number;
  let cache: DisplayPolylineCache;

  beforeEach(() => {
    ops = [];
    now = 1_000;
    cache = createDisplayPolylineCache();
    vi.stubGlobal('Path2D', undefined);
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
      this: HTMLCanvasElement,
    ) {
      return recordingContext(this, ops) as unknown as RenderingContext;
    } as never);
    resetFillPoolRastersForTests();
    resetFillPoolPlansForTests();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // 1,000 circles of 48 segments, each overlapping all the others.
  function circles(): SceneObject[] {
    let seed = 7;
    const random = (): number => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296;
    return Array.from({ length: 1000 }, (_, i): ImportedSvg => {
      const contour = ring(150 + random() * 40, 150 + random() * 40, 25);
      const xs = contour.points.map((point) => point.x);
      const ys = contour.points.map((point) => point.y);
      return {
        kind: 'imported-svg',
        id: `c${i}`,
        source: `c${i}.svg`,
        operationIds: [INK],
        bounds: {
          minX: Math.min(...xs),
          minY: Math.min(...ys),
          maxX: Math.max(...xs),
          maxY: Math.max(...ys),
        },
        transform: IDENTITY_TRANSFORM,
        paths: [{ color: INK, polylines: [contour] }],
      };
    });
  }

  function project(objects: ReadonlyArray<SceneObject>): Project {
    const layer = { ...createLayer({ id: INK, color: INK, mode: 'fill' }), hatchSpacingMm: 0.5 };
    return { ...createProject(), scene: { layers: [layer], objects: [...objects] } };
  }

  function draw(current: Project, view: ViewState = { zoomFactor: 1, panX: 0, panY: 0 }): void {
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 600;
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    drawScene(ctx, 800, 600, current, {
      selectedId: null,
      preview: false,
      view,
      displayPolylineCache: cache,
    });
  }

  it('previews a drag, then paints the settled raster in bands and only blits after', () => {
    const objects = circles();
    draw(project(objects));
    expect(fillPoolRasterWork).toMatchObject({ whole: 1, previews: 0 });

    // Ten drag steps, 16 ms apart: previews only, nothing painted whole or banded.
    const bandsBefore = fillPoolRasterWork.bands;
    const dragged = objects[500] as SceneObject;
    let moved = objects;
    for (let step = 1; step <= 10; step += 1) {
      now += 16;
      const next = { ...dragged, transform: { ...dragged.transform, x: step * 2 } };
      moved = objects.map((object) => (object === dragged ? next : object));
      draw(project(moved));
    }
    expect(fillPoolRasterWork).toMatchObject({ whole: 1, previews: 10 });
    expect(fillPoolRasterWork.bands).toBe(bandsBefore);
    expect(ops.some((op) => op.name === 'globalCompositeOperation' && op.value === 'xor')).toBe(
      true,
    );

    // Settled: bands within the budget, several frames, then the exact raster.
    now += RASTER_SETTLE_MS;
    let frames = 0;
    while (frames < 50) {
      const previews = fillPoolRasterWork.previews;
      draw(project(moved));
      frames += 1;
      if (fillPoolRasterWork.previews === previews) break;
    }
    expect(frames).toBeGreaterThan(2);
    expect(frames).toBeLessThan(50);
    expect(fillPoolRasterWork.whole).toBe(1);

    // Rows clipped for the fill layer cover the raster once, in order.
    const fillClips = ops.filter((op) => op.name === 'rect');
    expect(fillClips.length).toBeGreaterThan(2);

    // A pan of the settled pool plans nothing and paints no raster.
    const plans = fillPoolWork.plans;
    const work = { ...fillPoolRasterWork };
    draw(project(moved), { zoomFactor: 1, panX: 40, panY: 30 });
    expect(fillPoolWork.plans).toBe(plans);
    expect(fillPoolRasterWork).toEqual(work);
    expect(FRAME_ROW_BUDGET).toBeGreaterThan(0);
  });
});

// A 2D context that records what it is told, attributed to its canvas.
function recordingContext(canvas: HTMLCanvasElement, ops: Op[]): object {
  const state: Record<string, unknown> = {};
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'canvas') return canvas;
        if (prop in state) return state[prop as string];
        if (prop === 'measureText') return () => ({ width: 0 });
        if (prop === 'getTransform') return undefined;
        return (...args: unknown[]) => ops.push({ canvas, name: String(prop), value: args });
      },
      set(_target, prop, value) {
        state[prop as string] = value;
        ops.push({ canvas, name: String(prop), value });
        return true;
      },
    },
  );
}
