import type { NoGoZone } from '../devices';
import type { MotionBoundsOffset } from '../invariants';

type MotionPoint = {
  readonly x: number;
  readonly y: number;
};

export function findNoGoZoneCollisions(
  gcode: string,
  zones: ReadonlyArray<NoGoZone>,
  offset: MotionBoundsOffset,
): ReadonlyArray<{ readonly lineNumber: number; readonly zone: NoGoZone }> {
  const issues: Array<{ readonly lineNumber: number; readonly zone: NoGoZone }> = [];
  let current: MotionPoint | null = null;
  const lines = gcode.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const next = parseNoGoMotionLine(lines[i], current, offset);
    if (next === null) continue;
    const hit = zones.find((zone) =>
      current === null ? pointInZone(next, zone) : segmentIntersectsZone(current, next, zone),
    );
    if (hit !== undefined) issues.push({ lineNumber: i + 1, zone: hit });
    current = next;
  }
  return issues;
}

function parseNoGoMotionLine(
  raw: string | undefined,
  current: MotionPoint | null,
  offset: MotionBoundsOffset,
): MotionPoint | null {
  if (raw === undefined) return null;
  const stripped = raw.split(';', 1)[0]?.trim() ?? '';
  if (!/^G[0123]\b/.test(stripped)) return null;
  const parsedX = parseMotionAxis(stripped, 'X');
  const parsedY = parseMotionAxis(stripped, 'Y');
  if (parsedX === null && parsedY === null) return null;
  const baseX: number = parsedX ?? (current === null ? 0 : current.x);
  const baseY: number = parsedY ?? (current === null ? 0 : current.y);
  return { x: baseX + offset.x, y: baseY + offset.y };
}

function pointInZone(point: MotionPoint, zone: NoGoZone): boolean {
  return (
    point.x >= zone.x &&
    point.x <= zone.x + zone.width &&
    point.y >= zone.y &&
    point.y <= zone.y + zone.height
  );
}

function segmentIntersectsZone(
  a: MotionPoint,
  b: MotionPoint,
  zone: NoGoZone,
): boolean {
  if (pointInZone(a, zone) || pointInZone(b, zone)) return true;
  const left = zone.x;
  const right = zone.x + zone.width;
  const top = zone.y;
  const bottom = zone.y + zone.height;
  return (
    segmentsIntersect(a, b, { x: left, y: top }, { x: right, y: top }) ||
    segmentsIntersect(a, b, { x: right, y: top }, { x: right, y: bottom }) ||
    segmentsIntersect(a, b, { x: right, y: bottom }, { x: left, y: bottom }) ||
    segmentsIntersect(a, b, { x: left, y: bottom }, { x: left, y: top })
  );
}

function segmentsIntersect(
  a: MotionPoint,
  b: MotionPoint,
  c: MotionPoint,
  d: MotionPoint,
): boolean {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  if (o1 === 0 && onSegment(a, c, b)) return true;
  if (o2 === 0 && onSegment(a, d, b)) return true;
  if (o3 === 0 && onSegment(c, a, d)) return true;
  if (o4 === 0 && onSegment(c, b, d)) return true;
  return o1 !== o2 && o3 !== o4;
}

function orientation(
  a: MotionPoint,
  b: MotionPoint,
  c: MotionPoint,
): -1 | 0 | 1 {
  const value = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
  if (Math.abs(value) < 1e-9) return 0;
  return value > 0 ? 1 : -1;
}

function onSegment(
  a: MotionPoint,
  b: MotionPoint,
  c: MotionPoint,
): boolean {
  return (
    b.x <= Math.max(a.x, c.x) &&
    b.x >= Math.min(a.x, c.x) &&
    b.y <= Math.max(a.y, c.y) &&
    b.y >= Math.min(a.y, c.y)
  );
}

function parseMotionAxis(line: string, axis: 'X' | 'Y'): number | null {
  const match = new RegExp(String.raw`\b${axis}(-?\d+(?:\.\d+)?)`).exec(line);
  return match?.[1] === undefined ? null : Number.parseFloat(match[1]);
}
