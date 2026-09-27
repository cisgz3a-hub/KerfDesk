// Shared measuring code for layout tests that compile a real job and stamp it
// with the removal simulator the 3D preview uses (ADR-368 Amendments 2 and 3).
// The walls and floors it reads come from the stamped grid alone, never from
// the layout widths under test.

import { DEFAULT_DEVICE_PROFILE, toMachineCoords } from '../devices';
import { buildToolpath, type Job } from '../job';
import { computeRemovalGrid, kernelForTool, type RemovalGrid } from '../sim';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  createLayer,
  type CncLayerSettings,
  type CncTool,
  type ImportedSvg,
  type Scene,
  type SceneObject,
} from '../scene';
import { compileCncJob } from './compile-cnc-job';

export type Box = {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
};

export type Cell = { readonly x: number; readonly y: number; readonly depthMm: number };

export function squareObject(atMm: number, sizeMm: number): ImportedSvg {
  const points = [
    { x: atMm, y: atMm },
    { x: atMm + sizeMm, y: atMm },
    { x: atMm + sizeMm, y: atMm + sizeMm },
    { x: atMm, y: atMm + sizeMm },
  ];
  return {
    kind: 'imported-svg',
    id: 'O1',
    source: 'O1.svg',
    bounds: { minX: atMm, minY: atMm, maxX: atMm + sizeMm, maxY: atMm + sizeMm },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: '#ff0000', polylines: [{ closed: true, points }] }],
  };
}

// One layer cutting `object` with `tool`. A clean wall to measure: no
// bridges, no lead arcs in the waste, unless the patch asks for them.
export function compileWithTool(
  object: SceneObject,
  tool: CncTool,
  patch: Partial<CncLayerSettings>,
  stockThicknessMm = DEFAULT_CNC_MACHINE_CONFIG.stock.thicknessMm,
): Job {
  const scene: Scene = {
    objects: [object],
    layers: [
      {
        ...createLayer({ id: 'L1', color: '#ff0000' }),
        cnc: {
          ...DEFAULT_CNC_LAYER_SETTINGS,
          toolId: tool.id,
          tabsEnabled: false,
          profileLead: { shape: 'none' },
          ...patch,
        },
      },
    ],
  };
  const tools = DEFAULT_CNC_MACHINE_CONFIG.tools.filter((known) => known.id !== tool.id);
  return compileCncJob(scene, DEFAULT_DEVICE_PROFILE, {
    ...DEFAULT_CNC_MACHINE_CONFIG,
    stock: { ...DEFAULT_CNC_MACHINE_CONFIG.stock, thicknessMm: stockThicknessMm },
    tools: [...tools, tool],
    toolId: tool.id,
  });
}

// The object's scene bounds in machine coordinates.
export function machineBox(object: SceneObject): Box {
  const corners = [
    { x: object.bounds.minX, y: object.bounds.minY },
    { x: object.bounds.maxX, y: object.bounds.maxY },
  ].map((point) => toMachineCoords(point, DEFAULT_DEVICE_PROFILE));
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

export function removalGrid(job: Job, tool: CncTool, area: Box, cellMm: number): RemovalGrid {
  const result = computeRemovalGrid(
    buildToolpath(job),
    {
      originX: area.minX,
      originY: area.minY,
      widthMm: area.maxX - area.minX,
      heightMm: area.maxY - area.minY,
      mmPerCell: cellMm,
    },
    kernelForTool(tool, cellMm),
  );
  if (result.kind === 'error') throw new Error(result.reason);
  return result.grid;
}

export function gridCells(grid: RemovalGrid): ReadonlyArray<Cell> {
  const out: Cell[] = [];
  for (let row = 0; row < grid.heightCells; row += 1) {
    for (let col = 0; col < grid.widthCells; col += 1) {
      out.push({
        x: grid.originX + (col + 0.5) * grid.mmPerCell,
        y: grid.originY + (row + 0.5) * grid.mmPerCell,
        depthMm: grid.depth[row * grid.widthCells + col] ?? 0,
      });
    }
  }
  return out;
}

// Where the wall stands at `zMm`: the distance from the line, measured toward
// the waste, of the first cell cut at least that deep.
export function wallDistanceMm(
  row: ReadonlyArray<Cell>,
  lineX: number,
  wasteSign: 1 | -1,
  zMm: number,
): number {
  const reached = row
    .filter((cell) => cell.depthMm <= zMm)
    .map((cell) => (cell.x - lineX) * wasteSign);
  return reached.length === 0 ? Number.POSITIVE_INFINITY : Math.min(...reached);
}

// How far a cell lies inside the box; negative outside it.
export function insideBy(cell: Cell, box: Box): number {
  return Math.min(cell.x - box.minX, box.maxX - cell.x, cell.y - box.minY, box.maxY - cell.y);
}

// The highest the floor stands above `floorZ` over cells at least `marginMm`
// inside the box.
export function floorResidual(
  all: ReadonlyArray<Cell>,
  box: Box,
  marginMm: number,
  floorZ: number,
): { readonly cells: number; readonly highestMm: number } {
  let count = 0;
  let highestMm = Number.NEGATIVE_INFINITY;
  for (const cell of all) {
    if (insideBy(cell, box) < marginMm) continue;
    count += 1;
    highestMm = Math.max(highestMm, cell.depthMm - floorZ);
  }
  return { cells: count, highestMm };
}

// Every X a contour pass of the job visits.
export function contourPassXs(job: Job): ReadonlyArray<number> {
  const xs: number[] = [];
  for (const group of job.groups) {
    if (group.kind !== 'cnc') continue;
    for (const pass of group.passes) {
      if (pass.kind === 'contour') xs.push(...pass.polyline.map((point) => point.x));
    }
  }
  return xs;
}
