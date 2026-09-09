import type { Vec2 } from '../../scene';

/** Check every pixel interior crossed by a new segment. Subdividing at grid
 * lines avoids jumping across a small white corner between fixed samples. */
export function segmentInsideInk(a: Vec2, b: Vec2, distSq: Float64Array, width: number): boolean {
  if (!pointInsideInk(a, distSq, width) || !pointInsideInk(b, distSq, width)) return false;
  const breaks = [0, 1];
  addGridCrossings(breaks, a.x, b.x);
  addGridCrossings(breaks, a.y, b.y);
  breaks.sort((x, y) => x - y);
  for (let i = 1; i < breaks.length; i += 1) {
    const lower = breaks[i - 1] ?? 0;
    const upper = breaks[i] ?? 1;
    if (upper - lower < 1e-12) continue; // a grid-corner touch crosses no cell interior
    const t = (lower + upper) / 2;
    if (!pointInsideInk({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) }, distSq, width))
      return false;
  }
  return true;
}

function pointInsideInk(p: Vec2, distSq: Float64Array, width: number): boolean {
  const x = Math.floor(p.x);
  const y = Math.floor(p.y);
  const height = width > 0 ? Math.floor(distSq.length / width) : 0;
  return x >= 0 && y >= 0 && x < width && y < height && (distSq[y * width + x] ?? 0) > 0;
}

function addGridCrossings(breaks: number[], a: number, b: number): void {
  if (a === b) return;
  for (let edge = Math.floor(Math.min(a, b)) + 1; edge < Math.max(a, b); edge += 1) {
    breaks.push((edge - a) / (b - a));
  }
}
