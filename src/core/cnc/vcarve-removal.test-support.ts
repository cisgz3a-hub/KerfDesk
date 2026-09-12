import type { Vec3 } from '../geometry/vec3';
import type { Polyline, Vec2 } from '../scene';

export type RemovalChord = readonly [Vec3, Vec3];

// Independent audit oracle: no production simulator, radial-envelope helpers,
// boundary indexes, capsule predicates or reference-graph certificates.
export function emittedFeedChords(program: string): RemovalChord[] {
  let position: Vec3 = { x: 0, y: 0, z: 0 };
  let mode = 0;
  const chords: RemovalChord[] = [];
  for (const raw of program.split('\n')) {
    const line = raw.replace(/;.*$/, '');
    const motion = /(?:^|\s)G0?([01])(?=[^\d.]|$)/.exec(line);
    if (motion !== null) mode = Number(motion[1]);
    const words = [...line.matchAll(/([XYZ])([-+]?\d+(?:\.\d+)?)/g)];
    if (words.length === 0) continue;
    const next = { ...position };
    for (const word of words) {
      if (word[1] !== undefined) next[word[1].toLowerCase() as 'x' | 'y' | 'z'] = Number(word[2]);
    }
    if (mode === 1 && (position.z < 0 || next.z < 0)) chords.push([position, next]);
    position = next;
  }
  return chords;
}

export function minimumConvex(fn: (t: number) => number): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 36; i += 1) {
    const a = lo + (hi - lo) / 3;
    const b = hi - (hi - lo) / 3;
    if (fn(a) < fn(b)) hi = b;
    else lo = a;
  }
  return Math.min(fn(0), fn(1), fn((lo + hi) / 2));
}

export function pointOnChord([a, b]: RemovalChord, t: number): Vec3 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

export function distanceToLine(point: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
}

export function sourceEdges(loops: ReadonlyArray<Polyline>): Array<readonly [Vec2, Vec2]> {
  return loops.flatMap((loop) =>
    loop.points.flatMap((a, i) => {
      const b = loop.points[(i + 1) % loop.points.length];
      return b === undefined ? [] : [[a, b] as const];
    }),
  );
}

export function sourceContains(point: Vec2, loops: ReadonlyArray<Polyline>): boolean {
  let inside = false;
  for (const [a, b] of sourceEdges(loops)) {
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < a.x + ((point.y - a.y) * (b.x - a.x)) / (b.y - a.y)
    )
      inside = !inside;
  }
  return inside;
}

export function coneRemovedDepth(
  point: Vec2,
  chords: ReadonlyArray<RemovalChord>,
  angleDeg: number,
  tipDiameterMm = 0,
): number {
  const halfAngle = (angleDeg * Math.PI) / 360;
  const slope = Math.sin(halfAngle) / Math.cos(halfAngle);
  let removed = 0;
  for (const chord of chords) {
    const [a, b] = chord;
    if (Math.max(-a.z, -b.z) <= removed) continue;
    const candidate =
      a.z === b.z
        ? -a.z - Math.max(0, distanceToLine(point, a, b) - tipDiameterMm / 2) / slope
        : -minimumConvex((t) => {
            const p = pointOnChord(chord, t);
            return (
              p.z +
              Math.max(0, Math.hypot(point.x - p.x, point.y - p.y) - tipDiameterMm / 2) / slope
            );
          });
    removed = Math.max(removed, candidate);
  }
  return removed;
}

export function flatRemovedDepth(
  point: Vec2,
  chords: ReadonlyArray<RemovalChord>,
  diameterMm: number,
): number {
  let removed = 0;
  for (const [a, b] of chords) {
    // Clearing contours are constant Z; include a plunge's final cutter disk.
    if (a.z === b.z && distanceToLine(point, a, b) <= diameterMm / 2)
      removed = Math.max(removed, -a.z);
    if (Math.hypot(point.x - b.x, point.y - b.y) <= diameterMm / 2)
      removed = Math.max(removed, -b.z);
  }
  return removed;
}

export function cuttingXyLength(chords: ReadonlyArray<RemovalChord>): number {
  return chords.reduce((total, [a, b]) => total + Math.hypot(b.x - a.x, b.y - a.y), 0);
}
