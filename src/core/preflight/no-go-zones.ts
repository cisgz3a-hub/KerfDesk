import type { MachineBounds, NoGoZone } from '../devices';
import { arcIntersectsRect } from '../invariants/arc-rect-intersection';
import { isArcMotion, isClockwiseArc } from '../invariants/gcode-words';
import {
  isGcodeCommand,
  isGcodeMotionCommand,
  parseGcodeWord,
  stripGcodeComment,
  type MotionBoundsOffset,
} from '../invariants';

export type NoGoZoneCollision = {
  readonly lineNumber: number;
  readonly zone: NoGoZone;
};

type Point = {
  readonly x: number;
  readonly y: number;
};

type Rect = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};
type ActiveZone = { readonly zone: NoGoZone; readonly rect: Rect };
type Axes = { readonly x: number | null; readonly y: number | null };

// The first enabled zone a straight from→to move would cross (or null). Used by
// the jog/click-to-position guard (DEV-04) — app-initiated motion isn't G-code,
// so it checks the raw segment directly rather than scanning emitted lines.
// Points are machine-coordinate mm.
export function firstZoneCrossedBySegment(
  from: { readonly x: number; readonly y: number },
  to: { readonly x: number; readonly y: number },
  zones: ReadonlyArray<NoGoZone>,
): NoGoZone | null {
  for (const zone of zones) {
    if (!zone.enabled) continue;
    if (segmentIntersectsRect(from, to, rectForZone(zone))) return zone;
  }
  return null;
}

export function findNoGoZoneCollisions(
  gcode: string,
  zones: ReadonlyArray<NoGoZone>,
  bed: MachineBounds,
  options: {
    readonly motionOffset?: MotionBoundsOffset | undefined;
    readonly initialMachinePosition?: Point | undefined;
  } = {},
): ReadonlyArray<NoGoZoneCollision> {
  const activeZones = zones
    .filter((zone) => zone.enabled)
    .map((zone) => ({ zone, rect: rectForZone(zone) }))
    .filter(({ rect }) => rectsIntersect(rect, boundsRect(bed)));
  if (activeZones.length === 0) return [];

  const offset = options.motionOffset ?? { x: 0, y: 0 };
  const collisions: NoGoZoneCollision[] = [];
  let current: Point | null = options.initialMachinePosition ?? null;
  let absolute = true;

  for (const [index, raw] of gcode.split('\n').entries()) {
    const stripped = stripComment(raw);
    if (stripped === '') continue;
    absolute = absoluteModeAfterLine(stripped, absolute);
    const next = nextPoint(stripped, current, absolute, offset);
    if (next === null) continue;
    appendCollision(collisions, current, next, stripped, activeZones, index + 1);
    current = next;
  }

  return collisions;
}

function nextPoint(
  line: string,
  current: Point | null,
  absolute: boolean,
  offset: MotionBoundsOffset,
): Point | null {
  if (!isGcodeMotionCommand(line)) return null;
  const axes = parseAxes(line);
  if (axes.x === null && axes.y === null) {
    const completeArc =
      isArcMotion(line) && parseGcodeWord(line, 'I') !== null && parseGcodeWord(line, 'J') !== null;
    return completeArc ? current : null;
  }
  const base = current ?? offset;
  return absolute ? absolutePoint(axes, base, offset) : relativePoint(axes, base);
}

function absoluteModeAfterLine(line: string, current: boolean): boolean {
  if (isGcodeCommand(line, 'G90')) return true;
  if (isGcodeCommand(line, 'G91')) return false;
  return current;
}

function appendCollision(
  collisions: NoGoZoneCollision[],
  current: Point | null,
  next: Point,
  line: string,
  activeZones: ReadonlyArray<ActiveZone>,
  lineNumber: number,
): void {
  if (current === null) return;
  const hit = activeZones.find(({ rect }) => motionIntersectsRect(current, next, line, rect));
  if (hit !== undefined) collisions.push({ lineNumber, zone: hit.zone });
}

function motionIntersectsRect(current: Point, next: Point, line: string, rect: Rect): boolean {
  if (!isArcMotion(line)) return segmentIntersectsRect(current, next, rect);
  const i = parseGcodeWord(line, 'I');
  const j = parseGcodeWord(line, 'J');
  if (i === null || j === null) return segmentIntersectsRect(current, next, rect);
  return arcIntersectsRect(current, next, i, j, isClockwiseArc(line), rect);
}

function parseAxes(line: string): Axes {
  return { x: parseGcodeWord(line, 'X'), y: parseGcodeWord(line, 'Y') };
}

function absolutePoint(axes: Axes, base: Point, offset: MotionBoundsOffset): Point {
  return {
    x: axes.x !== null ? axes.x + offset.x : base.x,
    y: axes.y !== null ? axes.y + offset.y : base.y,
  };
}

function relativePoint(axes: Axes, base: Point): Point {
  return { x: base.x + (axes.x ?? 0), y: base.y + (axes.y ?? 0) };
}

function segmentIntersectsRect(a: Point, b: Point, rect: Rect): boolean {
  if (pointInRect(a, rect) || pointInRect(b, rect)) return true;
  return (
    segmentsIntersect(a, b, { x: rect.minX, y: rect.minY }, { x: rect.maxX, y: rect.minY }) ||
    segmentsIntersect(a, b, { x: rect.maxX, y: rect.minY }, { x: rect.maxX, y: rect.maxY }) ||
    segmentsIntersect(a, b, { x: rect.maxX, y: rect.maxY }, { x: rect.minX, y: rect.maxY }) ||
    segmentsIntersect(a, b, { x: rect.minX, y: rect.maxY }, { x: rect.minX, y: rect.minY })
  );
}

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  if (o1 !== o2 && o3 !== o4) return true;
  return (
    (o1 === 0 && pointOnSegment(c, a, b)) ||
    (o2 === 0 && pointOnSegment(d, a, b)) ||
    (o3 === 0 && pointOnSegment(a, c, d)) ||
    (o4 === 0 && pointOnSegment(b, c, d))
  );
}

function orientation(a: Point, b: Point, c: Point): -1 | 0 | 1 {
  const cross = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
  if (Math.abs(cross) < 1e-9) return 0;
  return cross > 0 ? 1 : -1;
}

function pointOnSegment(point: Point, a: Point, b: Point): boolean {
  return (
    point.x >= Math.min(a.x, b.x) &&
    point.x <= Math.max(a.x, b.x) &&
    point.y >= Math.min(a.y, b.y) &&
    point.y <= Math.max(a.y, b.y)
  );
}

function pointInRect(point: Point, rect: Rect): boolean {
  return (
    point.x >= rect.minX && point.x <= rect.maxX && point.y >= rect.minY && point.y <= rect.maxY
  );
}

function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

function rectForZone(zone: NoGoZone): Rect {
  return {
    minX: zone.x,
    minY: zone.y,
    maxX: zone.x + zone.width,
    maxY: zone.y + zone.height,
  };
}

function boundsRect(bounds: MachineBounds): Rect {
  return {
    minX: bounds.minX,
    minY: bounds.minY,
    maxX: bounds.maxX,
    maxY: bounds.maxY,
  };
}

function stripComment(line: string): string {
  return stripGcodeComment(line);
}
