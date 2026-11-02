// The picture and the burn, side by side, for draw-scene-burn-parity.test.ts:
// drawScene's fills (under their clips, photos opaque) and compileJob's hatch.
import { vi } from 'vitest';
import { toMachineCoords } from '../../core/devices';
import { compileJob } from '../../core/job';
import {
  applyTransform,
  combinedBBox,
  isRegistrationBox,
  transformedBBox,
  type AABB,
  type Project,
  type Vec2,
} from '../../core/scene';
import { canvasTheme } from '../theme/canvas-theme';
import { createDisplayPolylineCache } from './display-polylines';
import { drawScene } from './draw-scene';
import { computeView } from './view-transform';

type Region = { readonly contours: ReadonlyArray<ReadonlyArray<Vec2>>; readonly rule: string };
export type PaintEvent =
  | { readonly kind: 'ink'; readonly fill: Region; readonly clips: ReadonlyArray<Region> }
  | { readonly kind: 'photo'; readonly id: string; readonly box: ReadonlyArray<Vec2> };

const CANVAS_W = 800;
const CANVAS_H = 600;
export const SPACING_MM = 0.5;
const GRID_MM = 1;
const EDGE_MM = 1;

/** Every ink fill drawScene issues, after any photos the test's raster mock recorded. */
export function paintEvents(
  painted: { events: unknown[] },
  current: Project,
  wireframe = false,
): ReadonlyArray<PaintEvent> {
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
    wireframe,
  });
  return painted.events as PaintEvent[];
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

export function shownAt(current: Project, events: ReadonlyArray<PaintEvent>, at: Vec2): string {
  const view = computeView(CANVAS_W, CANVAS_H, current.device.bedWidth, current.device.bedHeight, {
    zoomFactor: 1,
    panX: 0,
    panY: 0,
  });
  const screen = { x: view.offsetX + at.x * view.scale, y: view.offsetY + at.y * view.scale };
  let shown = 'nothing';
  for (const event of events) {
    if (event.kind === 'ink') {
      if ([event.fill, ...event.clips].every((region) => covers(region, screen))) shown = 'ink';
      continue;
    }
    const [min, max] = event.box as [Vec2, Vec2];
    if (at.x >= min.x && at.x <= max.x && at.y >= min.y && at.y <= max.y) shown = 'photo';
  }
  return shown;
}

/** Burned at a scene point: the hatch lines near it, by row. */
export function burnProbe(current: Project): (at: Vec2) => boolean {
  const rows = new Map<number, Array<readonly [number, number]>>();
  for (const group of compileJob(current.scene, current.device).groups) {
    if (group.kind !== 'fill') continue;
    for (const segment of group.segments) {
      const [a, b] = segment.polyline;
      if (a === undefined || b === undefined || a.y !== b.y) continue;
      const row = Math.round(a.y / SPACING_MM);
      rows.set(row, [...(rows.get(row) ?? []), [Math.min(a.x, b.x), Math.max(a.x, b.x)]]);
    }
  }
  return (at) => {
    const machine = toMachineCoords(at, current.device);
    const row = Math.round(machine.y / SPACING_MM);
    return [row - 1, row, row + 1].some((candidate) =>
      (rows.get(candidate) ?? []).some(([min, max]) => min <= machine.x && max >= machine.x),
    );
  };
}

function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t =
    dx === 0 && dy === 0
      ? 0
      : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

function worldEdges(current: Project): ReadonlyArray<readonly [Vec2, Vec2]> {
  return current.scene.objects.flatMap((object) => {
    const contours: ReadonlyArray<ReadonlyArray<Vec2>> =
      'paths' in object
        ? object.paths.flatMap((path) => path.polylines.map((polyline) => polyline.points))
        : (() => {
            const box = transformedBBox(object);
            return [
              [
                { x: box.minX, y: box.minY },
                { x: box.maxX, y: box.minY },
                { x: box.maxX, y: box.maxY },
                { x: box.minX, y: box.maxY },
              ],
            ];
          })();
    return contours.flatMap((points) => {
      const world = points.map((point) =>
        'paths' in object ? applyTransform(point, object.transform) : point,
      );
      return world.map((point, i) => [point, world[(i + 1) % world.length] as Vec2] as const);
    });
  });
}

function within(box: AABB, at: Vec2): boolean {
  return at.x >= box.minX && at.x <= box.maxX && at.y >= box.minY && at.y <= box.maxY;
}

export type Mismatch = { readonly at: Vec2; readonly shown: string; readonly burned: boolean };

/** Every grid point, away from edges, where the picture and the hatch differ. */
export function mismatches(
  events: ReadonlyArray<PaintEvent>,
  current: Project,
  allowed: { readonly shownNotOutput?: AABB; readonly burnedNotShown?: AABB } = {},
): { readonly points: number; readonly wrong: Mismatch[] } {
  const burned = burnProbe(current);
  const edges = worldEdges(current);
  const box = combinedBBox(current.scene.objects.filter((object) => !isRegistrationBox(object)));
  if (box === null) throw new Error('nothing to compare');
  const wrong: Mismatch[] = [];
  let points = 0;
  for (let y = box.minY - 2.25; y <= box.maxY + 2; y += GRID_MM) {
    for (let x = box.minX - 2.25; x <= box.maxX + 2; x += GRID_MM) {
      const at = { x, y };
      if (edges.some(([a, b]) => distanceToSegment(at, a, b) < EDGE_MM)) continue;
      points += 1;
      const shown = shownAt(current, events, at);
      const burn = burned(at);
      // A photo drawn over a burn hides it, as drawn.
      if (shown === 'photo' || (shown === 'ink') === burn) continue;
      const known = shown === 'ink' ? allowed.shownNotOutput : allowed.burnedNotShown;
      if (known === undefined || !within(known, at)) wrong.push({ at, shown, burned: burn });
    }
  }
  return { points, wrong };
}
