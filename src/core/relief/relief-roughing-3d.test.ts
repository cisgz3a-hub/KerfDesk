import { describe, expect, it } from 'vitest';
import type { CncPass } from '../job';
import type { CncTool } from '../scene';
import type { Heightmap } from './heightmap';
import { reliefRoughingPasses } from './relief-roughing';

// Relief roughing keeps its stock allowance in 3D, on walls as well as floors
// (ADR-412), and leaves no uncut core when the stepover is wider than the
// cutter's reach (ADR-413).

const TOOL: CncTool = { id: 'em', name: '1/8 in end mill', kind: 'end-mill', diameterMm: 3.175 };
const RADIUS_MM = TOOL.diameterMm / 2;
const MM_PER_CELL = 0.4;

// A square pit `depthMm` deep whose rim is `pitMm` wide, centred in `sizeMm`
// of stock top. Its walls fall `wallSlope` mm per mm (Infinity: vertical).
function pitMap(sizeMm: number, pitMm: number, depthMm: number, wallSlope: number): Heightmap {
  const cells = Math.round(sizeMm / MM_PER_CELL);
  const lo = (sizeMm - pitMm) / 2;
  const hi = lo + pitMm;
  const depth = new Float32Array(cells * cells);
  for (let j = 0; j < cells; j += 1) {
    for (let i = 0; i < cells; i += 1) {
      const x = (i + 0.5) * MM_PER_CELL;
      const y = (j + 0.5) * MM_PER_CELL;
      const inside = Math.min(x - lo, hi - x, y - lo, hi - y);
      depth[j * cells + i] = inside > 0 ? -Math.min(depthMm, wallSlope * inside) : 0;
    }
  }
  return {
    widthCells: cells,
    heightCells: cells,
    widthMm: sizeMm,
    heightMm: sizeMm,
    mmPerCell: MM_PER_CELL,
    depth,
  };
}

type Point = { readonly x: number; readonly y: number };

// Vertices plus segment midpoints and quarter points of every contour pass.
function pathSamples(pass: CncPass): ReadonlyArray<Point> {
  if (pass.kind !== 'contour') return [];
  const out: Point[] = [];
  const points = pass.polyline;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[index + 1];
    if (a === undefined) continue;
    out.push(a);
    if (b === undefined) continue;
    for (const t of [0.25, 0.5, 0.75])
      out.push({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
  }
  return out;
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const length2 = ex * ex + ey * ey;
  const t =
    length2 > 0 ? Math.min(1, Math.max(0, ((p.x - a.x) * ex + (p.y - a.y) * ey) / length2)) : 0;
  return Math.hypot(p.x - a.x - t * ex, p.y - a.y - t * ey);
}

describe('relief roughing — stock allowance in 3D', () => {
  it('keeps a flat end mill the allowance away from a 70 degree wall', () => {
    const allowanceMm = 0.5;
    const map = pitMap(24, 16, 6, Math.tan((70 * Math.PI) / 180));
    const passes = reliefRoughingPasses(map, {
      tool: TOOL,
      reliefDepthMm: 6,
      depthPerPassMm: 0.3,
      stepoverPercent: 40,
      allowanceMm,
    });
    expect(passes.length).toBeGreaterThan(0);

    // Every model sample within the cutter radius plus the allowance of the
    // cutter axis must sit at least the allowance below the flat tip. Thin
    // levels put some ring right against the wall (a vertical-only allowance
    // measured 0.25 mm here, no allowance -0.55 mm).
    let worstMm = Number.POSITIVE_INFINITY;
    const reach = RADIUS_MM + allowanceMm;
    for (const pass of passes) {
      if (pass.kind !== 'contour') continue;
      for (const point of pathSamples(pass)) {
        const minI = Math.max(0, Math.floor((point.x - reach) / MM_PER_CELL));
        const maxI = Math.min(map.widthCells - 1, Math.ceil((point.x + reach) / MM_PER_CELL));
        const minJ = Math.max(0, Math.floor((point.y - reach) / MM_PER_CELL));
        const maxJ = Math.min(map.heightCells - 1, Math.ceil((point.y + reach) / MM_PER_CELL));
        for (let j = minJ; j <= maxJ; j += 1) {
          for (let i = minI; i <= maxI; i += 1) {
            const distance = Math.hypot(
              (i + 0.5) * MM_PER_CELL - point.x,
              (j + 0.5) * MM_PER_CELL - point.y,
            );
            if (distance > reach) continue;
            worstMm = Math.min(worstMm, pass.zMm - (map.depth[j * map.widthCells + i] ?? 0));
          }
        }
      }
    }
    expect(worstMm).toBeGreaterThanOrEqual(allowanceMm - 1e-6);
  });
});

describe('relief roughing — uncut cores at a wide stepover', () => {
  const BALL: CncTool = {
    id: 'bn',
    name: '1/8 in ball nose',
    kind: 'ball-nose',
    diameterMm: 3.175,
  };
  // A ball clears a 0.5 mm slice only within sqrt(2 R h - h^2) of its path.
  const ballReach = Math.sqrt(2 * RADIUS_MM * 0.5 - 0.25);

  it.each([
    { tool: TOOL, stepover: 75, slice: 1, reach: RADIUS_MM },
    { tool: TOOL, stepover: 90, slice: 1, reach: RADIUS_MM },
    { tool: BALL, stepover: 45, slice: 0.5, reach: ballReach },
  ])(
    'reaches every deep point of a pit floor: $tool.kind at $stepover percent',
    ({ tool, stepover, slice, reach }) => {
      const map = pitMap(40, 30, 3, Number.POSITIVE_INFINITY);
      const passes = reliefRoughingPasses(map, {
        tool,
        reliefDepthMm: 3,
        depthPerPassMm: slice,
        stepoverPercent: stepover,
        allowanceMm: 0,
      });
      const deepest = passes.filter((pass) => pass.kind === 'contour' && pass.zMm === -3);
      expect(deepest.length).toBeGreaterThan(0);

      // Floor samples well inside the pit are tool-center positions at the last
      // level: each must be within the cutter's reach of that level's path.
      const lo = 5 + RADIUS_MM + 1;
      const hi = 35 - RADIUS_MM - 1;
      let worstMm = 0;
      for (let y = lo; y <= hi; y += MM_PER_CELL) {
        for (let x = lo; x <= hi; x += MM_PER_CELL) {
          let nearest = Number.POSITIVE_INFINITY;
          for (const pass of deepest) {
            if (pass.kind !== 'contour') continue;
            const points = pass.polyline;
            for (let index = 0; index + 1 < points.length; index += 1) {
              const a = points[index];
              const b = points[index + 1];
              if (a === undefined || b === undefined) continue;
              nearest = Math.min(nearest, distanceToSegment({ x, y }, a, b));
            }
          }
          worstMm = Math.max(worstMm, nearest);
        }
      }
      expect(worstMm).toBeLessThanOrEqual(reach + 1e-6);
    },
  );
});
