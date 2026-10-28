// L8-P1-1 (rolling audit v7): the compiler pools every object on one Fill
// operation under even-odd parity (fill-rule.ts, ADR-486 Amendment 2), so a
// shape drawn inside another is a hole and two stacked copies burn nothing.
// The canvas painted each object on its own and showed solid plates. These
// tests read the canvas the way pixels would (every recorded ink fill, by its
// own rule) and compare it with the compiled hatch at the same points (ADR-683).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toMachineCoords } from '../../core/devices';
import { compileJob } from '../../core/job';
import { createEllipse, createRectangle } from '../../core/shapes/primitives';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Layer,
  type Polyline,
  type Project,
  type SceneObject,
  type Vec2,
} from '../../core/scene';
import { canvasTheme } from '../theme/canvas-theme';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { createDisplayPolylineCache } from './display-polylines';
import { drawScene } from './draw-scene';
import { computeView } from './view-transform';

type RecordedFill = {
  readonly contours: ReadonlyArray<ReadonlyArray<Vec2>>;
  readonly rule: string;
};

const CANVAS_W = 800;
const CANVAS_H = 600;
const INK = '#000000';
const SPACING_MM = 0.5;

afterEach(() => vi.unstubAllGlobals());

function fillLayer(id = INK, color = INK): Layer {
  return { ...createLayer({ id, color, mode: 'fill' }), hatchSpacingMm: SPACING_MM };
}

function project(objects: ReadonlyArray<SceneObject>, layers = [fillLayer()]): Project {
  return { ...createProject(), scene: { layers, objects } };
}

function plate(id: string, color = INK): SceneObject {
  return createRectangle({
    id,
    color,
    spec: { widthMm: 40, heightMm: 30, cornerRadiusMm: 0 },
    transform: { ...IDENTITY_TRANSFORM, x: 10, y: 10 },
  });
}

function circle(id: string, color = INK): SceneObject {
  return createEllipse({
    id,
    color,
    spec: { widthMm: 16, heightMm: 16 },
    transform: { ...IDENTITY_TRANSFORM, x: 22, y: 17 },
  });
}

const PLATE_BODY: Vec2 = { x: 14, y: 14 };
const CIRCLE_CENTRE: Vec2 = { x: 30, y: 25 };
const OUTSIDE: Vec2 = { x: 70, y: 70 };

type PaintedInk = {
  readonly fills: ReadonlyArray<RecordedFill>;
  readonly strokes: ReadonlyArray<ReadonlyArray<ReadonlyArray<Vec2>>>;
};

/** The artwork-ink fills (with their rule) and strokes drawScene issues, in screen pixels. */
function paintedInk(current: Project, selectedId: string | null = null): PaintedInk {
  vi.stubGlobal('Path2D', undefined);
  const fills: RecordedFill[] = [];
  const strokes: Vec2[][][] = [];
  let contours: Vec2[][] = [];
  let fillStyle: unknown = null;
  let strokeStyle: unknown = null;
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
        if (prop === 'fill')
          return (rule?: string) => {
            if (fillStyle === canvasTheme.artworkInk)
              fills.push({ contours: contours.map((c) => [...c]), rule: rule ?? 'nonzero' });
          };
        if (prop === 'stroke')
          return () => {
            if (strokeStyle === canvasTheme.artworkInk) strokes.push(contours.map((c) => [...c]));
          };
        return () => undefined;
      },
      set(_target, prop, value) {
        if (prop === 'fillStyle') fillStyle = value;
        if (prop === 'strokeStyle') strokeStyle = value;
        return true;
      },
    },
  ) as CanvasRenderingContext2D;
  drawScene(ctx, CANVAS_W, CANVAS_H, current, {
    selectedId,
    preview: false,
    view: { zoomFactor: 1, panX: 0, panY: 0 },
    displayPolylineCache: createDisplayPolylineCache(),
  });
  return { fills, strokes };
}

function toScreen(current: Project, at: Vec2): Vec2 {
  const view = computeView(CANVAS_W, CANVAS_H, current.device.bedWidth, current.device.bedHeight, {
    zoomFactor: 1,
    panX: 0,
    panY: 0,
  });
  return { x: view.offsetX + at.x * view.scale, y: view.offsetY + at.y * view.scale };
}

/** Whether an ink stroke passes within half a pixel of this scene point. */
function strokedAt(current: Project, ink: PaintedInk, at: Vec2): boolean {
  const p = toScreen(current, at);
  return ink.strokes.some((path) =>
    path.some((contour) =>
      contour.some((a, i) => {
        const b = contour[i + 1];
        if (b === undefined) return false;
        const t = Math.max(
          0,
          Math.min(
            1,
            ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) /
              ((b.x - a.x) ** 2 + (b.y - a.y) ** 2 || 1),
          ),
        );
        return Math.hypot(a.x + t * (b.x - a.x) - p.x, a.y + t * (b.y - a.y) - p.y) <= 0.5;
      }),
    ),
  );
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

/** Whether the canvas shows ink at this scene point: any ink fill covers it by its rule. */
function canvasInkedAt(current: Project, fills: ReadonlyArray<RecordedFill>, at: Vec2): boolean {
  const screen = toScreen(current, at);
  return fills.some((fill) => {
    const turns = winding(screen, fill.contours);
    return fill.rule === 'evenodd' ? turns % 2 !== 0 : turns !== 0;
  });
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

function expectCanvasShowsTheBurn(current: Project, points: ReadonlyArray<Vec2>): boolean[] {
  const { fills } = paintedInk(current);
  const shown = points.map((point) => canvasInkedAt(current, fills, point));
  expect(shown).toEqual(points.map((point) => burnedAt(current, point)));
  return shown;
}

describe('a Fill operation on the design canvas (L8-P1-1)', () => {
  it('shows a separate inner circle as the hole the burn leaves', () => {
    const ring = project([plate('plate'), circle('circle')]);
    expect(expectCanvasShowsTheBurn(ring, [PLATE_BODY, CIRCLE_CENTRE, OUTSIDE])).toEqual([
      true,
      false,
      false,
    ]);
  });

  it('shows a duplicated plate as burning nothing, and three copies as burning once', () => {
    const twice = project([plate('plate'), plate('copy')]);
    expect(expectCanvasShowsTheBurn(twice, [PLATE_BODY, CIRCLE_CENTRE])).toEqual([false, false]);
    const thrice = project([plate('plate'), plate('copy'), plate('copy-2')]);
    expect(expectCanvasShowsTheBurn(thrice, [PLATE_BODY, CIRCLE_CENTRE])).toEqual([true, true]);
  });

  it('keeps separate Fill operations apart, as the burn does', () => {
    const red = '#ff0000';
    const apart = project(
      [plate('plate'), circle('circle', red)],
      [fillLayer(), fillLayer(red, red)],
    );
    expect(expectCanvasShowsTheBurn(apart, [PLATE_BODY, CIRCLE_CENTRE])).toEqual([true, true]);
  });

  it('resolves a non-zero object before pooling it, as the compiler does', () => {
    const square = (x: number): Polyline => ({
      closed: true,
      points: [
        { x, y: 10 },
        { x: x + 20, y: 10 },
        { x: x + 20, y: 30 },
        { x, y: 30 },
      ],
    });
    // Two overlapping squares under non-zero: one solid 30 x 20 block.
    const block: ImportedSvg = {
      kind: 'imported-svg',
      id: 'block',
      source: 'block.svg',
      bounds: { minX: 10, minY: 10, maxX: 40, maxY: 30 },
      transform: IDENTITY_TRANSFORM,
      paths: [{ color: INK, fillRule: 'nonzero', polylines: [square(10), square(20)] }],
    };
    const overlap = { x: 25, y: 20 };
    const blockOnly = { x: 12, y: 20 };
    const inner = createRectangle({
      id: 'inner',
      color: INK,
      spec: { widthMm: 4, heightMm: 4, cornerRadiusMm: 0 },
      transform: { ...IDENTITY_TRANSFORM, x: 23, y: 18 },
    });
    expect(
      expectCanvasShowsTheBurn(project([block, inner]), [overlap, blockOnly, { x: 35, y: 20 }]),
    ).toEqual([false, true, true]);
  });

  it('Duplicate (Ctrl+D) on a Fill plate: the canvas outlines it unfilled where the burn is empty', () => {
    resetStore();
    useStore.setState({ project: project([plate('plate')]), selectedObjectId: 'plate' });
    useStore.getState().duplicateSelection();
    const duplicated = useStore.getState().project;
    expect(duplicated.scene.objects).toHaveLength(2);

    expect(expectCanvasShowsTheBurn(duplicated, [PLATE_BODY, CIRCLE_CENTRE])).toEqual([
      false,
      false,
    ]);
    // LightBurn shows such copies unfilled, not gone: the outline still draws.
    const ink = paintedInk(duplicated, useStore.getState().selectedObjectId);
    expect(strokedAt(duplicated, ink, { x: 30, y: 10 })).toBe(true);
    expect(strokedAt(duplicated, ink, PLATE_BODY)).toBe(false);
  });

  it('leaves parts that overlap nothing on their operation to paint themselves', () => {
    const apart = project([
      plate('left'),
      createRectangle({
        id: 'right',
        color: INK,
        spec: { widthMm: 20, heightMm: 20, cornerRadiusMm: 0 },
        transform: { ...IDENTITY_TRANSFORM, x: 80, y: 10 },
      }),
    ]);
    const { fills, strokes } = paintedInk(apart);
    // One fill each, as before pooling; no pool outline is drawn.
    expect(fills).toHaveLength(2);
    expect(strokes).toEqual([]);
    expect(expectCanvasShowsTheBurn(apart, [PLATE_BODY, { x: 90, y: 20 }])).toEqual([true, true]);
  });
});
