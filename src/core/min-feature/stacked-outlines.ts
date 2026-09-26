// Stacked copies of a closed outline for the minimum-feature check (ADR-408).
// Imports often carry the same outline twice. The cut is the same line cut
// again, but filled even-odd the copy cancels its twin and turns one part into
// a phantom gap, so the check keeps only the first copy. Only exact copies
// count: the same vertices from any start, running either way round.

import type { Vec2 } from '../scene';

function before(a: Vec2, b: Vec2): boolean {
  return a.x < b.x || (a.x === b.x && a.y < b.y);
}

function lowestVertex(vertices: ReadonlyArray<Vec2>): number {
  let lowest = 0;
  vertices.forEach((vertex, i) => {
    if (before(vertex, vertices[lowest] as Vec2)) lowest = i;
  });
  return lowest;
}

/** The same closed outline whatever vertex it starts at and whichever way
 * it runs, so stacked copies compare equal. */
function outlineKey(vertices: ReadonlyArray<Vec2>): string {
  const start = lowestVertex(vertices);
  const n = vertices.length;
  const at = (i: number): Vec2 => vertices[((i % n) + n) % n] as Vec2;
  const step = before(at(start + 1), at(start - 1)) ? 1 : -1;
  const parts: string[] = [];
  for (let k = 0; k < n; k += 1) {
    const vertex = at(start + step * k);
    parts.push(`${vertex.x},${vertex.y}`);
  }
  return parts.join(';');
}

/** Finds closed outlines stacked exactly on an earlier one. Outlines are
 * bucketed by vertex count and lowest vertex, so the full key is built only
 * when two outlines share both. */
export class StackedOutlines {
  private readonly byAnchor = new Map<
    string,
    Array<{ readonly vertices: ReadonlyArray<Vec2>; key?: string }>
  >();

  /** True when an earlier outline had exactly these (distinct, consecutive)
   * vertices; otherwise remembers this one. */
  isCopy(vertices: ReadonlyArray<Vec2>): boolean {
    const lowest = vertices[lowestVertex(vertices)];
    const anchor = `${vertices.length}|${lowest?.x},${lowest?.y}`;
    const earlier = this.byAnchor.get(anchor);
    if (earlier === undefined) {
      this.byAnchor.set(anchor, [{ vertices }]);
      return false;
    }
    const key = outlineKey(vertices);
    for (const entry of earlier) {
      entry.key ??= outlineKey(entry.vertices);
      if (entry.key === key) return true;
    }
    earlier.push({ vertices, key });
    return false;
  }
}
