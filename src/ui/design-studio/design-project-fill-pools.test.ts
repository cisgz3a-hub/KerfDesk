// ADR-683 Amendment 4: Design Studio's underlay of project artwork paints a Fill
// operation as the one even-odd region it burns, as the workspace canvas does,
// and a photo stacked between two members keeps its place. These tests read the
// underlay the way pixels would (every recorded fill by its own rule, inside
// every clip in force) and compare it with the compiled hatch at the same points.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toMachineCoords } from '../../core/devices';
import { compileJob } from '../../core/job';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Layer,
  type RasterImage,
  type Scene,
  type SceneObject,
  type Vec2,
} from '../../core/scene';
import { createEllipse, createRectangle } from '../../core/shapes/primitives';
import { drawRasterImage } from '../workspace/draw-raster';
import { paintDesignProjectArtwork } from './design-project-photos';
import { paintDesignProjectVectors } from './design-project-vectors';

vi.mock('../workspace/draw-raster', () => ({
  drawRasterImage: vi.fn(),
  burnedImageAdjustments: (photo: RasterImage) => photo,
}));

const INK = '#000000';
const SPACING_MM = 0.5;
const PX_PER_MM = 4;
const VIEW = { pxPerMm: PX_PER_MM, panXmm: 0, panYmm: 0 };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function fillLayer(): Layer {
  return { ...createLayer({ id: INK, color: INK, mode: 'fill' }), hatchSpacingMm: SPACING_MM };
}

function scene(objects: ReadonlyArray<SceneObject>): Scene {
  return { ...createProject().scene, layers: [fillLayer()], objects };
}

function plate(id: string): SceneObject {
  return createRectangle({
    id,
    color: INK,
    spec: { widthMm: 40, heightMm: 30, cornerRadiusMm: 0 },
    transform: { ...IDENTITY_TRANSFORM, x: 10, y: 10 },
  });
}

function circle(id: string): SceneObject {
  return createEllipse({
    id,
    color: INK,
    spec: { widthMm: 16, heightMm: 16 },
    transform: { ...IDENTITY_TRANSFORM, x: 22, y: 17 },
  });
}

const photo: RasterImage = {
  kind: 'raster-image',
  id: 'photo',
  source: 'photo.png',
  dataUrl: 'data:image/png;base64,AA==',
  bounds: { minX: 0, minY: 0, maxX: 60, maxY: 50 },
  transform: IDENTITY_TRANSFORM,
  pixelWidth: 60,
  pixelHeight: 50,
  color: '#808080',
  dither: 'threshold',
  linesPerMm: 10,
};

const PLATE_BODY: Vec2 = { x: 14, y: 14 };
const CIRCLE_CENTRE: Vec2 = { x: 30, y: 25 };
const OUTSIDE: Vec2 = { x: 70, y: 70 };

type Region = { readonly contours: ReadonlyArray<ReadonlyArray<Vec2>>; readonly rule: string };
type Painted = {
  readonly events: ReadonlyArray<'fill' | 'photo'>;
  readonly fills: ReadonlyArray<Region & { readonly clips: ReadonlyArray<Region> }>;
  readonly strokes: ReadonlyArray<ReadonlyArray<ReadonlyArray<Vec2>>>;
};

/** Every fill (with its rule and the clips in force), stroke and photo the underlay draws. */
function painted(paint: (ctx: CanvasRenderingContext2D) => void): Painted {
  vi.stubGlobal('Path2D', undefined);
  const events: Array<'fill' | 'photo'> = [];
  const fills: Array<Region & { clips: ReadonlyArray<Region> }> = [];
  const strokes: Vec2[][][] = [];
  let contours: Vec2[][] = [];
  let clips: Region[] = [];
  const saved: Region[][] = [];
  vi.mocked(drawRasterImage).mockImplementation(() => {
    events.push('photo');
  });
  const ctx = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'measureText') return () => ({ width: 0 });
        if (prop === 'beginPath')
          return () => {
            contours = [];
          };
        if (prop === 'moveTo') return (x: number, y: number) => contours.push([{ x, y }]);
        if (prop === 'lineTo') return (x: number, y: number) => contours.at(-1)?.push({ x, y });
        if (prop === 'save') return () => saved.push(clips);
        if (prop === 'restore')
          return () => {
            clips = saved.pop() ?? [];
          };
        if (prop === 'clip')
          return (rule?: string) => {
            clips = [...clips, { contours: contours.map((c) => [...c]), rule: rule ?? 'nonzero' }];
          };
        if (prop === 'fill')
          return (rule?: string) => {
            events.push('fill');
            fills.push({ contours: contours.map((c) => [...c]), rule: rule ?? 'nonzero', clips });
          };
        if (prop === 'stroke') return () => strokes.push(contours.map((c) => [...c]));
        return () => undefined;
      },
      set() {
        return true;
      },
    },
  ) as CanvasRenderingContext2D;
  paint(ctx);
  return { events, fills, strokes };
}

function winding(point: Vec2, contours: ReadonlyArray<ReadonlyArray<Vec2>>): number {
  let total = 0;
  for (const contour of contours) {
    for (let i = 0; i < contour.length; i += 1) {
      const a = contour[i] as Vec2;
      const b = contour[(i + 1) % contour.length] as Vec2;
      const cross = (b.x - a.x) * (point.y - a.y) - (point.x - a.x) * (b.y - a.y);
      if (a.y <= point.y && b.y > point.y && cross > 0) total += 1;
      else if (a.y > point.y && b.y <= point.y && cross < 0) total -= 1;
    }
  }
  return total;
}

function covers(region: Region, screen: Vec2): boolean {
  const turns = winding(screen, region.contours);
  return region.rule === 'evenodd' ? turns % 2 !== 0 : turns !== 0;
}

/** Whether the underlay shows ink at this scene point. */
function inkedAt({ fills }: Painted, at: Vec2): boolean {
  const screen = { x: at.x * PX_PER_MM, y: at.y * PX_PER_MM };
  return fills.some((fill) => covers(fill, screen) && fill.clips.every((c) => covers(c, screen)));
}

function strokedAt({ strokes }: Painted, at: Vec2): boolean {
  const p = { x: at.x * PX_PER_MM, y: at.y * PX_PER_MM };
  return strokes.some((path) =>
    path.some((contour) =>
      contour.some((a, i) => {
        const b = contour[i + 1];
        if (b === undefined) return false;
        const length = (b.x - a.x) ** 2 + (b.y - a.y) ** 2 || 1;
        const t = Math.max(
          0,
          Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / length),
        );
        return Math.hypot(a.x + t * (b.x - a.x) - p.x, a.y + t * (b.y - a.y) - p.y) <= 0.5;
      }),
    ),
  );
}

/** Whether a compiled hatch line burns through this scene point. */
function burnedAt(current: Scene, at: Vec2): boolean {
  const { device } = createProject();
  const machine = toMachineCoords(at, device);
  return compileJob(current, device).groups.some(
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

function expectUnderlayShowsTheBurn(
  ink: Painted,
  burned: Scene,
  points: ReadonlyArray<Vec2>,
): boolean[] {
  const shown = points.map((point) => inkedAt(ink, point));
  expect(shown).toEqual(points.map((point) => burnedAt(burned, point)));
  return shown;
}

describe('a Fill operation in the Design Studio underlay (ADR-683 Amendment 4)', () => {
  it('shows an inner circle as the hole the burn leaves', () => {
    const ring = scene([plate('plate'), circle('circle')]);
    const ink = painted((ctx) => paintDesignProjectVectors(ctx, ring, VIEW, new Set()));
    expect(expectUnderlayShowsTheBurn(ink, ring, [PLATE_BODY, CIRCLE_CENTRE, OUTSIDE])).toEqual([
      true,
      false,
      false,
    ]);
  });

  it('outlines two cancelled copies unfilled, and fills three copies once', () => {
    const twice = scene([plate('plate'), plate('copy')]);
    const ink = painted((ctx) => paintDesignProjectVectors(ctx, twice, VIEW, new Set()));
    expect(expectUnderlayShowsTheBurn(ink, twice, [PLATE_BODY])).toEqual([false]);
    expect(strokedAt(ink, { x: 30, y: 10 })).toBe(true);
    const thrice = scene([plate('plate'), plate('copy'), plate('copy-2')]);
    const three = painted((ctx) => paintDesignProjectVectors(ctx, thrice, VIEW, new Set()));
    expect(expectUnderlayShowsTheBurn(three, thrice, [PLATE_BODY])).toEqual([true]);
  });

  it('keeps a photo stacked between two members in its place, and the burn shown', () => {
    const vectors = [plate('plate'), circle('circle')];
    const between = scene([vectors[0] as SceneObject, photo, vectors[1] as SceneObject]);
    const ink = painted((ctx) => paintDesignProjectArtwork(ctx, between, VIEW, null));
    // The plate's part is painted under the photo, the circle's above it.
    expect(ink.events[0]).toBe('fill');
    expect(ink.events).toContain('photo');
    expect(ink.events.at(-1)).toBe('fill');
    expect(
      expectUnderlayShowsTheBurn(ink, scene(vectors), [PLATE_BODY, CIRCLE_CENTRE, OUTSIDE]),
    ).toEqual([true, false, false]);

    const below = scene([photo, ...vectors]);
    const whole = painted((ctx) => paintDesignProjectArtwork(ctx, below, VIEW, null));
    expect(whole.events[0]).toBe('photo');
    expect(expectUnderlayShowsTheBurn(whole, scene(vectors), [PLATE_BODY, CIRCLE_CENTRE])).toEqual([
      true,
      false,
    ]);
  });

  it('leaves the live draft objects out of the pools they replace', () => {
    const ring = scene([plate('plate'), circle('circle')]);
    const ink = painted((ctx) => paintDesignProjectVectors(ctx, ring, VIEW, new Set(['circle'])));
    // The draft draws the circle itself; the saved plate alone fills solid.
    expect(inkedAt(ink, CIRCLE_CENTRE)).toBe(true);
    expect(inkedAt(ink, PLATE_BODY)).toBe(true);
  });
});
