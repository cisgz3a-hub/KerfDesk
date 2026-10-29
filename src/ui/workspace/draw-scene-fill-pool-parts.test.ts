// Rolling audit v8 N6-P1-1 and N6-P1-2 (ADR-683 Amendment 1). #1511 pooled
// each filled path under its first operation only, so a circle given a second
// Fill operation (Add operation) showed as a hole that the second operation
// burns; and it painted a pool once, at its lowest member, so a photo drawn
// between two members covered the upper one, which still burns. These tests
// replay drawScene's paint in order (ink fills under their clips, the photo
// opaque over them) and compare the final picture with the compiled hatch.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toMachineCoords } from '../../core/devices';
import { compileJob } from '../../core/job';
import { createEllipse, createRectangle } from '../../core/shapes/primitives';
import {
  createLayer,
  createProject,
  hitTest,
  IDENTITY_TRANSFORM,
  type Layer,
  type Project,
  type RasterImage,
  type SceneObject,
  type Vec2,
} from '../../core/scene';
import { canvasTheme } from '../theme/canvas-theme';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { createDisplayPolylineCache } from './display-polylines';
import { drawScene } from './draw-scene';
import { computeView } from './view-transform';

type Region = { readonly contours: ReadonlyArray<ReadonlyArray<Vec2>>; readonly rule: string };
type PaintEvent =
  | { readonly kind: 'ink'; readonly fill: Region; readonly clips: ReadonlyArray<Region> }
  | { readonly kind: 'photo'; readonly id: string; readonly box: ReadonlyArray<Vec2> };

const painted = vi.hoisted(() => ({ events: [] as unknown[] }));

vi.mock('./draw-raster', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  // jsdom cannot decode a bitmap: record where the opaque photo is blitted.
  drawRasterImage: (_ctx: unknown, image: RasterImage) => {
    const { bounds, transform } = image;
    const box = [
      { x: bounds.minX + transform.x, y: bounds.minY + transform.y },
      { x: bounds.maxX + transform.x, y: bounds.maxY + transform.y },
    ];
    painted.events.push({ kind: 'photo', id: image.id, box });
  },
}));

const CANVAS_W = 800;
const CANVAS_H = 600;
const INK = '#000000';
const GREY = '#808080';
const SPACING_MM = 0.5;

afterEach(() => vi.unstubAllGlobals());

function fillLayer(id = INK): Layer {
  return { ...createLayer({ id, color: INK, mode: 'fill' }), hatchSpacingMm: SPACING_MM };
}

function project(objects: ReadonlyArray<SceneObject>, layers: ReadonlyArray<Layer>): Project {
  return { ...createProject(), scene: { layers: [...layers], objects: [...objects] } };
}

function rect(id: string, x: number, y: number, widthMm: number, heightMm: number): SceneObject {
  return createRectangle({
    id,
    color: INK,
    spec: { widthMm, heightMm, cornerRadiusMm: 0 },
    transform: { ...IDENTITY_TRANSFORM, x, y },
  });
}

/** Every ink fill drawScene issues (screen pixels, with the clips over it) and every photo. */
function paintEvents(current: Project): ReadonlyArray<PaintEvent> {
  vi.stubGlobal('Path2D', undefined);
  painted.events = [];
  let contours: Vec2[][] = [];
  let clips: Region[] = [];
  const saved: Region[][] = [];
  let fillStyle: unknown = null;
  const calls: Record<string, (...args: never[]) => unknown> = {
    measureText: () => ({ width: 0 }),
    beginPath: () => (contours = []),
    moveTo: (x: number, y: number) => contours.push([{ x, y }]),
    lineTo: (x: number, y: number) => contours.at(-1)?.push({ x, y }),
    save: () => saved.push(clips),
    restore: () => (clips = saved.pop() ?? []),
    clip: (rule?: string) => (clips = [...clips, { contours, rule: rule ?? 'nonzero' }]),
    fill: (rule?: string) => {
      if (fillStyle !== canvasTheme.artworkInk) return;
      painted.events.push({ kind: 'ink', fill: { contours, rule: rule ?? 'nonzero' }, clips });
    },
  };
  const ctx = new Proxy(
    {},
    {
      get: (_target, prop) => calls[prop as string] ?? (() => undefined),
      set(_target, prop, value) {
        if (prop === 'fillStyle') fillStyle = value;
        return true;
      },
    },
  ) as CanvasRenderingContext2D;
  drawScene(ctx, CANVAS_W, CANVAS_H, current, {
    selectedId: null,
    preview: false,
    view: { zoomFactor: 1, panX: 0, panY: 0 },
    displayPolylineCache: createDisplayPolylineCache(),
  });
  return painted.events as PaintEvent[];
}

function toScreen(current: Project, at: Vec2): Vec2 {
  const view = computeView(CANVAS_W, CANVAS_H, current.device.bedWidth, current.device.bedHeight, {
    zoomFactor: 1,
    panX: 0,
    panY: 0,
  });
  return { x: view.offsetX + at.x * view.scale, y: view.offsetY + at.y * view.scale };
}

function covers(region: Region, point: Vec2): boolean {
  let turns = 0;
  for (const contour of region.contours) {
    for (let i = 0; i < contour.length; i += 1) {
      const a = contour[i] as Vec2;
      const b = contour[(i + 1) % contour.length] as Vec2;
      const cross = (b.x - a.x) * (point.y - a.y) - (point.x - a.x) * (b.y - a.y);
      if (a.y <= point.y && b.y > point.y && cross > 0) turns += 1;
      else if (a.y > point.y && b.y <= point.y && cross < 0) turns -= 1;
    }
  }
  return region.rule === 'evenodd' ? turns % 2 !== 0 : turns !== 0;
}

/** What the finished canvas shows at a scene point: ink, the photo, or nothing. */
function shownAt(current: Project, events: ReadonlyArray<PaintEvent>, at: Vec2): string {
  const screen = toScreen(current, at);
  let shown = 'nothing';
  for (const event of events) {
    if (event.kind === 'ink') {
      if ([event.fill, ...event.clips].every((region) => covers(region, screen))) shown = 'ink';
      continue;
    }
    const [min, max] = event.box as [Vec2, Vec2];
    if (at.x >= min.x && at.x <= max.x && at.y >= min.y && at.y <= max.y) shown = event.id;
  }
  return shown;
}

/** Whether a compiled hatch line burns through this scene point. */
function burnedAt(current: Project, at: Vec2): boolean {
  const machine = toMachineCoords(at, current.device);
  return compileJob(current.scene, current.device).groups.some(
    (group) =>
      group.kind === 'fill' &&
      group.segments.some((segment) => {
        const [a, b] = segment.polyline;
        if (a === undefined || b === undefined || a.y !== b.y) return false;
        return (
          Math.abs(a.y - machine.y) <= SPACING_MM / 2 &&
          Math.min(a.x, b.x) <= machine.x &&
          Math.max(a.x, b.x) >= machine.x
        );
      }),
  );
}

describe('a path on two Fill operations (N6-P1-1)', () => {
  const CIRCLE_CENTRE: Vec2 = { x: 30, y: 25 };
  const PLATE_BODY: Vec2 = { x: 14, y: 14 };
  const circle = createEllipse({
    id: 'circle',
    color: INK,
    spec: { widthMm: 16, heightMm: 16 },
    transform: { ...IDENTITY_TRANSFORM, x: 22, y: 17 },
  });

  function addOperationTo(id: string, objects: ReadonlyArray<SceneObject>): Project {
    resetStore();
    useStore.setState({ project: project(objects, [fillLayer()]), selectedObjectId: id });
    useStore.getState().addOperationForSelection();
    return useStore.getState().project;
  }

  it('Add operation on a plate circle: the canvas inks the circle the second operation burns', () => {
    const added = addOperationTo('circle', [rect('plate', 10, 10, 40, 30), circle]);
    expect(added.scene.layers.map((layer) => layer.mode)).toEqual(['fill', 'fill']);

    const events = paintEvents(added);
    const points = [PLATE_BODY, CIRCLE_CENTRE, { x: 70, y: 70 }];
    expect(points.map((point) => burnedAt(added, point))).toEqual([true, true, false]);
    expect(points.map((point) => shownAt(added, events, point))).toEqual(['ink', 'ink', 'nothing']);
    // A click lands where the ink is: the circle, not a hole in the plate.
    expect(hitTest(added.scene, CIRCLE_CENTRE)).toBe('circle');
  });

  it('Add operation on the upper of two overlapping parts keeps their overlap inked', () => {
    const added = addOperationTo('b', [rect('a', 10, 10, 30, 30), rect('b', 25, 25, 30, 30)]);
    const overlap = { x: 32, y: 32 };

    expect(burnedAt(added, overlap)).toBe(true);
    expect(shownAt(added, paintEvents(added), overlap)).toBe('ink');
  });
});

describe('a pool split around a photo drawn between its members (N6-P1-2)', () => {
  // A plaque: a frame (outer and window rectangles) on one Fill operation, a
  // photo in the window, and a caption over the photo on the frame's operation.
  const photo: RasterImage = {
    kind: 'raster-image',
    id: 'photo',
    source: 'photo.png',
    dataUrl: 'data:image/png;base64,AAAA',
    pixelWidth: 60,
    pixelHeight: 40,
    bounds: { minX: 0, minY: 0, maxX: 60, maxY: 40 },
    transform: { ...IDENTITY_TRANSFORM, x: 20, y: 20 },
    color: GREY,
    dither: 'threshold',
    linesPerMm: 10,
  };
  const layers = [fillLayer(), createLayer({ id: GREY, color: GREY, mode: 'image' })];
  const frame = [rect('outer', 10, 10, 80, 60), rect('window', 20, 20, 60, 40)];
  const caption = rect('caption', 35, 37, 30, 6);
  const FRAME_BODY: Vec2 = { x: 15, y: 40 };
  const IN_WINDOW: Vec2 = { x: 25, y: 25 };
  const CAPTION: Vec2 = { x: 50, y: 40 };

  it('paints the caption over the photo, where it burns', () => {
    const plaque = project([...frame, photo, caption], layers);
    const events = paintEvents(plaque);
    const points = [FRAME_BODY, IN_WINDOW, CAPTION];

    expect(points.map((point) => burnedAt(plaque, point))).toEqual([true, false, true]);
    expect(points.map((point) => shownAt(plaque, events, point))).toEqual(['ink', 'photo', 'ink']);
    const photoAt = events.findIndex((event) => event.kind === 'photo');
    const captionInk = events.findLastIndex(
      (event) => event.kind === 'ink' && covers(event.fill, toScreen(plaque, CAPTION)),
    );
    expect(captionInk).toBeGreaterThan(photoAt);
  });

  it('still paints the pool once, unclipped, when nothing is drawn between its members', () => {
    const events = paintEvents(project([...frame, caption, photo], layers));
    const ink = events.filter((event) => event.kind === 'ink');

    expect(ink).toHaveLength(1);
    expect(ink[0]).toMatchObject({ clips: [] });
  });

  it('leaves a photo drawn above the whole plaque on top, as drawn', () => {
    const plaque = project([...frame, caption, photo], layers);
    const events = paintEvents(plaque);

    // The photo is on top, as drawn: the caption under it burns, unseen, as before #1511.
    expect(shownAt(plaque, events, CAPTION)).toBe('photo');
    expect(shownAt(plaque, events, FRAME_BODY)).toBe('ink');
  });

  it('paints a pool split past the clip budget whole, above every photo between its members', () => {
    // 600 captions, each over its own photo: 601 parts of a 2,400-segment pool.
    const stack = Array.from({ length: 600 }, (_, i) => [
      { ...photo, id: `photo-${i}` },
      rect(`caption-${i}`, 35, 37, 30, 6),
    ]).flat();
    const plaque = project([...frame, ...stack], layers);
    const events = paintEvents(plaque);
    const ink = events.filter((event) => event.kind === 'ink');

    expect(ink).toHaveLength(1);
    expect(ink[0]).toMatchObject({ clips: [] });
    expect(events.at(-1)?.kind).toBe('ink');
    expect(shownAt(plaque, events, FRAME_BODY)).toBe('ink');
    expect(shownAt(plaque, events, IN_WINDOW)).toBe('photo-599');
  });
});
