// The design the carved stock is compared with (ADR-487): for each cell of
// the stock, the depth the relief designs want there. Each relief is read
// from the heightmap the compiler carves it from (reliefObjectToHeightmap, at
// the scale relief planning uses), placed in the program where the compiler
// placed it (inspection-design.ts), and sampled between its cells. Where
// reliefs overlap the deeper wins, as it does on the machine. Cells no relief
// covers, and cells a relief's mask leaves out, have no design to compare
// with: other operations cut there, and only the relief says what it wants.

import { reliefMachineSpaceGeometry } from '../../core/cnc/relief-machine-space';
import type { Heightmap } from '../../core/relief';
import { reliefObjectToHeightmap } from '../../core/relief/relief-object-to-heightmap';
import type { InspectionRelief, ProgramAffine } from './inspection-design';

/** A cell with no design to compare with: above the stock top, where no design lies. */
export const NO_DESIGN = 1;

/** The stock's cells, as the removal grid lays them out. */
export type StockCells = {
  readonly originX: number;
  readonly originY: number;
  readonly mmPerCell: number;
  readonly widthCells: number;
  readonly heightCells: number;
};

// A relief read finer than this many cells is read coarser: the target only
// needs to be as fine as the stock's own cells.
const MAX_RELIEF_CELLS = 4_000_000;

/** The design's depth in each cell, or null when no relief lands on the stock. */
export function designTarget(
  cells: StockCells,
  reliefs: ReadonlyArray<InspectionRelief>,
): Float32Array | null {
  if (reliefs.length === 0) return null;
  const target = new Float32Array(cells.widthCells * cells.heightCells).fill(NO_DESIGN);
  let landed = false;
  for (const { relief, toProgram } of reliefs) {
    const geometry = reliefMachineSpaceGeometry(relief);
    const mmPerCell = Math.max(
      cells.mmPerCell,
      Math.sqrt((geometry.widthMm * geometry.heightMm) / MAX_RELIEF_CELLS),
    );
    const result = reliefObjectToHeightmap(relief, {
      targetWidthMm: relief.targetWidthMm,
      reliefDepthMm: relief.reliefDepthMm,
      targetScaleX: geometry.targetScaleX,
      targetScaleY: geometry.targetScaleY,
      mmPerCell,
    });
    if (result.kind === 'error') continue;
    if (sampleRelief(target, cells, result.heightmap, toProgram)) landed = true;
  }
  return landed ? target : null;
}

// Every stock cell whose centre lies on the heightmap takes its depth there.
function sampleRelief(
  target: Float32Array,
  cells: StockCells,
  map: Heightmap,
  toProgram: ProgramAffine,
): boolean {
  const toMap = invert(toProgram);
  if (toMap === null) return false;
  const span = footprint(cells, map, toProgram);
  let landed = false;
  for (let row = span.firstRow; row <= span.lastRow; row += 1) {
    const y = cells.originY + (row + 0.5) * cells.mmPerCell;
    for (let column = span.firstColumn; column <= span.lastColumn; column += 1) {
      const x = cells.originX + (column + 0.5) * cells.mmPerCell;
      const depth = depthAt(map, apply(toMap, x, y));
      if (depth === null) continue;
      const index = row * cells.widthCells + column;
      target[index] = Math.min(target[index] ?? NO_DESIGN, depth);
      landed = true;
    }
  }
  return landed;
}

// Steeper than this between two neighbouring samples, the design holds a wall
// (ADR-580): an STL's vertical side, say. The depth at a point between them
// could be either side's, so the cell is not compared rather than given a
// depth part-way up the wall; interpolated, a carving that follows the wall's
// foot exactly read as cut metres too deep.
const WALL_SLOPE = Math.tan((85 * Math.PI) / 180);

// The heightmap's depth at a point, between the four nearest cell centres;
// null off the heightmap, where its mask leaves the cell out, or on a wall.
function depthAt(map: Heightmap, at: { x: number; y: number }): number | null {
  if (at.x < 0 || at.y < 0 || at.x > map.widthMm || at.y > map.heightMm) return null;
  const last = { x: map.widthCells - 1, y: map.heightCells - 1 };
  const fx = Math.min(Math.max(at.x / map.mmPerCell - 0.5, 0), last.x);
  const fy = Math.min(Math.max(at.y / map.mmPerCell - 0.5, 0), last.y);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const nearest = Math.round(fy) * map.widthCells + Math.round(fx);
  if (map.inclusion?.[nearest] === 0) return null;
  const x1 = Math.min(x0 + 1, last.x);
  const y1 = Math.min(y0 + 1, last.y);
  const cell = (x: number, y: number): number => map.depth[y * map.widthCells + x] ?? 0;
  const corners = [cell(x0, y0), cell(x1, y0), cell(x0, y1), cell(x1, y1)];
  if (Math.max(...corners) - Math.min(...corners) > WALL_SLOPE * map.mmPerCell) return null;
  const [a = 0, b = 0, c = 0, d = 0] = corners;
  const front = a + (b - a) * (fx - x0);
  const back = c + (d - c) * (fx - x0);
  return front + (back - front) * (fy - y0);
}

// The stock cells the heightmap's four corners reach, clamped to the stock.
function footprint(
  cells: StockCells,
  map: Heightmap,
  toProgram: ProgramAffine,
): { firstColumn: number; lastColumn: number; firstRow: number; lastRow: number } {
  const corners = [
    apply(toProgram, 0, 0),
    apply(toProgram, map.widthMm, 0),
    apply(toProgram, 0, map.heightMm),
    apply(toProgram, map.widthMm, map.heightMm),
  ];
  const column = (x: number): number => Math.floor((x - cells.originX) / cells.mmPerCell);
  const row = (y: number): number => Math.floor((y - cells.originY) / cells.mmPerCell);
  return {
    firstColumn: Math.max(0, column(Math.min(...corners.map((p) => p.x)))),
    lastColumn: Math.min(cells.widthCells - 1, column(Math.max(...corners.map((p) => p.x)))),
    firstRow: Math.max(0, row(Math.min(...corners.map((p) => p.y)))),
    lastRow: Math.min(cells.heightCells - 1, row(Math.max(...corners.map((p) => p.y)))),
  };
}

function apply(affine: ProgramAffine, x: number, y: number): { x: number; y: number } {
  const [a, b, c, d, e, f] = affine;
  return { x: a * x + c * y + e, y: b * x + d * y + f };
}

function invert(affine: ProgramAffine): ProgramAffine | null {
  const [a, b, c, d, e, f] = affine;
  const determinant = a * d - b * c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) return null;
  const ia = d / determinant;
  const ib = -b / determinant;
  const ic = -c / determinant;
  const id = a / determinant;
  return [ia, ib, ic, id, -(ia * e + ic * f), -(ib * e + id * f)];
}
