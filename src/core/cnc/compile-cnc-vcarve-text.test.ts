// Compile-level gate for ADR-286: a V-carve layer must carve the joins where
// one text object's own glyphs overlap, because font outlines are authored
// non-zero. Every other v-carve fixture in the tree is a single imported-svg
// object, so before this file nothing exercised a v-carve layer holding text
// and the whole wiring of the rule was uncovered.
//
// The oracle is simulated material removal, not a helper's return value: two
// 10 mm boxes overlapping by 4 mm are the synthetic stand-in for a script
// letter join. Read even-odd they become the SYMMETRIC DIFFERENCE — two
// disjoint 6 mm rectangles with a 4 mm uncarved bar between them. Read
// non-zero they are one 16 mm region carved straight through.
//
// Emitted vertices cannot answer this: the medial route crosses the join in a
// single long segment with no vertex inside it, so a point-membership test
// reports zero either way. Measuring the removal grid is what distinguishes
// "the cutter travelled through the join" from "a vertex happened to land
// there" — with the rule disabled this file's first test reports 0 % of the
// join carved, and with it >90 %.

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, toMachineCoords } from '../devices';
import { buildToolpath } from '../job';
import { computeRemovalGrid, kernelForTool } from '../sim';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  createLayer,
  type CncMachineConfig,
  type CncTool,
  type ImportedSvg,
  type Polyline,
  type Scene,
  type SceneObject,
  type TextObject,
} from '../scene';
import { compileCncJob } from './compile-cnc-job';

const AT = 50;
const SIZE = 10;
const OVERLAP_START = 56;
const MAX_DEPTH = 2;
const RESOLUTION = 0.25;
// Inset from the lens edges so a cell on the boundary of either box can never
// be mistaken for a cell inside the join.
const LENS_MARGIN_MM = 0.5;
const CELL_MM = 0.2;
const GRID_PAD_MM = 3;

const VBIT_90: CncTool = {
  id: 'v90',
  name: '90° v-bit',
  kind: 'v-bit',
  diameterMm: 6,
  tipAngleDeg: 90,
};

function box(atX: number, atY: number, size: number): Polyline {
  return {
    closed: true,
    points: [
      { x: atX, y: atY },
      { x: atX + size, y: atY },
      { x: atX + size, y: atY + size },
      { x: atX, y: atY + size },
    ],
  };
}

function openStroke(atX: number, atY: number): Polyline {
  return {
    closed: false,
    points: [
      { x: atX, y: atY },
      { x: atX + SIZE, y: atY },
      { x: atX + SIZE, y: atY + SIZE },
    ],
  };
}

function textObject(polylines: ReadonlyArray<Polyline>): TextObject {
  return {
    kind: 'text',
    id: 'T1',
    content: 'ab',
    fontKey: 'pacifico-regular',
    sizeMm: SIZE,
    alignment: 'left',
    lineHeight: 1.4,
    letterSpacing: 0,
    color: '#ff0000',
    bounds: { minX: AT, minY: AT, maxX: OVERLAP_START + SIZE, maxY: AT + SIZE },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: '#ff0000', polylines }],
  };
}

function svgObject(polylines: ReadonlyArray<Polyline>): ImportedSvg {
  return {
    kind: 'imported-svg',
    id: 'O1',
    source: 'O1.svg',
    bounds: { minX: AT, minY: AT, maxX: OVERLAP_START + SIZE, maxY: AT + SIZE },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: '#ff0000', polylines }],
  };
}

function vcarveScene(object: SceneObject): Scene {
  return {
    objects: [object],
    layers: [
      {
        ...createLayer({ id: 'L1', color: '#ff0000' }),
        cnc: {
          ...DEFAULT_CNC_LAYER_SETTINGS,
          cutType: 'v-carve',
          vCarveFlatDepthEnabled: true,
          depthMm: MAX_DEPTH,
          depthPerPassMm: MAX_DEPTH,
          vResolutionMm: RESOLUTION,
        },
      },
    ],
  };
}

function vbitConfig(): CncMachineConfig {
  return { ...DEFAULT_CNC_MACHINE_CONFIG, tools: [VBIT_90], toolId: VBIT_90.id };
}

function hasVcarveGroup(scene: Scene): boolean {
  const job = compileCncJob(scene, DEFAULT_DEVICE_PROFILE, vbitConfig());
  return job.groups.some((group) => group.kind === 'cnc' && group.cutType === 'v-carve');
}

// The join bar in machine coordinates. The device profile may flip an axis, so
// derive the box from the transformed corners rather than assuming a direction.
function joinBar(): { minX: number; maxX: number; minY: number; maxY: number } {
  const a = toMachineCoords(
    { x: OVERLAP_START + LENS_MARGIN_MM, y: AT + LENS_MARGIN_MM },
    DEFAULT_DEVICE_PROFILE,
  );
  const b = toMachineCoords(
    { x: AT + SIZE - LENS_MARGIN_MM, y: AT + SIZE - LENS_MARGIN_MM },
    DEFAULT_DEVICE_PROFILE,
  );
  return {
    minX: Math.min(a.x, b.x),
    maxX: Math.max(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxY: Math.max(a.y, b.y),
  };
}

/**
 * Fraction of the join bar from which the simulated V-bit actually removes
 * material. Sampling emitted vertices would not answer this — a medial route
 * crosses the join in ONE long segment with no vertex inside it — so this runs
 * the same removal grid the analytic V-groove suite uses.
 */
function joinCarvedFraction(scene: Scene): number {
  const job = compileCncJob(scene, DEFAULT_DEVICE_PROFILE, vbitConfig());
  const toolpath = buildToolpath(job);
  const corner = toMachineCoords({ x: AT, y: AT }, DEFAULT_DEVICE_PROFILE);
  const far = toMachineCoords({ x: OVERLAP_START + SIZE, y: AT + SIZE }, DEFAULT_DEVICE_PROFILE);
  const result = computeRemovalGrid(
    toolpath,
    {
      originX: Math.min(corner.x, far.x) - GRID_PAD_MM,
      originY: Math.min(corner.y, far.y) - GRID_PAD_MM,
      widthMm: Math.abs(far.x - corner.x) + 2 * GRID_PAD_MM,
      heightMm: Math.abs(far.y - corner.y) + 2 * GRID_PAD_MM,
      mmPerCell: CELL_MM,
    },
    kernelForTool(VBIT_90, CELL_MM),
  );
  if (result.kind === 'error') throw new Error(result.reason);
  const grid = result.grid;
  const bar = joinBar();
  let inBar = 0;
  let carved = 0;
  for (let cy = 0; cy < grid.heightCells; cy += 1) {
    for (let cx = 0; cx < grid.widthCells; cx += 1) {
      const x = grid.originX + (cx + 0.5) * grid.mmPerCell;
      const y = grid.originY + (cy + 0.5) * grid.mmPerCell;
      if (x < bar.minX || x > bar.maxX || y < bar.minY || y > bar.maxY) continue;
      inBar += 1;
      if ((grid.depth[cy * grid.widthCells + cx] ?? 0) < 0) carved += 1;
    }
  }
  if (inBar === 0) throw new Error('join bar fell outside the removal grid');
  return carved / inBar;
}

const OVERLAPPING_GLYPHS = [box(AT, AT, SIZE), box(OVERLAP_START, AT, SIZE)];

describe('v-carve of a layer holding text', () => {
  it('carves the join where one text object glyphs overlap', () => {
    expect(joinCarvedFraction(vcarveScene(textObject(OVERLAPPING_GLYPHS)))).toBeGreaterThan(0.9);
  });

  it('still knocks the overlap out for a non-text object, which may mean even-odd', () => {
    expect(joinCarvedFraction(vcarveScene(svgObject(OVERLAPPING_GLYPHS)))).toBeLessThan(0.1);
  });

  it('still knocks the overlap out between two separate text objects', () => {
    const first = textObject([box(AT, AT, SIZE)]);
    const second: TextObject = { ...textObject([box(OVERLAP_START, AT, SIZE)]), id: 'T2' };
    const scene = vcarveScene(first);

    expect(joinCarvedFraction({ ...scene, objects: [first, second] })).toBeLessThan(0.1);
  });

  // The merge must never manufacture a closed region out of open strokes: a
  // single-line font carries `closed: false` glyphs, and a V-carve layer built
  // from them emits nothing at all (vcarve-medial.ts validClosedSource, and the
  // #620 all-open-paths note that tells the operator so). Closing them here
  // would plunge the V-bit across the letterform's filled hull.
  it('emits no v-carve motion for open single-line strokes on a text object', () => {
    const scene = vcarveScene(textObject([openStroke(AT, AT), openStroke(OVERLAP_START, AT)]));

    expect(hasVcarveGroup(scene)).toBe(false);
    // The closed control proves the fixture itself is otherwise carvable.
    expect(hasVcarveGroup(vcarveScene(textObject(OVERLAPPING_GLYPHS)))).toBe(true);
  });
});
