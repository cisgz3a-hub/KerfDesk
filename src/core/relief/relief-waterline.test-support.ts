// Test maps and a wall-reach measure for the waterline tests (ADR-423).
import type { CncPass } from '../job';
import type { CncTool } from '../scene';
import { kernelForTool, type ToolKernel } from '../sim';
import type { Heightmap } from './heightmap';
import { createSurfaceContactField } from './heightmap-surface-contact';
import type { WaterlineSurface } from './relief-waterline-contours';

export const BALL: CncTool = { id: 'ball', name: 'ball', kind: 'ball-nose', diameterMm: 3.175 };
export const CELL_MM = 0.28;
const PROBE_DIRECTIONS = 16;

export function sampledMap(cells: number, depthAt: (x: number, y: number) => number): Heightmap {
  const depth = new Float32Array(cells * cells);
  for (let j = 0; j < cells; j += 1) {
    for (let i = 0; i < cells; i += 1)
      depth[j * cells + i] = depthAt((i + 0.5) * CELL_MM, (j + 0.5) * CELL_MM);
  }
  return {
    widthCells: cells,
    heightCells: cells,
    widthMm: cells * CELL_MM,
    heightMm: cells * CELL_MM,
    mmPerCell: CELL_MM,
    depth,
  };
}

// A 10 mm square plateau 5 mm proud of the floor, with vertical walls.
export function plateauMap(): Heightmap {
  return sampledMap(100, (x, y) => (Math.abs(x - 14) < 5 && Math.abs(y - 14) < 5 ? -1 : -6));
}

// A round boss with 70 degree walls from a 4 mm radius top at -1 to the floor.
export function coneMap(): Heightmap {
  const slope = Math.tan((70 * Math.PI) / 180);
  return sampledMap(100, (x, y) =>
    Math.max(-6, -1 - slope * Math.max(0, Math.hypot(x - 14, y - 14) - 4)),
  );
}

export function exactSurface(map: Heightmap, kernel: ToolKernel): WaterlineSurface {
  const field = createSurfaceContactField(map, kernel);
  if (field === null) throw new Error('expected a contact field');
  return {
    clears: (x, y, z) => field.constraintAtPoint(x, y, z) <= z + 1e-6,
    tipAt: (x, y) => field.constraintAtPoint(x, y, Number.NEGATIVE_INFINITY),
  };
}

export function ballKernel(): ToolKernel {
  return kernelForTool(BALL, CELL_MM);
}

// The ball centre on plateauMap's face x = 9 when its tip is at z: the
// sampled face is the facet from the last floor sample (8.82, -6) to the first
// plateau sample (9.1, -1), and the ball rests on it at distance r from its
// line.
export function plateauFaceCentreX(z: number): number {
  const r = BALL.diameterMm / 2;
  const m = 5 / CELL_MM;
  return 8.82 + (z + r + 6 - r * Math.hypot(1, m)) / m;
}

/**
 * Whether some point of the passes (every 0.02 mm) reaches into the model by
 * more than `limitMm`: its tip does not clear the model where it stands, nor
 * anywhere `limitMm` away from it in XY (probed in 16 directions, which can
 * only overstate the reach).
 */
export function reachesIntoWall(
  passes: ReadonlyArray<CncPass>,
  surface: WaterlineSurface,
  limitMm: number,
): boolean {
  const clearsNear = (x: number, y: number, z: number): boolean => {
    if (surface.clears(x, y, z)) return true;
    for (let k = 0; k < PROBE_DIRECTIONS; k += 1) {
      const angle = (2 * Math.PI * k) / PROBE_DIRECTIONS;
      if (surface.clears(x + limitMm * Math.cos(angle), y + limitMm * Math.sin(angle), z)) {
        return true;
      }
    }
    return false;
  };
  for (const pass of passes) {
    if (pass.kind !== 'path3d') continue;
    for (let k = 1; k < pass.points.length; k += 1) {
      const a = pass.points[k - 1];
      const b = pass.points[k];
      if (a === undefined || b === undefined) continue;
      const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.02));
      for (let step = 0; step <= steps; step += 1) {
        const t = step / steps;
        const x = a.x + t * (b.x - a.x);
        const y = a.y + t * (b.y - a.y);
        if (!clearsNear(x, y, a.z + t * (b.z - a.z))) return true;
      }
    }
  }
  return false;
}
