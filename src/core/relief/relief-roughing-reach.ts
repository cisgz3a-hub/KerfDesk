// Where relief roughing really reached (rolling audit v11 W6-P2-2; ADR-421
// Amendment 2).
//
// The roughing planner clears a level only where its widened cutter fits, so a
// channel narrower than the roughing bit plus twice the allowance keeps its
// full stock, and the finishing ball then slotted it at full depth and full
// feed with nothing said. This sweeps the EMITTED roughing moves (rings, core
// cleanup, ramps) over the roughing grid with the physical cutter, as
// relief-residual-stock.ts sweeps finishing moves for rest finishing, and marks
// every cell left more than one depth per pass above the finished surface's
// allowance envelope. Compile steps the finishing bit down there
// (relief-finishing-step-down.ts) and Job Review names the missed area.
//
// The sweep measures each cell at its centre, so the threshold carries one
// cell of slack on top of the depth per pass and the allowance that a complete
// roughing leaves anyway (a terrace plus the allowance). A cell beside a wall
// keeps a strip of allowance standing the full wall height; the envelope (the
// highest target within the allowance and a cell) holds that strip, so it is
// finishing's ordinary side cut, not a missed region. So is a sliver narrower
// than half the next bit, such as the square inside corner a round roughing
// bit never enters: an opening by that width drops it.
//
// Pure: no clock, no randomness, no I/O.

import type { CncPass } from '../job';
import type { Vec3 } from '../geometry/vec3';
import type { CncTool } from '../scene';
import { partialCellCenter } from '../grid';
import { kernelForTool, type ToolKernel } from '../sim';
import type { Heightmap } from './heightmap';

// Cells visited by the sweep; past it the check reports itself unchecked.
const MAX_REACH_WORK = 40_000_000;

export type ReliefRoughingReach = {
  readonly map: Heightmap;
  // Upper bound of the stock top after roughing, per roughing-grid cell
  // (0 = stock top, negative into the stock).
  readonly stock: Float32Array;
  // 1 where roughing left more than `thresholdMm` over the envelope.
  readonly missed: Uint8Array;
  readonly missedCells: number;
  readonly missedAreaMm2: number;
  readonly thresholdMm: number;
  // CNC audit v3 N7-P2-1: the most stock the next bit may meet under its tip,
  // one depth per pass. More than this under the tip along the bit's own path
  // is stepped down whatever the region test said.
  readonly underTipLimitMm: number;
};

export type ReliefRoughingReachResult =
  | { readonly kind: 'checked'; readonly reach: ReliefRoughingReach }
  | { readonly kind: 'unchecked' };

/** Sweep emitted roughing moves (relief map frame) and mark what they missed. */
export function reliefRoughingReach(
  map: Heightmap,
  passes: ReadonlyArray<CncPass>,
  tool: CncTool,
  options: {
    readonly depthPerPassMm: number;
    readonly allowanceMm: number;
    // Narrowest missed region that counts: half the bit that will cut it. A
    // sliver narrower than that (the square inside corner a round roughing
    // bit can never enter) is side-milled by the next bit, not slotted.
    readonly minWidthMm: number;
    // Radius of the bit that cuts next. Rolling audit v12 X6-P2-3: the
    // allowance strip beside a wall (or past the relief's edge) is side-milled
    // only by a bit whose centre stays out of it. A smaller bit rides with its
    // centre in the strip, so there the envelope shrinks to its radius and the
    // map's edge stops eroding the band. Absent: the strip is always side-milled.
    readonly nextToolRadiusMm?: number;
    // CNC audit v3 N2-P2-2: decide "small" outright. In the rest stage the
    // band beside a wall is the finishing ball's own fillet, not an allowance
    // strip, so any rest bit smaller than the finishing bit rides in it.
    // Absent: small when its radius is under the allowance plus one cell.
    readonly nextIsSmall?: boolean;
  },
): ReliefRoughingReachResult {
  const segments = roughingSegments(passes);
  const radius = Math.max(0, tool.diameterMm / 2);
  if (sweepWork(map, segments, radius) > MAX_REACH_WORK) return { kind: 'unchecked' };
  const kernel = kernelForTool(tool, map.mmPerCell);
  const stock = new Float32Array(map.depth.length);
  for (const segment of segments) stampSegment(map, stock, kernel, segment);
  const thresholdMm =
    Math.max(0, options.depthPerPassMm) + Math.max(0, options.allowanceMm) + map.mmPerCell;
  const missed = missedMask(map, stock, thresholdMm, options);
  const missedCells = missed.reduce((sum, value) => sum + value, 0);
  return {
    kind: 'checked',
    reach: {
      map,
      stock,
      missed,
      missedCells,
      missedAreaMm2: missedCells * map.mmPerCell * map.mmPerCell,
      thresholdMm,
      underTipLimitMm: Math.max(0, options.depthPerPassMm),
    },
  };
}

// Cells roughing left more than the threshold above the allowance envelope,
// opened by half the next bit, with a small next bit's wall strip kept.
function missedMask(
  map: Heightmap,
  stock: Float32Array,
  thresholdMm: number,
  options: {
    readonly allowanceMm: number;
    readonly minWidthMm: number;
    readonly nextToolRadiusMm?: number;
    readonly nextIsSmall?: boolean;
  },
): Uint8Array {
  const stripMm = Math.max(0, options.allowanceMm) + map.mmPerCell;
  const nextRadius = options.nextToolRadiusMm ?? Number.POSITIVE_INFINITY;
  const smallNext = options.nextIsSmall ?? nextRadius < stripMm;
  const envelope = allowanceEnvelope(map, smallNext ? Math.min(nextRadius, stripMm) : stripMm);
  const raw = rawMissed(map, stock, envelope, thresholdMm);
  // N2r-P2-1: the opening drops regions narrower than half the next bit. When
  // that is under one cell (a 1 mm ball on a 1/8" bit's grid), no region on
  // the grid is that narrow, and a disk of one cell would erase the one-cell
  // strip such a bit rides in beside a wall.
  const cells = options.minWidthMm / 2 / map.mmPerCell;
  if (smallNext && cells < 1) return raw;
  return opened(
    map,
    raw,
    Math.max(1, Math.round(cells)),
    smallNext ? wallShadow(map, envelope, thresholdMm) : null,
  );
}

function rawMissed(
  map: Heightmap,
  stock: Float32Array,
  envelope: Float32Array,
  thresholdMm: number,
): Uint8Array {
  const raw = new Uint8Array(map.depth.length);
  for (let index = 0; index < map.depth.length; index += 1) {
    if (map.inclusion?.[index] === 0) continue;
    if ((stock[index] ?? 0) - (envelope[index] ?? 0) > thresholdMm) raw[index] = 1;
  }
  return raw;
}

/** Sweep one path of `tool` (relief map frame) into a stock grid on `map`:
 * an upper bound of the stock after it anywhere in each cell, since a cell is
 * lowered only to where the cutter stands over its farthest corner (CNC audit
 * v3 N8-P3-1, for the step-down's measured take). */
export function sweepPathIntoStock(
  map: Heightmap,
  stock: Float32Array,
  tool: CncTool,
  points: ReadonlyArray<Vec3>,
): void {
  const kernel = kernelForTool(tool, map.mmPerCell);
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (a !== undefined && b !== undefined)
      stampSegment(map, stock, kernel, { a, b }, map.mmPerCell * Math.SQRT1_2);
  }
}

type Segment = { readonly a: Vec3; readonly b: Vec3 };

// Every cutting move as a straight segment. A move that changes height is
// taken at its higher end: that removes less, so the stock stays an upper bound.
function roughingSegments(passes: ReadonlyArray<CncPass>): ReadonlyArray<Segment> {
  const out: Segment[] = [];
  const add = (points: ReadonlyArray<Vec3>, closed: boolean): void => {
    const first = points[0];
    if (first === undefined) return;
    if (points.length === 1) out.push({ a: first, b: first });
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1];
      const b = points[i];
      if (a !== undefined && b !== undefined) out.push({ a, b });
    }
    const last = points[points.length - 1];
    if (closed && last !== undefined && points.length > 2) out.push({ a: last, b: first });
  };
  for (const pass of passes) {
    if (pass.kind === 'contour')
      add(
        pass.polyline.map((p) => ({ x: p.x, y: p.y, z: pass.zMm })),
        pass.closed,
      );
    else if (pass.kind === 'path3d') add(pass.points, pass.closed);
  }
  return out;
}

function sweepWork(map: Heightmap, segments: ReadonlyArray<Segment>, radius: number): number {
  let work = 0;
  for (const { a, b } of segments) {
    const w = Math.abs(b.x - a.x) + 2 * radius;
    const h = Math.abs(b.y - a.y) + 2 * radius;
    work += (Math.ceil(w / map.mmPerCell) + 1) * (Math.ceil(h / map.mmPerCell) + 1);
    if (work > MAX_REACH_WORK) return work;
  }
  return work;
}

function stampSegment(
  map: Heightmap,
  stock: Float32Array,
  kernel: ToolKernel,
  { a, b }: Segment,
  farCornerMm = 0,
): void {
  const z = Math.max(a.z, b.z);
  if (z >= 0) return;
  const cell = map.mmPerCell;
  const radius = kernel.radiusMm;
  const left = Math.max(0, Math.floor((Math.min(a.x, b.x) - radius) / cell));
  const right = Math.min(map.widthCells - 1, Math.floor((Math.max(a.x, b.x) + radius) / cell));
  const top = Math.max(0, Math.floor((Math.min(a.y, b.y) - radius) / cell));
  const bottom = Math.min(map.heightCells - 1, Math.floor((Math.max(a.y, b.y) + radius) / cell));
  for (let row = top; row <= bottom; row += 1) {
    const cy = partialCellCenter(map, 'y', row);
    for (let col = left; col <= right; col += 1) {
      const d = distanceToSegment(partialCellCenter(map, 'x', col), cy, a, b) + farCornerMm;
      if (d > radius) continue;
      const index = row * map.widthCells + col;
      stock[index] = Math.min(stock[index] ?? 0, z + kernel.surfaceDzAtRadius(d));
    }
  }
}

// Morphological opening by a disk of `radius` cells: only regions wide enough
// to hold the disk survive, at their full extent. Past the map edge counts as
// missed: a channel running off the relief keeps its width to the edge.
// CNC audit v3 N2r-P2-1: under a small next bit, the cells a wall (or the
// relief's edge, which stands at the stock top) shadows within the envelope:
// their envelope stands more than a pass above their own target. A small bit
// rides beside such a wall with its centre in the unroughed strip, so the
// strip must survive the opening there as it does along the map edge.
function wallShadow(map: Heightmap, envelope: Float32Array, thresholdMm: number): Uint8Array {
  const out = new Uint8Array(map.depth.length);
  for (let index = 0; index < map.depth.length; index += 1)
    if ((envelope[index] ?? 0) - (map.depth[index] ?? 0) > thresholdMm) out[index] = 1;
  return out;
}

function opened(
  map: Heightmap,
  mask: Uint8Array,
  radius: number,
  neutral: Uint8Array | null,
): Uint8Array {
  const disk: Array<readonly [number, number]> = [];
  for (let dy = -radius; dy <= radius; dy += 1)
    for (let dx = -radius; dx <= radius; dx += 1)
      if (dx * dx + dy * dy <= radius * radius) disk.push([dx, dy]);
  return dilated(map, eroded(map, mask, disk, neutral), disk, mask);
}

type Disk = ReadonlyArray<readonly [number, number]>;

function inMap(map: Heightmap, col: number, row: number): boolean {
  return col >= 0 && row >= 0 && col < map.widthCells && row < map.heightCells;
}

// Cells whose whole disk is in the mask, past the map's edge, or in the
// strip a small next bit rides in beside a wall or the edge (X6-P2-3, N2r-P2-1).
function eroded(
  map: Heightmap,
  mask: Uint8Array,
  disk: Disk,
  neutral: Uint8Array | null,
): Uint8Array {
  const out = new Uint8Array(mask.length);
  const at = (col: number, row: number): boolean => {
    if (!inMap(map, col, row)) return true;
    const index = row * map.widthCells + col;
    return mask[index] === 1 || neutral?.[index] === 1;
  };
  for (let row = 0; row < map.heightCells; row += 1)
    for (let col = 0; col < map.widthCells; col += 1)
      if (disk.every(([dx, dy]) => at(col + dx, row + dy))) out[row * map.widthCells + col] = 1;
  return out;
}

// The mask cells within one disk of a core cell.
function dilated(map: Heightmap, core: Uint8Array, disk: Disk, mask: Uint8Array): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let index = 0; index < core.length; index += 1) {
    if (core[index] !== 1) continue;
    const col = index % map.widthCells;
    const row = Math.floor(index / map.widthCells);
    for (const [dx, dy] of disk) {
      const target = (row + dy) * map.widthCells + col + dx;
      if (inMap(map, col + dx, row + dy) && mask[target] === 1) out[target] = 1;
    }
  }
  return out;
}

// Past the map's edge and in an excluded mask cell the stock stands at the top
// (ADR-412 Amendment 2), so the allowance strip beside them is a wall's too.
function allowanceEnvelope(map: Heightmap, radiusMm: number): Float32Array {
  const out = new Float32Array(map.depth.length);
  const reach = Math.ceil(radiusMm / map.mmPerCell);
  const heightAt = (col: number, row: number): number => {
    if (col < 0 || row < 0 || col >= map.widthCells || row >= map.heightCells) return 0;
    const index = row * map.widthCells + col;
    return map.inclusion?.[index] === 0 ? 0 : (map.depth[index] ?? 0);
  };
  for (let row = 0; row < map.heightCells; row += 1) {
    for (let col = 0; col < map.widthCells; col += 1) {
      let high = Number.NEGATIVE_INFINITY;
      for (let dy = -reach; dy <= reach; dy += 1)
        for (let dx = -reach; dx <= reach; dx += 1)
          if (Math.hypot(dx, dy) * map.mmPerCell <= radiusMm + 1e-9)
            high = Math.max(high, heightAt(col + dx, row + dy));
      out[row * map.widthCells + col] = high;
    }
  }
  return out;
}

function distanceToSegment(x: number, y: number, a: Vec3, b: Vec3): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t =
    lengthSq > 0 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / lengthSq)) : 0;
  return Math.hypot(x - (a.x + dx * t), y - (a.y + dy * t));
}
