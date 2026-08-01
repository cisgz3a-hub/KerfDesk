// disc-stamp — stamps a round cutter footprint into the depth grid, and walks
// polylines stamping as it goes. This is the preview's flat-bottom cutter
// approximation for slots (profile, engrave) and drills; pockets and v-carves
// use masks and the distance transform instead.

import type { Polyline, Vec2 } from '../scene';
import type { CarveGrid } from './carve-input';

/** Deepens every cell within `radiusMm` of the point (depths are <= 0). */
export function stampDisc(
  depth: Float32Array,
  grid: CarveGrid,
  center: Vec2,
  radiusMm: number,
  depthValueMm: number,
): void {
  const cellRadius = Math.max(0, Math.ceil(radiusMm / grid.mmPerCell - 0.5));
  const cxCenter = Math.round((center.x - grid.originX) / grid.mmPerCell - 0.5);
  const cyCenter = Math.round((center.y - grid.originY) / grid.mmPerCell - 0.5);
  const radiusSq = radiusMm * radiusMm;
  for (let dy = -cellRadius; dy <= cellRadius; dy += 1) {
    const cy = cyCenter + dy;
    if (cy < 0 || cy >= grid.heightCells) continue;
    const yMm = grid.originY + (cy + 0.5) * grid.mmPerCell - center.y;
    for (let dx = -cellRadius; dx <= cellRadius; dx += 1) {
      const cx = cxCenter + dx;
      if (cx < 0 || cx >= grid.widthCells) continue;
      const xMm = grid.originX + (cx + 0.5) * grid.mmPerCell - center.x;
      if (xMm * xMm + yMm * yMm > radiusSq) continue;
      const index = cy * grid.widthCells + cx;
      const current = depth[index] ?? 0;
      if (depthValueMm < current) depth[index] = depthValueMm;
    }
  }
}

/**
 * Stamps the cutter along every segment of every polyline (a closed polyline
 * includes its seam segment). Sample spacing under one cell keeps the slot
 * wall continuous without visible scalloping at preview resolution.
 */
export function stampAlongPolylines(
  depth: Float32Array,
  grid: CarveGrid,
  polylines: ReadonlyArray<Polyline>,
  radiusMm: number,
  depthValueMm: number,
): void {
  const stepMm = grid.mmPerCell * 0.75;
  for (const polyline of polylines) {
    const points = polyline.points;
    if (points.length === 0) continue;
    const segmentCount = polyline.closed ? points.length : points.length - 1;
    for (let i = 0; i < segmentCount; i += 1) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      if (a === undefined || b === undefined) continue;
      stampSegment(depth, grid, a, b, radiusMm, depthValueMm, stepMm);
    }
    const first = points[0];
    if (first !== undefined) stampDisc(depth, grid, first, radiusMm, depthValueMm);
  }
}

function stampSegment(
  depth: Float32Array,
  grid: CarveGrid,
  a: Vec2,
  b: Vec2,
  radiusMm: number,
  depthValueMm: number,
  stepMm: number,
): void {
  const lengthMm = Math.hypot(b.x - a.x, b.y - a.y);
  const steps = Math.max(1, Math.ceil(lengthMm / stepMm));
  for (let step = 1; step <= steps; step += 1) {
    const t = step / steps;
    const point = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    stampDisc(depth, grid, point, radiusMm, depthValueMm);
  }
}
