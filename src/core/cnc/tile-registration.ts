import type { CncGroup, CncPass, Job } from '../job';
import type { Vec2 } from '../scene';
import type { CncTile } from './cnc-tile';
import type { EffectiveCncTileGrid } from './effective-cnc-tile-grid';

/** Depth of every optional CNC tile registration peck. */
export const REGISTRATION_HOLE_DEPTH_MM = 3;

const REGISTRATION_HOLE_EDGE_FRACTIONS = [0.25, 0.75];

/**
 * Build the registration drill group for one tile from the same effective
 * grid that placed its clipping rectangle.
 */
export function registrationGroupForTile(
  job: Job,
  tile: CncTile,
  grid: EffectiveCncTileGrid,
): CncGroup | null {
  const template = job.groups.find((group) => group.kind === 'cnc');
  if (template === undefined || template.kind !== 'cnc') return null;
  const centers = seamHoleCenters(tile, grid);
  if (centers.length === 0) return null;
  const passes: CncPass[] = centers.map((center) => ({
    kind: 'path3d',
    closed: false,
    points: [
      {
        x: center.x - tile.rect.minX,
        y: center.y - tile.rect.minY,
        z: -REGISTRATION_HOLE_DEPTH_MM,
      },
      { x: center.x - tile.rect.minX, y: center.y - tile.rect.minY, z: 0 },
    ],
  }));
  return {
    ...template,
    cutType: 'drill',
    feedMmPerMin: Math.min(template.feedMmPerMin, template.plungeMmPerMin),
    passes,
  };
}

function seamHoleCenters(tile: CncTile, grid: EffectiveCncTileGrid): ReadonlyArray<Vec2> {
  const { rect } = tile;
  const halfOverlapMm = grid.geometry.overlapMm / 2;
  const centers: Vec2[] = [];
  for (const fraction of REGISTRATION_HOLE_EDGE_FRACTIONS) {
    const y = rect.minY + (rect.maxY - rect.minY) * fraction;
    if (tile.col < grid.work.columns - 1) {
      centers.push({ x: rect.maxX - halfOverlapMm, y });
    }
    if (tile.col > 0) centers.push({ x: rect.minX + halfOverlapMm, y });
    const x = rect.minX + (rect.maxX - rect.minX) * fraction;
    if (tile.row < grid.work.rows - 1) {
      centers.push({ x, y: rect.maxY - halfOverlapMm });
    }
    if (tile.row > 0) centers.push({ x, y: rect.minY + halfOverlapMm });
  }
  return centers;
}
