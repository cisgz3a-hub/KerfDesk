import type { MachineBounds, NoGoZone } from '../devices';
import { scanModalMotionLine, type GcodeMotionMode } from '../gcode/modal-motion-line';
import { arcIntersectsRect } from '../invariants/arc-rect-intersection';
import { asGcodeLines } from '../invariants/gcode-words';
import {
  isGcodeCommand,
  parseGcodeWord,
  stripGcodeComment,
  type MotionBoundsOffset,
} from '../invariants';

export type NoGoZoneCollision = {
  readonly lineNumber: number;
  readonly zone: NoGoZone;
  /** Cutter envelope used for this motion; absent preserves centerline callers. */
  readonly cutterRadiusMm?: number;
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
  gcode: string | ReadonlyArray<string>,
  zones: ReadonlyArray<NoGoZone>,
  bed: MachineBounds,
  options: {
    readonly motionOffset?: MotionBoundsOffset | undefined;
    readonly initialMachinePosition?: Point | undefined;
    readonly defaultCutterRadiusMm?: number | undefined;
  } = {},
): ReadonlyArray<NoGoZoneCollision> {
  const bedRect = boundsRect(bed);
  const activeZones = zones
    .filter((zone) => zone.enabled)
    .map((zone) => ({ zone, rect: rectForZone(zone) }));
  if (activeZones.length === 0) return [];

  const offset = options.motionOffset ?? { x: 0, y: 0 };
  const collisions: NoGoZoneCollision[] = [];
  let current: Point | null = options.initialMachinePosition ?? null;
  let absolute = true;
  let motion: GcodeMotionMode | null = 0;
  let cutterRadiusMm = validRadius(options.defaultCutterRadiusMm);

  for (const [index, raw] of asGcodeLines(gcode).entries()) {
    cutterRadiusMm = cutterRadiusFromToolComment(raw) ?? cutterRadiusMm;
    const stripped = stripComment(raw);
    if (stripped === '') continue;
    absolute = absoluteModeAfterLine(stripped, absolute);
    const scanned = scanModalMotionLine(stripped, motion);
    motion = scanned.motion;
    if (!scanned.isMotion || motion === null) continue;
    const next = nextPoint(stripped, current, absolute, offset, motion);
    if (next === null) continue;
    appendCollision(
      collisions,
      current,
      next,
      stripped,
      motion,
      activeZones,
      bedRect,
      index + 1,
      cutterRadiusMm,
    );
    current = next;
  }

  return collisions;
}

function nextPoint(
  line: string,
  current: Point | null,
  absolute: boolean,
  offset: MotionBoundsOffset,
  motion: GcodeMotionMode,
): Point | null {
  const axes = parseAxes(line);
  if (axes.x === null && axes.y === null) {
    const completeArc =
      isArcMode(motion) && parseGcodeWord(line, 'I') !== null && parseGcodeWord(line, 'J') !== null;
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
  motion: GcodeMotionMode,
  activeZones: ReadonlyArray<ActiveZone>,
  bedRect: Rect,
  lineNumber: number,
  cutterRadiusMm: number,
): void {
  if (current === null) return;
  const hit = activeZones.find(({ rect }) => {
    const cutterEnvelope = expandRect(rect, cutterRadiusMm);
    return (
      rectsIntersect(cutterEnvelope, bedRect) &&
      motionIntersectsRect(current, next, line, motion, cutterEnvelope)
    );
  });
  if (hit !== undefined) {
    collisions.push({
      lineNumber,
      zone: hit.zone,
      ...(cutterRadiusMm > 0 ? { cutterRadiusMm } : {}),
    });
  }
}

function cutterRadiusFromToolComment(line: string): number | null {
  const match = /^\s*;\s*cnc tool:.*\bdiameter-mm:\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))/i.exec(line);
  if (match === null) return null;
  const diameterMm = Number(match[1]);
  return Number.isFinite(diameterMm) && diameterMm > 0 ? diameterMm / 2 : null;
}

function validRadius(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : 0;
}

function expandRect(rect: Rect, radiusMm: number): Rect {
  if (radiusMm <= 0) return rect;
  return {
    minX: rect.minX - radiusMm,
    minY: rect.minY - radiusMm,
    maxX: rect.maxX + radiusMm,
    maxY: rect.maxY + radiusMm,
  };
}

function motionIntersectsRect(
  current: Point,
  next: Point,
  line: string,
  motion: GcodeMotionMode,
  rect: Rect,
): boolean {
  if (!isArcMode(motion)) return segmentIntersectsRect(current, next, rect);
  const i = parseGcodeWord(line, 'I');
  const j = parseGcodeWord(line, 'J');
  if (i === null || j === null) return segmentIntersectsRect(current, next, rect);
  return arcIntersectsRect(current, next, i, j, motion === 2, rect);
}

function isArcMode(motion: GcodeMotionMode): boolean {
  return motion === 2 || motion === 3;
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
