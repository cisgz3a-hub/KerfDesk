// Performance audit S1, S2-P2-3 and S2-P2-4 (ADR-683 Amendment 3). Count
// guards, not timings: a pan or zoom plans the Fill pools no more, a drag inside
// a dense cluster does not sweep every pair of its members again, plates and
// their windows paint as one fill and one stroke, and a circle dragged into a
// corner of a dense cluster's box does not split that pool under a clip.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEllipse, createRectangle } from '../../core/shapes/primitives';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Layer,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { canvasTheme } from '../theme/canvas-theme';
import { createDisplayPolylineCache, type DisplayPolylineCache } from './display-polylines';
import { drawScene } from './draw-scene';
import { resetFillPoolPlansForTests } from './fill-pool-plan-cache';
import { fillPoolWork } from './fill-pools';
import type { ViewState } from './view-transform';

const INK = '#000000';
const LINE = '#ff0000';

type Recorded = { fills: number; strokes: number; clips: number; clippedSegments: number };

let cache: DisplayPolylineCache;

beforeEach(() => {
  vi.stubGlobal('Path2D', undefined);
  resetFillPoolPlansForTests();
  cache = createDisplayPolylineCache();
});
afterEach(() => vi.unstubAllGlobals());

function fillLayer(): Layer {
  return { ...createLayer({ id: INK, color: INK, mode: 'fill' }), hatchSpacingMm: 0.5 };
}

function project(objects: ReadonlyArray<SceneObject>, layers = [fillLayer()]): Project {
  return { ...createProject(), scene: { layers, objects: [...objects] } };
}

function rect(id: string, x: number, y: number, w: number, h: number, color = INK): SceneObject {
  return createRectangle({
    id,
    color,
    spec: { widthMm: w, heightMm: h, cornerRadiusMm: 0 },
    transform: { ...IDENTITY_TRANSFORM, x, y },
  });
}

function disc(id: string, x: number, y: number, diameter: number): SceneObject {
  return createEllipse({
    id,
    color: INK,
    spec: { widthMm: diameter, heightMm: diameter },
    transform: { ...IDENTITY_TRANSFORM, x, y },
  });
}

// A sheet of plates, then a window centred on each (R5-P3-1's order).
function platesThenWindows(count: number): SceneObject[] {
  const plates: SceneObject[] = [];
  const windows: SceneObject[] = [];
  const side = Math.ceil(Math.sqrt(count));
  for (let i = 0; i < count; i += 1) {
    const x = 10 + (i % side) * 12;
    const y = 10 + Math.floor(i / side) * 9;
    plates.push(rect(`plate-${i}`, x, y, 10, 7));
    windows.push(rect(`window-${i}`, x + 3, y + 2, 4, 3));
  }
  return [...plates, ...windows];
}

/** Draw once on a recording 800 x 600 context; counts what reaches the canvas in ink. */
function draw(current: Project, view: ViewState = { zoomFactor: 1, panX: 0, panY: 0 }): Recorded {
  const recorded: Recorded = { fills: 0, strokes: 0, clips: 0, clippedSegments: 0 };
  let style: unknown = null;
  let segments = 0;
  const calls: Record<string, (...args: never[]) => unknown> = {
    measureText: () => ({ width: 0 }),
    beginPath: () => (segments = 0),
    lineTo: () => (segments += 1),
    clip: () => {
      recorded.clips += 1;
      recorded.clippedSegments += segments;
    },
    fill: () => {
      if (style === canvasTheme.artworkInk) recorded.fills += 1;
    },
    stroke: () => {
      if (style === canvasTheme.artworkInk) recorded.strokes += 1;
    },
  };
  const canvas = { width: 800, height: 600 };
  const ctx = new Proxy(
    {},
    {
      get: (_target, prop) =>
        prop === 'canvas' ? canvas : (calls[prop as string] ?? (() => undefined)),
      set(_target, prop, value) {
        if (prop === 'fillStyle' || prop === 'strokeStyle') style = value;
        return true;
      },
    },
  ) as CanvasRenderingContext2D;
  drawScene(ctx, 800, 600, current, {
    selectedId: null,
    preview: false,
    view,
    displayPolylineCache: cache,
  });
  return recorded;
}

describe('the pool plan is kept between frames (S2-P2-4)', () => {
  it('plans the pools once, however far a pan or zoom goes, objects crossing the edge too', () => {
    const scene = project(platesThenWindows(400));
    draw(scene);
    const plans = fillPoolWork.plans;

    // Panning moves plates across the canvas edge; zooming in hides most of them.
    for (let frame = 1; frame <= 30; frame += 1) {
      draw(scene, { zoomFactor: 1, panX: frame * 25, panY: -frame * 15 });
    }
    draw(scene, { zoomFactor: 1.2, panX: 0, panY: 0 });
    draw(scene, { zoomFactor: 1.3, panX: 0, panY: 0 });

    expect(fillPoolWork.plans - plans).toBe(0);
  });

  it('plans again when what the pools burn changes', () => {
    const scene = project(platesThenWindows(20));
    draw(scene);
    const plans = fillPoolWork.plans;

    const [first, ...rest] = scene.scene.objects as [SceneObject, ...SceneObject[]];
    const moved = { ...first, transform: { ...first.transform, x: 300 } };
    draw({ ...scene, scene: { ...scene.scene, objects: [moved, ...rest] } });
    const lineLayer = { ...createLayer({ id: INK, color: INK, mode: 'line' }) };
    draw({ ...scene, scene: { ...scene.scene, layers: [lineLayer] } });

    expect(fillPoolWork.plans - plans).toBe(2);
  });

  it('paints plates and their windows as one fill and one outline, not one each', () => {
    const recorded = draw(project(platesThenWindows(400)));

    expect(recorded.fills).toBe(1);
    expect(recorded.strokes).toBe(1);
  });

  it('keeps a pool apart from the queue where something else is drawn between', () => {
    // A red Line square drawn between the two pools: each pool is painted on its own.
    const objects = [
      rect('a', 10, 10, 10, 7),
      rect('a-window', 13, 12, 4, 3),
      rect('line', 40, 40, 5, 5, LINE),
      rect('b', 60, 10, 10, 7),
      rect('b-window', 63, 12, 4, 3),
    ];
    const layers = [fillLayer(), createLayer({ id: LINE, color: LINE, mode: 'line' })];
    const recorded = draw(project(objects, layers));

    expect(recorded.fills).toBe(2);
  });
});

describe('a drag inside a dense cluster (S2-P2-3)', () => {
  // Every circle overlaps every other (N6-P3-3's scene, smaller).
  function cluster(count: number): SceneObject[] {
    let seed = 12345;
    const random = (): number => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296;
    return Array.from({ length: count }, (_, i) =>
      disc(`c${i}`, 100 + random() * 40, 100 + random() * 40, 50),
    );
  }

  it('sweeps the cluster once, then joins only the dragged member on each step', () => {
    const objects = cluster(300);
    draw(project(objects));
    const sweeps = fillPoolWork.sweeps;
    const plans = fillPoolWork.plans;

    const dragged = objects[150] as SceneObject;
    for (let step = 1; step <= 10; step += 1) {
      const moved = {
        ...dragged,
        transform: { ...dragged.transform, x: dragged.transform.x + step * 3 },
      };
      draw(project(objects.map((object) => (object === dragged ? moved : object))));
    }

    expect(fillPoolWork.plans - plans).toBe(10);
    expect(fillPoolWork.sweeps - sweeps).toBe(1);
  });

  it('does not split the pool for a member dragged into a corner of its box', () => {
    // Two overlapping discs make a box; a third, drawn between them, sits in the
    // box's empty corner, meeting neither disc's box: the pool is painted whole,
    // unclipped. Its box overlapping the cluster's split the pool in two.
    const objects = [disc('low', 0, 0, 20), disc('corner', 22, 2, 4), disc('high', 10, 10, 20)];
    const recorded = draw(project(objects));

    expect(recorded.clips).toBe(0);
    expect(recorded.clippedSegments).toBe(0);
  });
});
