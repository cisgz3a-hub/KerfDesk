import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, toMachineCoords } from '../devices';
import { buildToolpath, type CncGroup, type Job } from '../job';
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
} from '../scene';
import { findCncOffsetLadderDiagnostics } from './cnc-offset-ladder-diagnostics';
import { compileCncJob } from './compile-cnc-job';

const AT = 50;
const LENGTH_MM = 8;
const RESOLUTION_MM = 0.1;
const CELL_MM = 0.1;
const MAX_DEPTH_MM = 1;

const POINT_VBIT: CncTool = {
  id: 'point-v90',
  name: '90 degree V-bit',
  kind: 'v-bit',
  diameterMm: 2,
  tipAngleDeg: 90,
};

const POINT_ENGRAVER: CncTool = {
  ...POINT_VBIT,
  id: 'point-engraver',
  name: '90 degree pointed engraver',
  kind: 'engraving',
};

const FLAT_ENGRAVER: CncTool = {
  ...POINT_ENGRAVER,
  id: 'flat-engraver',
  name: '90 degree 0.4 mm-tip engraver',
  tipDiameterMm: 0.4,
};

function band(widthMm: number): Polyline {
  return {
    closed: true,
    points: [
      { x: AT, y: AT },
      { x: AT + LENGTH_MM, y: AT },
      { x: AT + LENGTH_MM, y: AT + widthMm },
      { x: AT, y: AT + widthMm },
    ],
  };
}

function mixedWideBodyAndTail(): Polyline {
  return {
    closed: true,
    points: [
      { x: AT, y: AT },
      { x: AT + 4, y: AT },
      { x: AT + 4, y: AT + 1.85 },
      { x: AT + 8, y: AT + 1.85 },
      { x: AT + 8, y: AT + 2.15 },
      { x: AT + 4, y: AT + 2.15 },
      { x: AT + 4, y: AT + 4 },
      { x: AT, y: AT + 4 },
    ],
  };
}

function sceneFor(polyline: Polyline): Scene {
  const xs = polyline.points.map((point) => point.x);
  const ys = polyline.points.map((point) => point.y);
  const object: ImportedSvg = {
    kind: 'imported-svg',
    id: 'artwork',
    source: 'flat-tip-fixture.svg',
    bounds: {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys),
    },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: '#ff0000', polylines: [polyline] }],
  };
  return {
    objects: [object],
    layers: [
      {
        ...createLayer({ id: 'flat-tip-layer', color: '#ff0000' }),
        cnc: {
          ...DEFAULT_CNC_LAYER_SETTINGS,
          cutType: 'v-carve',
          vCarveFlatDepthEnabled: true,
          depthMm: MAX_DEPTH_MM,
          depthPerPassMm: MAX_DEPTH_MM,
          vResolutionMm: RESOLUTION_MM,
        },
      },
    ],
  };
}

function machine(tool: CncTool): CncMachineConfig {
  return { ...DEFAULT_CNC_MACHINE_CONFIG, tools: [tool], toolId: tool.id };
}

function onlyCncGroup(job: Job): CncGroup | null {
  const groups = job.groups.filter((group): group is CncGroup => group.kind === 'cnc');
  expect(groups.length).toBeLessThanOrEqual(1);
  return groups[0] ?? null;
}

function deepestMm(group: CncGroup | null): number {
  if (group === null) return 0;
  let deepest = 0;
  for (const pass of group.passes) {
    if (pass.kind !== 'path3d') continue;
    for (const point of pass.points) deepest = Math.max(deepest, -point.z);
  }
  return deepest;
}

describe('flat-tip V-carve through compile and simulation', () => {
  it('preserves point geometry and changes only the truncated envelope', () => {
    const scene = sceneFor(band(0.6));
    const vbit = onlyCncGroup(compileCncJob(scene, DEFAULT_DEVICE_PROFILE, machine(POINT_VBIT)));
    const pointEngraver = onlyCncGroup(
      compileCncJob(scene, DEFAULT_DEVICE_PROFILE, machine(POINT_ENGRAVER)),
    );
    const flatEngraver = onlyCncGroup(
      compileCncJob(scene, DEFAULT_DEVICE_PROFILE, machine(FLAT_ENGRAVER)),
    );

    expect(pointEngraver?.passes).toEqual(vbit?.passes);
    expect(deepestMm(vbit)).toBeGreaterThanOrEqual(0.299);
    expect(deepestMm(flatEngraver)).toBeGreaterThanOrEqual(0.099);
    expect(deepestMm(flatEngraver)).toBeLessThanOrEqual(0.1);
    expect(flatEngraver?.passes).not.toEqual(vbit?.passes);
  });

  it.each([
    ['below', 0.3, false],
    ['at', 0.4, false],
    ['above', 0.6, true],
  ] as const)('emits positive motion only $label the tip diameter', (_label, widthMm, emits) => {
    const scene = sceneFor(band(widthMm));
    const group = onlyCncGroup(
      compileCncJob(scene, DEFAULT_DEVICE_PROFILE, machine(FLAT_ENGRAVER)),
    );
    expect(deepestMm(group) > 0).toBe(emits);
    if (!emits) {
      expect(
        findCncOffsetLadderDiagnostics(scene, DEFAULT_DEVICE_PROFILE, machine(FLAT_ENGRAVER)),
      ).toContainEqual({ layerId: 'flat-tip-layer', kind: 'thin-detail-dropped' });
    }
  });

  it('keeps a mixed wide body cutting while disclosing its sub-tip tail', () => {
    const scene = sceneFor(mixedWideBodyAndTail());
    const config = machine(FLAT_ENGRAVER);
    expect(
      deepestMm(onlyCncGroup(compileCncJob(scene, DEFAULT_DEVICE_PROFILE, config))),
    ).toBeGreaterThan(0);
    expect(findCncOffsetLadderDiagnostics(scene, DEFAULT_DEVICE_PROFILE, config)).toContainEqual({
      layerId: 'flat-tip-layer',
      kind: 'thin-detail-dropped',
    });
  });

  it('contains compiled flat-tip removal to the source within one simulator cell', () => {
    const widthMm = 2.4;
    const scene = sceneFor(band(widthMm));
    const job = compileCncJob(scene, DEFAULT_DEVICE_PROFILE, machine(FLAT_ENGRAVER));
    const a = toMachineCoords({ x: AT, y: AT }, DEFAULT_DEVICE_PROFILE);
    const b = toMachineCoords({ x: AT + LENGTH_MM, y: AT + widthMm }, DEFAULT_DEVICE_PROFILE);
    const minX = Math.min(a.x, b.x);
    const maxX = Math.max(a.x, b.x);
    const minY = Math.min(a.y, b.y);
    const maxY = Math.max(a.y, b.y);
    const result = computeRemovalGrid(
      buildToolpath(job),
      {
        originX: minX - 1,
        originY: minY - 1,
        widthMm: maxX - minX + 2,
        heightMm: maxY - minY + 2,
        mmPerCell: CELL_MM,
      },
      kernelForTool(FLAT_ENGRAVER, CELL_MM),
    );
    if (result.kind === 'error') throw new Error(result.reason);
    let cutCells = 0;
    let maximumOutsideMm = 0;
    let errorSumMm = 0;
    let insideCells = 0;
    for (let cy = 0; cy < result.grid.heightCells; cy += 1) {
      for (let cx = 0; cx < result.grid.widthCells; cx += 1) {
        const index = cy * result.grid.widthCells + cx;
        const x = result.grid.originX + (cx + 0.5) * result.grid.mmPerCell;
        const y = result.grid.originY + (cy + 0.5) * result.grid.mmPerCell;
        const actual = result.grid.depth[index] ?? 0;
        if (actual < 0) {
          cutCells += 1;
          maximumOutsideMm = Math.max(
            maximumOutsideMm,
            Math.max(minX - x, x - maxX, minY - y, y - maxY, 0),
          );
        }
        if (x < minX || x > maxX || y < minY || y > maxY) continue;
        const clearanceMm = Math.min(x - minX, maxX - x, y - minY, maxY - y);
        const expected = -Math.min(Math.max(0, clearanceMm - 0.2), 0.8);
        errorSumMm += Math.abs(actual - expected);
        insideCells += 1;
      }
    }
    expect(cutCells).toBeGreaterThan(0);
    expect(maximumOutsideMm).toBeLessThanOrEqual(CELL_MM + 1e-9);
    expect(errorSumMm / insideCells).toBeLessThanOrEqual(RESOLUTION_MM + CELL_MM);
  });
});
