export type CncReachPoint = { readonly x: number; readonly y: number; readonly z: number };
export type CncReachFixture = {
  readonly id: string;
  readonly name: string;
  readonly xMm: number;
  readonly yMm: number;
  readonly widthMm: number;
  readonly heightMm: number;
  readonly bottomZMm: number;
  readonly topZMm: number;
};
export type CncReachEnvelope = {
  readonly component: 'cutter' | 'shank' | 'holder';
  readonly name: string;
  readonly startMm: number;
  readonly lengthMm: number;
  readonly diameterMm: number;
};

/** Exact intersection for a vertical cylinder translated on a linear XYZ segment. */
export function reachEnvelopeIntersectsFixture(
  from: CncReachPoint,
  to: CncReachPoint,
  envelope: CncReachEnvelope,
  fixture: CncReachFixture,
  toleranceMm = 0,
): boolean {
  const interval = zInterval(
    from.z,
    to.z,
    fixture.bottomZMm - envelope.startMm - envelope.lengthMm,
    fixture.topZMm - envelope.startMm,
  );
  if (interval === null) return false;
  const a = pointAt(from, to, interval[0]);
  const b = pointAt(from, to, interval[1]);
  return (
    segmentRectangleDistanceSquared(a, b, fixture) <= (envelope.diameterMm / 2 + toleranceMm) ** 2
  );
}

function zInterval(
  from: number,
  to: number,
  min: number,
  max: number,
): readonly [number, number] | null {
  if (from === to) return from >= min && from <= max ? [0, 1] : null;
  const t1 = (min - from) / (to - from);
  const t2 = (max - from) / (to - from);
  const start = Math.max(0, Math.min(t1, t2));
  const end = Math.min(1, Math.max(t1, t2));
  return start <= end ? [start, end] : null;
}
function pointAt(a: CncReachPoint, b: CncReachPoint, t: number): CncReachPoint {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}
function segmentRectangleDistanceSquared(
  a: CncReachPoint,
  b: CncReachPoint,
  f: CncReachFixture,
): number {
  const x1 = f.xMm,
    x2 = x1 + f.widthMm,
    y1 = f.yMm,
    y2 = y1 + f.heightMm;
  if (segmentCrossesRectangle(a, b, x1, x2, y1, y2)) return 0;
  return Math.min(
    pointRectangleDistanceSquared(a, x1, x2, y1, y2),
    pointRectangleDistanceSquared(b, x1, x2, y1, y2),
    ...[
      [x1, y1],
      [x1, y2],
      [x2, y1],
      [x2, y2],
    ].map(([x = 0, y = 0]) => pointSegmentDistanceSquared(x, y, a, b)),
  );
}
function segmentCrossesRectangle(
  a: CncReachPoint,
  b: CncReachPoint,
  x1: number,
  x2: number,
  y1: number,
  y2: number,
): boolean {
  const x = axisInterval(a.x, b.x, x1, x2);
  const y = axisInterval(a.y, b.y, y1, y2);
  return x !== null && y !== null && Math.max(x[0], y[0]) <= Math.min(x[1], y[1]);
}
function axisInterval(
  a: number,
  b: number,
  min: number,
  max: number,
): readonly [number, number] | null {
  return zInterval(a, b, min, max);
}
function pointRectangleDistanceSquared(
  p: CncReachPoint,
  x1: number,
  x2: number,
  y1: number,
  y2: number,
): number {
  return Math.max(x1 - p.x, 0, p.x - x2) ** 2 + Math.max(y1 - p.y, 0, p.y - y2) ** 2;
}
function pointSegmentDistanceSquared(
  x: number,
  y: number,
  a: CncReachPoint,
  b: CncReachPoint,
): number {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t =
    lengthSq === 0 ? 0 : Math.min(1, Math.max(0, ((x - a.x) * dx + (y - a.y) * dy) / lengthSq));
  return (x - a.x - t * dx) ** 2 + (y - a.y - t * dy) ** 2;
}
