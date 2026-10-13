// Bezier pen geometry (LightBurn Draw Lines: click for a corner, click and
// drag for a curve node). A dragged vertex carries an outgoing handle; its
// incoming handle mirrors it through the vertex, so the node is smooth. A
// segment between two plain vertices stays a straight line; any handle at
// either end makes it a cubic, so the drawn path is exact, not fitted.

import type { CurveSubpath, PathSegment, Vec2 } from '../../core/scene';

/** The pen's exact contour from its vertices and their outgoing handles. */
export function penContour(
  vertices: ReadonlyArray<Vec2>,
  handles: ReadonlyArray<Vec2 | null | undefined>,
  closed: boolean,
): CurveSubpath | null {
  const first = vertices[0];
  if (first === undefined || vertices.length < 2) return null;
  const segments: PathSegment[] = [];
  const count = closed ? vertices.length : vertices.length - 1;
  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % vertices.length;
    segments.push(penSegment(vertices, handles, index, next));
  }
  return { start: first, segments, closed };
}

/** True when any vertex was dragged into a curve node. */
export function penHasHandles(
  handles: ReadonlyArray<Vec2 | null | undefined> | undefined,
): boolean {
  return (handles ?? []).some((handle) => handle !== null && handle !== undefined);
}

function penSegment(
  vertices: ReadonlyArray<Vec2>,
  handles: ReadonlyArray<Vec2 | null | undefined>,
  from: number,
  to: number,
): PathSegment {
  const start = vertices[from] as Vec2;
  const end = vertices[to] as Vec2;
  const out = handles[from] ?? null;
  const into = handles[to] ?? null;
  if (out === null && into === null) return { kind: 'line', to: end };
  return {
    kind: 'cubic',
    control1: out ?? start,
    control2: into === null ? end : { x: 2 * end.x - into.x, y: 2 * end.y - into.y },
    to: end,
  };
}
