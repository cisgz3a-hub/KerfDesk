import type { Vec2 } from '../scene';

// Exact retracing needs no offset tolerance: the same bit has already swept
// these centre lines. Index identical edges so dense repeated rings stay linear.
export class ReliefCutPathCoverage {
  private readonly edges: Array<readonly [Vec2, Vec2]> = [];
  private readonly exact = new Set<string>();

  add(path: ReadonlyArray<Vec2>): void {
    for (let index = 1; index < path.length; index += 1) {
      const a = path[index - 1];
      const b = path[index];
      if (a === undefined || b === undefined) continue;
      this.edges.push([a, b]);
      this.exact.add(edgeKey(a, b));
    }
    if (path.length === 1 && path[0] !== undefined) {
      this.edges.push([path[0], path[0]]);
    }
  }

  covers(path: ReadonlyArray<Vec2>): boolean {
    const first = path[0];
    if (first === undefined) return false;
    if (path.length === 1) return this.coversEdge(first, first);
    for (let index = 1; index < path.length; index += 1) {
      const a = path[index - 1];
      const b = path[index];
      if (a === undefined || b === undefined || !this.coversEdge(a, b)) return false;
    }
    return true;
  }

  private coversEdge(a: Vec2, b: Vec2): boolean {
    if (this.exact.has(edgeKey(a, b))) return true;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length2 = dx * dx + dy * dy;
    if (length2 === 0) return this.edges.some(([c, d]) => pointOnSegment(a, c, d));
    const spans: Array<readonly [number, number]> = [];
    for (const [c, d] of this.edges) {
      if (cross(a, b, c) !== 0 || cross(a, b, d) !== 0) continue;
      const tc = ((c.x - a.x) * dx + (c.y - a.y) * dy) / length2;
      const td = ((d.x - a.x) * dx + (d.y - a.y) * dy) / length2;
      spans.push([Math.min(tc, td), Math.max(tc, td)]);
    }
    spans.sort((left, right) => left[0] - right[0]);
    let reach = 0;
    for (const [start, end] of spans) {
      if (start > reach) return false;
      reach = Math.max(reach, end);
      if (reach >= 1) return true;
    }
    return false;
  }
}

function edgeKey(a: Vec2, b: Vec2): string {
  const first = `${a.x},${a.y}`;
  const last = `${b.x},${b.y}`;
  return first < last ? `${first}:${last}` : `${last}:${first}`;
}

function cross(a: Vec2, b: Vec2, point: Vec2): number {
  return (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
}

function pointOnSegment(point: Vec2, a: Vec2, b: Vec2): boolean {
  return (
    cross(a, b, point) === 0 &&
    point.x >= Math.min(a.x, b.x) &&
    point.x <= Math.max(a.x, b.x) &&
    point.y >= Math.min(a.y, b.y) &&
    point.y <= Math.max(a.y, b.y)
  );
}
