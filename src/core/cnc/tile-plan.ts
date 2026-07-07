// CNC tiling (Phase H.10, F-CNC19): jobs larger than the bed split into an
// indexed row/col tile grid. Each tile's job contains only the motion
// inside its rectangle (polylines clipped at the boundary with entry/exit
// interpolation — Z included for path3d), translated so the tile's min
// corner sits at the machine origin: the operator slides the stock between
// tiles and re-zeros XY on the tile frame. Adjacent tiles share
// registration holes drilled in the overlap strip at IDENTICAL stock
// positions, so dowel pins re-index the stock physically.

import { cncPassXyPoints, type CncGroup, type CncPass, type Job } from '../job';
import type { CncTiling, Vec2 } from '../scene';

export const REGISTRATION_HOLE_DEPTH_MM = 3;
const REGISTRATION_HOLE_EDGE_FRACTIONS = [0.25, 0.75] as const;
const MIN_TILE_STEP_MM = 1;
const MIN_CLIPPED_POINTS = 2;

export type CncTile = {
  readonly row: number;
  readonly col: number;
  readonly rect: {
    readonly minX: number;
    readonly minY: number;
    readonly maxX: number;
    readonly maxY: number;
  };
};

export type TiledJob = {
  readonly tile: CncTile;
  readonly job: Job;
};

export function planTiles(
  bounds: {
    readonly minX: number;
    readonly minY: number;
    readonly maxX: number;
    readonly maxY: number;
  },
  tiling: CncTiling,
): ReadonlyArray<CncTile> {
  const stepX = Math.max(MIN_TILE_STEP_MM, tiling.tileWidthMm - tiling.overlapMm);
  const stepY = Math.max(MIN_TILE_STEP_MM, tiling.tileHeightMm - tiling.overlapMm);
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  const cols = Math.max(1, Math.ceil(Math.max(0, width - tiling.overlapMm) / stepX));
  const rows = Math.max(1, Math.ceil(Math.max(0, height - tiling.overlapMm) / stepY));
  const tiles: CncTile[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const minX = bounds.minX + col * stepX;
      const minY = bounds.minY + row * stepY;
      tiles.push({
        row,
        col,
        rect: {
          minX,
          minY,
          maxX: minX + tiling.tileWidthMm,
          maxY: minY + tiling.tileHeightMm,
        },
      });
    }
  }
  return tiles;
}

// Split the job across the tile grid. Tiles that end up with no motion are
// dropped (their count is the caller's business to report).
export function tileJobs(job: Job, tiling: CncTiling): ReadonlyArray<TiledJob> {
  const bounds = cncJobBounds(job);
  if (bounds === null) return [];
  const tiles = planTiles(bounds, tiling);
  const grid = {
    cols: Math.max(...tiles.map((tile) => tile.col)) + 1,
    rows: Math.max(...tiles.map((tile) => tile.row)) + 1,
  };
  const out: TiledJob[] = [];
  for (const tile of tiles) {
    const groups: CncGroup[] = [];
    for (const group of job.groups) {
      if (group.kind !== 'cnc') continue;
      const clipped = clipGroupToTile(group, tile);
      if (clipped !== null) groups.push(clipped);
    }
    if (tiling.registrationHoles) {
      const registration = registrationGroup(job, tile, grid, tiling);
      if (registration !== null) groups.push(registration);
    }
    if (groups.length > 0) out.push({ tile, job: { groups } });
  }
  return out;
}

export function tileFileName(baseName: string, tile: CncTile): string {
  return `${baseName}_tile-r${tile.row + 1}-c${tile.col + 1}`;
}

function cncJobBounds(job: Job): CncTile['rect'] | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const group of job.groups) {
    if (group.kind !== 'cnc') continue;
    for (const pass of group.passes) {
      const points = cncPassXyPoints(pass);
      for (const point of points) {
        if (point.x < minX) minX = point.x;
        if (point.y < minY) minY = point.y;
        if (point.x > maxX) maxX = point.x;
        if (point.y > maxY) maxY = point.y;
      }
    }
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

function clipGroupToTile(group: CncGroup, tile: CncTile): CncGroup | null {
  const passes: CncPass[] = [];
  for (const pass of group.passes) {
    if (pass.kind === 'contour') {
      const xyz = pass.polyline.map((point) => ({ x: point.x, y: point.y, z: pass.zMm }));
      for (const piece of clipPointsToRect(xyz, tile.rect, pass.closed)) {
        // A clipped loop is no longer closed — it continues in a neighbor.
        passes.push({
          kind: 'contour',
          zMm: pass.zMm,
          closed: false,
          polyline: piece.map((point) => ({ x: point.x, y: point.y })),
        });
      }
    } else if (pass.kind === 'path3d') {
      for (const piece of clipPointsToRect([...pass.points], tile.rect, pass.closed)) {
        passes.push({ kind: 'path3d', closed: false, points: piece });
      }
    } else {
      const xyz = cncPassXyPoints(pass).map((point) => ({ x: point.x, y: point.y, z: pass.zMm }));
      for (const piece of clipPointsToRect(xyz, tile.rect, pass.closed)) {
        passes.push({
          kind: 'contour',
          zMm: pass.zMm,
          closed: false,
          polyline: piece.map((point) => ({ x: point.x, y: point.y })),
        });
      }
    }
  }
  if (passes.length === 0) return null;
  return { ...group, passes: passes.map((pass) => translatePass(pass, tile)) };
}

type Xyz = { readonly x: number; readonly y: number; readonly z: number };

// Keep the in-rect portions of a polyline, interpolating boundary crossings
// (Z rides the same parameter). Closed loops include the seam segment back
// to the start.
function clipPointsToRect(
  points: ReadonlyArray<Xyz>,
  rect: CncTile['rect'],
  closed: boolean,
): Array<Array<Xyz>> {
  const pieces: Array<Array<Xyz>> = [];
  let current: Array<Xyz> = [];
  const flush = (): void => {
    if (current.length >= MIN_CLIPPED_POINTS) pieces.push(current);
    current = [];
  };
  const segmentCount = closed ? points.length : points.length - 1;
  for (let i = 0; i < segmentCount; i += 1) {
    const a = points[i] as Xyz;
    const b = points[(i + 1) % points.length] as Xyz;
    const segment = clipSegment(a, b, rect);
    if (segment === null) {
      flush();
      continue;
    }
    const [start, end] = segment;
    if (current.length === 0 || !samePoint(current[current.length - 1] as Xyz, start)) {
      flush();
      current.push(start);
    }
    current.push(end);
  }
  flush();
  return pieces;
}

// Liang–Barsky parametric clip of one segment against the rect; returns the
// clipped endpoints (Z lerped) or null when fully outside.
function clipSegment(a: Xyz, b: Xyz, rect: CncTile['rect']): [Xyz, Xyz] | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  const edges: ReadonlyArray<readonly [number, number]> = [
    [-dx, a.x - rect.minX],
    [dx, rect.maxX - a.x],
    [-dy, a.y - rect.minY],
    [dy, rect.maxY - a.y],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return null;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return null;
      if (r < t1) t1 = r;
    }
  }
  return [lerpPoint(a, b, t0), lerpPoint(a, b, t1)];
}

function lerpPoint(a: Xyz, b: Xyz, t: number): Xyz {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

function samePoint(a: Xyz, b: Xyz): boolean {
  const EPSILON = 1e-9;
  return Math.abs(a.x - b.x) < EPSILON && Math.abs(a.y - b.y) < EPSILON;
}

function translatePass(pass: CncPass, tile: CncTile): CncPass {
  if (pass.kind === 'contour') {
    return {
      ...pass,
      polyline: pass.polyline.map((point) => ({
        x: point.x - tile.rect.minX,
        y: point.y - tile.rect.minY,
      })),
    };
  }
  if (pass.kind === 'arc') {
    return {
      ...pass,
      start: { x: pass.start.x - tile.rect.minX, y: pass.start.y - tile.rect.minY },
      end: { x: pass.end.x - tile.rect.minX, y: pass.end.y - tile.rect.minY },
      center: { x: pass.center.x - tile.rect.minX, y: pass.center.y - tile.rect.minY },
    };
  }
  return {
    ...pass,
    points: pass.points.map((point) => ({
      x: point.x - tile.rect.minX,
      y: point.y - tile.rect.minY,
      z: point.z,
    })),
  };
}

// Registration holes: two pecks per shared seam, drilled at identical STOCK
// positions in both adjacent tiles' files (the seam center of the overlap
// strip), so dowel pins physically re-index the stock between tiles.
function registrationGroup(
  job: Job,
  tile: CncTile,
  grid: { readonly cols: number; readonly rows: number },
  tiling: CncTiling,
): CncGroup | null {
  const template = job.groups.find((group) => group.kind === 'cnc');
  if (template === undefined || template.kind !== 'cnc') return null;
  const centers: Vec2[] = [];
  appendSeamHoles(centers, tile, grid, tiling);
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
    // Pecks run at the plunge feed like every drill group.
    feedMmPerMin: Math.min(template.feedMmPerMin, template.plungeMmPerMin),
    passes,
  };
}

function appendSeamHoles(
  centers: Vec2[],
  tile: CncTile,
  grid: { readonly cols: number; readonly rows: number },
  tiling: CncTiling,
): void {
  const { rect } = tile;
  const halfOverlap = tiling.overlapMm / 2;
  // Right seam (shared with col+1) and left seam (shared with col-1).
  for (const fraction of REGISTRATION_HOLE_EDGE_FRACTIONS) {
    const y = rect.minY + (rect.maxY - rect.minY) * fraction;
    if (tile.col < grid.cols - 1) centers.push({ x: rect.maxX - halfOverlap, y });
    if (tile.col > 0) centers.push({ x: rect.minX + halfOverlap, y });
    const x = rect.minX + (rect.maxX - rect.minX) * fraction;
    if (tile.row < grid.rows - 1) centers.push({ x, y: rect.maxY - halfOverlap });
    if (tile.row > 0) centers.push({ x, y: rect.minY + halfOverlap });
  }
}
