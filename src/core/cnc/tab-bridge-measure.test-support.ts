// Test helpers that measure holding tabs from an EMITTED program, sharing no
// code with the tab planner (ADR-258 Amendment 5, CNC audit v3 N1).
//
// A flat end mill fed below the tab top clears a capsule: its centre segment
// widened by the cutter radius. Capsules closer than one cut width overlap, so
// the cuts below the tab top fall into through-cut pieces that only tabs
// separate. One piece means the loop was cut free; the narrowest gap between
// two pieces is the narrowest bridge left standing, the auditor's measure.

export type Point3 = { readonly x: number; readonly y: number; readonly z: number };
export type FeedSegment = { readonly a: Point3; readonly b: Point3 };
export type Box = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

const EPS = 1e-6;
const ARC_CHORD_RAD = Math.PI / 90;

/** Every fed move (G1/G2/G3) of an absolute, millimetre program. */
export function feedSegments(gcode: string): ReadonlyArray<FeedSegment> {
  let head: Point3 = { x: 0, y: 0, z: 0 };
  let mode = 0;
  const segments: FeedSegment[] = [];
  for (const raw of gcode.split('\n')) {
    const line = raw.replace(/;.*$/, '').replace(/\(.*?\)/g, '');
    const g = /\bG0*([0-3])(?![0-9.])/.exec(line);
    if (g !== null) mode = Number(g[1]);
    const to = targetOf(line, head);
    if (to.x === head.x && to.y === head.y && to.z === head.z) continue;
    if (mode === 1) segments.push({ a: head, b: to });
    if (mode === 2 || mode === 3) {
      segments.push(
        ...arcSegments(head, to, wordOf(line, 'I') ?? 0, wordOf(line, 'J') ?? 0, mode === 2),
      );
    }
    head = to;
  }
  return segments;
}

function wordOf(line: string, axis: string): number | undefined {
  const match = new RegExp(`\\b${axis}(-?[0-9.]+)`).exec(line);
  return match === null ? undefined : Number(match[1]);
}

function targetOf(line: string, head: Point3): Point3 {
  return {
    x: wordOf(line, 'X') ?? head.x,
    y: wordOf(line, 'Y') ?? head.y,
    z: wordOf(line, 'Z') ?? head.z,
  };
}

function arcSegments(from: Point3, to: Point3, i: number, j: number, clockwise: boolean) {
  const center = { x: from.x + i, y: from.y + j };
  const radius = Math.hypot(i, j);
  const start = Math.atan2(from.y - center.y, from.x - center.x);
  let sweep = Math.atan2(to.y - center.y, to.x - center.x) - start;
  if (clockwise && sweep >= 0) sweep -= Math.PI * 2;
  if (!clockwise && sweep <= 0) sweep += Math.PI * 2;
  const steps = Math.max(1, Math.ceil(Math.abs(sweep) / ARC_CHORD_RAD));
  const out: FeedSegment[] = [];
  let previous = from;
  for (let step = 1; step <= steps; step += 1) {
    const angle = start + (sweep * step) / steps;
    const next =
      step === steps
        ? to
        : {
            x: center.x + radius * Math.cos(angle),
            y: center.y + radius * Math.sin(angle),
            z: from.z + ((to.z - from.z) * step) / steps,
          };
    out.push({ a: previous, b: next });
    previous = next;
  }
  return out;
}

/** The deepest Z the program feeds to with the cutter centre inside `box`. */
export function deepestZWithin(segments: ReadonlyArray<FeedSegment>, box: Box): number {
  let deepest = Infinity;
  for (const { a, b } of segments) {
    for (const point of [a, b]) {
      if (
        point.x >= box.minX &&
        point.x <= box.maxX &&
        point.y >= box.minY &&
        point.y <= box.maxY
      ) {
        deepest = Math.min(deepest, point.z);
      }
    }
  }
  return deepest;
}

export type ThroughCut = {
  /** Separate through-cut pieces: one per tab on a loop; one means cut free. */
  readonly pieces: number;
  /** The narrowest bridge between two pieces, mm (Infinity with one piece). */
  readonly narrowestBridgeMm: number;
};

/** Through-cut pieces of the cuts fed below `tabTopZ` with centres in `box`. */
export function throughCut(
  segments: ReadonlyArray<FeedSegment>,
  tabTopZ: number,
  cutWidthMm: number,
  box: Box,
): ThroughCut {
  const inside = (point: Point3) =>
    point.x >= box.minX && point.x <= box.maxX && point.y >= box.minY && point.y <= box.maxY;
  const deep = segments.filter(
    ({ a, b }) => a.z < tabTopZ - EPS && b.z < tabTopZ - EPS && inside(a) && inside(b),
  );
  const parent = deep.map((_, index) => index);
  const find = (index: number): number => {
    let root = index;
    while (parent[root] !== root) root = parent[root] as number;
    parent[index] = root;
    return root;
  };
  for (let i = 0; i < deep.length; i += 1) {
    for (let j = i + 1; j < deep.length; j += 1) {
      if (segmentDistance(deep[i] as FeedSegment, deep[j] as FeedSegment) < cutWidthMm - EPS) {
        parent[find(i)] = find(j);
      }
    }
  }
  const roots = new Set(deep.map((_, index) => find(index)));
  let narrowest = Infinity;
  for (let i = 0; i < deep.length; i += 1) {
    for (let j = i + 1; j < deep.length; j += 1) {
      if (find(i) === find(j)) continue;
      const gap = segmentDistance(deep[i] as FeedSegment, deep[j] as FeedSegment) - cutWidthMm;
      narrowest = Math.min(narrowest, gap);
    }
  }
  return { pieces: roots.size, narrowestBridgeMm: narrowest };
}

function segmentDistance(s: FeedSegment, t: FeedSegment): number {
  if (segmentsCross(s, t)) return 0;
  return Math.min(
    pointToSegment(s.a, t),
    pointToSegment(s.b, t),
    pointToSegment(t.a, s),
    pointToSegment(t.b, s),
  );
}

function pointToSegment(p: Point3, s: FeedSegment): number {
  const dx = s.b.x - s.a.x;
  const dy = s.b.y - s.a.y;
  const lengthSq = dx * dx + dy * dy;
  const t =
    lengthSq <= 0
      ? 0
      : Math.max(0, Math.min(1, ((p.x - s.a.x) * dx + (p.y - s.a.y) * dy) / lengthSq));
  return Math.hypot(p.x - (s.a.x + dx * t), p.y - (s.a.y + dy * t));
}

function segmentsCross(s: FeedSegment, t: FeedSegment): boolean {
  const cross = (o: Point3, a: Point3, b: Point3) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const d1 = cross(t.a, t.b, s.a);
  const d2 = cross(t.a, t.b, s.b);
  const d3 = cross(s.a, s.b, t.a);
  const d4 = cross(s.a, s.b, t.b);
  return d1 * d2 < 0 && d3 * d4 < 0;
}
