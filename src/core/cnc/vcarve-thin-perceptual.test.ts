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
  type Vec2,
} from '../scene';
import { cncGrblStrategy } from '../output';
import { compileCncJob } from './compile-cnc-job';
import { THIN_DETAIL_RESOLUTION_MM } from './vcarve-thin-detail';

// Perceptual verification (ADR-025 pattern) for ADR-279: V-carve artwork
// THINNER than the ring pitch through the REAL pipeline (compileCncJob →
// buildToolpath → removal grid) against the ANALYTIC groove
// z(x, y) = −min(distToBoundary, maxDepth) at tan(45°) = 1. Before ADR-279
// these fixtures produced NO cutting at all inside the thin strokes — the
// screenshot bug: a script word carved only in sections.

const VBIT_90: CncTool = {
  id: 'v90',
  name: '90° v-bit',
  kind: 'v-bit',
  diameterMm: 6,
  tipAngleDeg: 90,
};

// Auto resolution for the 6 mm bit is 0.75 mm, so anything narrower than
// 1.5 mm vanishes from the δ ladder — exactly the reported failure mode.
const AUTO_DELTA_MM = VBIT_90.diameterMm / 8;
const AT = 50;
const MAX_DEPTH = 2;
const CELL = 0.05;
const STROKE_W = 0.6;

function scene(polyline: Polyline, bounds: ImportedSvg['bounds']): Scene {
  const object: ImportedSvg = {
    kind: 'imported-svg',
    id: 'O1',
    source: 'O1.svg',
    bounds,
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: '#ff0000', polylines: [polyline] }],
  };
  return {
    objects: [object],
    layers: [
      {
        ...createLayer({ id: 'L1', color: '#ff0000' }),
        cnc: {
          ...DEFAULT_CNC_LAYER_SETTINGS,
          cutType: 'v-carve',
          depthMm: MAX_DEPTH,
          depthPerPassMm: MAX_DEPTH,
          vResolutionMm: 0, // auto — the setting the bug was reported with
        },
      },
    ],
  };
}

function vbitConfig(): CncMachineConfig {
  return { ...DEFAULT_CNC_MACHINE_CONFIG, tools: [VBIT_90], toolId: VBIT_90.id };
}

function expectGrid(result: ReturnType<typeof computeRemovalGrid>) {
  if (result.kind === 'error') throw new Error(result.reason);
  return result.grid;
}

function machinePolygon(points: ReadonlyArray<Vec2>): ReadonlyArray<Vec2> {
  return points.map((point) => toMachineCoords(point, DEFAULT_DEVICE_PROFILE));
}

function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lengthSq = abx * abx + aby * aby;
  const t =
    lengthSq === 0
      ? 0
      : Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / lengthSq));
  return Math.hypot(p.x - (a.x + t * abx), p.y - (a.y + t * aby));
}

function distToBoundary(p: Vec2, polygon: ReadonlyArray<Vec2>): number {
  let min = Number.POSITIVE_INFINITY;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    if (a === undefined || b === undefined) continue;
    min = Math.min(min, distToSegment(p, a, b));
  }
  return min;
}

function removalGridFor(sceneValue: Scene, bboxMachine: ReadonlyArray<Vec2>) {
  const xs = bboxMachine.map((point) => point.x);
  const ys = bboxMachine.map((point) => point.y);
  const [minX, maxX] = [Math.min(...xs), Math.max(...xs)];
  const [minY, maxY] = [Math.min(...ys), Math.max(...ys)];
  const job = compileCncJob(sceneValue, DEFAULT_DEVICE_PROFILE, vbitConfig());
  const toolpath = buildToolpath(job);
  return expectGrid(
    computeRemovalGrid(
      toolpath,
      {
        originX: minX - 2,
        originY: minY - 2,
        widthMm: maxX - minX + 4,
        heightMm: maxY - minY + 4,
        mmPerCell: CELL,
      },
      kernelForTool(VBIT_90, CELL),
    ),
  );
}

describe('v-carve thin artwork — perceptual (ADR-279)', () => {
  it('a stroke narrower than 2·δ is carved to its analytic shallow groove, not dropped', () => {
    const points: ReadonlyArray<Vec2> = [
      { x: AT, y: AT },
      { x: AT + 8, y: AT },
      { x: AT + 8, y: AT + STROKE_W },
      { x: AT, y: AT + STROKE_W },
    ];
    const polygon = machinePolygon(points);
    const grid = removalGridFor(
      scene({ closed: true, points }, { minX: AT, minY: AT, maxX: AT + 8, maxY: AT + STROKE_W }),
      polygon,
    );

    const xs = polygon.map((point) => point.x);
    const ys = polygon.map((point) => point.y);
    const [minX, maxX] = [Math.min(...xs), Math.max(...xs)];
    const [minY, maxY] = [Math.min(...ys), Math.max(...ys)];
    const tolerance = THIN_DETAIL_RESOLUTION_MM + 2 * CELL;
    let insideCells = 0;
    let cutInside = 0;
    let maxError = 0;
    let errorSum = 0;
    for (let cy = 0; cy < grid.heightCells; cy += 1) {
      for (let cx = 0; cx < grid.widthCells; cx += 1) {
        const x = grid.originX + (cx + 0.5) * grid.mmPerCell;
        const y = grid.originY + (cy + 0.5) * grid.mmPerCell;
        if (x < minX || x > maxX || y < minY || y > maxY) continue;
        const cellDepth = grid.depth[cy * grid.widthCells + cx] ?? 0;
        const analytic = -Math.min(distToBoundary({ x, y }, polygon), MAX_DEPTH);
        insideCells += 1;
        if (cellDepth < 0) cutInside += 1;
        const error = Math.abs(cellDepth - analytic);
        maxError = Math.max(maxError, error);
        errorSum += error;
      }
    }
    expect(insideCells).toBeGreaterThan(0);
    // Before ADR-279 this was 0.0: the whole stroke was silently dropped.
    expect(cutInside / insideCells).toBeGreaterThanOrEqual(0.9);
    expect(maxError).toBeLessThanOrEqual(tolerance);
    expect(errorSum / insideCells).toBeLessThanOrEqual(tolerance / 2);
  });

  it('a glyph with a thick body and a thin tail carves the tail too (the "Drive" bug)', () => {
    // 6×6 body with a 0.6×6 tail off its right edge — the shape of a script
    // letter with a thin connector.
    const points: ReadonlyArray<Vec2> = [
      { x: AT, y: AT },
      { x: AT + 6, y: AT },
      { x: AT + 6, y: AT + 2.7 },
      { x: AT + 12, y: AT + 2.7 },
      { x: AT + 12, y: AT + 2.7 + STROKE_W },
      { x: AT + 6, y: AT + 2.7 + STROKE_W },
      { x: AT + 6, y: AT + 6 },
      { x: AT, y: AT + 6 },
    ];
    const polygon = machinePolygon(points);
    const grid = removalGridFor(
      scene({ closed: true, points }, { minX: AT, minY: AT, maxX: AT + 12, maxY: AT + 6 }),
      polygon,
    );

    // The tail's interior, clear of the junction blend (one δ) and of the
    // near-zero-depth edges.
    const tailA = toMachineCoords(
      { x: AT + 6 + AUTO_DELTA_MM + 0.5, y: AT + 2.7 + 0.15 },
      DEFAULT_DEVICE_PROFILE,
    );
    const tailB = toMachineCoords(
      { x: AT + 12 - 0.15, y: AT + 2.7 + STROKE_W - 0.15 },
      DEFAULT_DEVICE_PROFILE,
    );
    const [tailMinX, tailMaxX] = [Math.min(tailA.x, tailB.x), Math.max(tailA.x, tailB.x)];
    const [tailMinY, tailMaxY] = [Math.min(tailA.y, tailB.y), Math.max(tailA.y, tailB.y)];
    const tolerance = THIN_DETAIL_RESOLUTION_MM + 2 * CELL;
    let tailCells = 0;
    let tailCut = 0;
    let tailMaxError = 0;
    for (let cy = 0; cy < grid.heightCells; cy += 1) {
      for (let cx = 0; cx < grid.widthCells; cx += 1) {
        const x = grid.originX + (cx + 0.5) * grid.mmPerCell;
        const y = grid.originY + (cy + 0.5) * grid.mmPerCell;
        if (x < tailMinX || x > tailMaxX || y < tailMinY || y > tailMaxY) continue;
        const cellDepth = grid.depth[cy * grid.widthCells + cx] ?? 0;
        const analytic = -Math.min(distToBoundary({ x, y }, polygon), MAX_DEPTH);
        tailCells += 1;
        if (cellDepth < 0) tailCut += 1;
        tailMaxError = Math.max(tailMaxError, Math.abs(cellDepth - analytic));
      }
    }
    expect(tailCells).toBeGreaterThan(0);
    // Before ADR-279: 0.0 — the connector never received a single cut.
    expect(tailCut / tailCells).toBeGreaterThanOrEqual(0.9);
    expect(tailMaxError).toBeLessThanOrEqual(tolerance);
  });

  it('emits deterministic G-code for the thin-stroke job (snapshot)', () => {
    const points: ReadonlyArray<Vec2> = [
      { x: AT, y: AT },
      { x: AT + 8, y: AT },
      { x: AT + 8, y: AT + STROKE_W },
      { x: AT, y: AT + STROKE_W },
    ];
    const job = compileCncJob(
      scene({ closed: true, points }, { minX: AT, minY: AT, maxX: AT + 8, maxY: AT + STROKE_W }),
      DEFAULT_DEVICE_PROFILE,
      vbitConfig(),
    );
    const gcode = cncGrblStrategy.emit(job, DEFAULT_DEVICE_PROFILE);
    expect(gcode.length).toBeGreaterThan(0);
    expect(gcode).toMatchSnapshot();
  });
});
