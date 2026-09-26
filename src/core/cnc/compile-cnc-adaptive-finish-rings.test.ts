// ADR-154 Amendment 2 through the real compiler, the G-code emitter and the
// removal simulator the 3D preview uses: each adaptive finishing ring ends
// where it starts, whatever the cut direction and machine frame.

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, toMachineCoords, type DeviceProfile } from '../devices';
import { buildToolpath, type CncContourPass, type Job } from '../job';
import { cncGrblStrategy } from '../output';
import { computeRemovalGrid, kernelForTool } from '../sim';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  createLayer,
  type CncCutDirection,
  type CncLayerSettings,
  type CncTool,
  type ImportedSvg,
  type Scene,
  type Vec2,
} from '../scene';
import { compileCncJob } from './compile-cnc-job';

const DEPTH_MM = 3;
const CELL_MM = 0.05;
// A flat end mill cuts every reached cell to the floor exactly.
const FLAT_SLACK_MM = 0.01;
// Cells whose centre the cutter reaches by less than this are left out of the
// count, so the rounding of the ring's coordinates cannot decide it.
const REACH_MARGIN_MM = 0.01;

function starterTool(id: string): CncTool {
  const found = DEFAULT_CNC_MACHINE_CONFIG.tools.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`missing starter tool ${id}`);
  return found;
}

function squareArtwork(minMm: number, sizeMm: number): ImportedSvg {
  const maxMm = minMm + sizeMm;
  return {
    kind: 'imported-svg',
    id: 'square',
    source: 'square.svg',
    bounds: { minX: minMm, minY: minMm, maxX: maxMm, maxY: maxMm },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#ff0000',
        polylines: [
          {
            closed: true,
            points: [
              { x: minMm, y: minMm },
              { x: maxMm, y: minMm },
              { x: maxMm, y: maxMm },
              { x: minMm, y: maxMm },
            ],
          },
        ],
      },
    ],
  };
}

// The layer defaults minus their cut direction (Climb), so a case can leave it
// unset, as the layer's "Default direction" choice does.
const { cutDirection: defaultCutDirection, ...undirectedDefaults } = DEFAULT_CNC_LAYER_SETTINGS;

// An adaptive pocket 3 mm deep at the default settings otherwise: Climb,
// 1.5 mm per pass and the 3.175 mm end mill.
function compileSquare(
  sizeMm: number,
  settings: Partial<CncLayerSettings> = {},
  device: DeviceProfile = DEFAULT_DEVICE_PROFILE,
  cutDirection: CncCutDirection | null = defaultCutDirection ?? null,
): Job {
  const scene: Scene = {
    objects: [squareArtwork(40, sizeMm)],
    layers: [
      {
        ...createLayer({ id: 'L1', color: '#ff0000' }),
        cnc: {
          ...undirectedDefaults,
          ...(cutDirection === null ? {} : { cutDirection }),
          cutType: 'pocket',
          pocketStrategy: 'adaptive',
          depthMm: DEPTH_MM,
          ...settings,
        },
      },
    ],
  };
  return compileCncJob(scene, device, DEFAULT_CNC_MACHINE_CONFIG);
}

// A 12 mm square at the 1.5 mm engagement limit keeps the roughing short
// enough to simulate on a grid fine enough for the seam's sliver.
function compileSmallSquare(
  cutDirection: CncCutDirection | null = defaultCutDirection ?? null,
  device: DeviceProfile = DEFAULT_DEVICE_PROFILE,
): Job {
  return compileSquare(12, { adaptiveOptimalLoadMm: 1.5 }, device, cutDirection);
}

function finishingPasses(job: Job): ReadonlyArray<CncContourPass> {
  return job.groups.flatMap((group) =>
    group.kind === 'cnc'
      ? group.passes.filter((pass): pass is CncContourPass => pass.kind === 'contour')
      : [],
  );
}

function expectNear(point: Vec2 | undefined, x: number, y: number): void {
  expect(point?.x).toBeCloseTo(x, 6);
  expect(point?.y).toBeCloseTo(y, 6);
}

function expectRingEndsWhereItStarts(pass: CncContourPass): void {
  const points = pass.polyline;
  expect(pass.closed).toBe(true);
  expect(points.length).toBeGreaterThanOrEqual(5);
  // The start stays mid-way along the ring's longest side (ADR-251): half
  // way between the corner the ring leaves for and the corner it closes from.
  const start = points[0];
  const next = points[1];
  const closingCorner = points[points.length - 2];
  if (start === undefined || next === undefined || closingCorner === undefined) {
    throw new Error('expected a finishing ring');
  }
  expectNear(start, (next.x + closingCorner.x) / 2, (next.y + closingCorner.y) / 2);
  expect(points[points.length - 1]).toEqual(start);
  // The old closing point no longer stands in the ring as a repeated vertex.
  for (let index = 1; index < points.length; index += 1) {
    expect(points[index]).not.toEqual(points[index - 1]);
  }
}

// The finishing pass at one depth as emitted, from its rapid to its start
// through the retract that ends it.
function emittedFinishingPass(gcode: string, start: string, zWord: string): ReadonlyArray<string> {
  const lines = gcode.split('\n');
  const first = lines.findIndex(
    (line, index) => line === `G0 ${start}` && lines[index + 1]?.startsWith(`G1 ${zWord} `),
  );
  if (first < 0) throw new Error(`no finishing pass at ${zWord}`);
  const retract = lines.findIndex((line, index) => index > first && line.startsWith('G0 Z'));
  return lines.slice(first, retract + 1);
}

describe('adaptive pocket finishing rings', () => {
  it('close the 30 mm square at every depth with exactly one closing move', () => {
    // The 2026-09-27 reproduction: a 30 mm square at 40..70 scene mm. Each
    // finishing pass started mid-way up its right wall and stopped at the
    // corner below it, 13.4 mm short, with that corner listed twice.
    const job = compileSquare(30);
    const passes = finishingPasses(job);
    expect(passes.map((pass) => pass.zMm)).toEqual([-1.5, -3]);
    for (const pass of passes) {
      // The finishing ring sits on the planner's 0.001 mm grid.
      const expected = [
        [68.413, 345.0005],
        [68.413, 358.413],
        [41.588, 358.413],
        [41.588, 331.588],
        [68.413, 331.588],
        [68.413, 345.0005],
      ] as const;
      expect(pass.polyline).toHaveLength(expected.length);
      expected.forEach(([x, y], index) => expectNear(pass.polyline[index], x, y));
      expectRingEndsWhereItStarts(pass);
    }

    const gcode = cncGrblStrategy.emit(job, DEFAULT_DEVICE_PROFILE);
    for (const zWord of ['Z-1.500', 'Z-3.000']) {
      expect(emittedFinishingPass(gcode, 'X68.413 Y345.000', zWord)).toEqual([
        'G0 X68.413 Y345.000',
        `G1 ${zWord} F300`,
        'G1 X68.413 Y358.413 F1000',
        'G1 X41.588 Y358.413',
        'G1 X41.588 Y331.588',
        'G1 X68.413 Y331.588',
        'G1 X68.413 Y345.000',
        'G0 Z3.810',
      ]);
    }
  }, 60_000);

  it.each<[string, CncCutDirection | null, DeviceProfile, boolean]>([
    ['Conventional', 'conventional', DEFAULT_DEVICE_PROFILE, true],
    [
      'Climb on a mirrored frame',
      'climb',
      { ...DEFAULT_DEVICE_PROFILE, origin: 'front-right' },
      true,
    ],
    // Without a direction the rings keep the planner's start and closing point.
    ['no cut direction', null, DEFAULT_DEVICE_PROFILE, false],
  ])('end where they start with %s', (_label, cutDirection, device, rotated) => {
    const passes = finishingPasses(compileSmallSquare(cutDirection, device));
    expect(passes).toHaveLength(2);
    for (const pass of passes) {
      expect(pass.polyline[pass.polyline.length - 1]).toEqual(pass.polyline[0]);
      if (rotated) expectRingEndsWhereItStarts(pass);
    }
  });

  it('leave no stock standing at the finishing seam', () => {
    const cutter = starterTool('em-3175');
    const radiusMm = cutter.diameterMm / 2;
    const job = compileSmallSquare();
    const corners = [
      toMachineCoords({ x: 40, y: 40 }, DEFAULT_DEVICE_PROFILE),
      toMachineCoords({ x: 52, y: 52 }, DEFAULT_DEVICE_PROFILE),
    ];
    const minX = Math.min(...corners.map((corner) => corner.x));
    const maxX = Math.max(...corners.map((corner) => corner.x));
    const minY = Math.min(...corners.map((corner) => corner.y));
    const maxY = Math.max(...corners.map((corner) => corner.y));
    const result = computeRemovalGrid(
      buildToolpath(job),
      {
        originX: minX,
        originY: minY,
        widthMm: maxX - minX,
        heightMm: maxY - minY,
        mmPerCell: CELL_MM,
      },
      kernelForTool(cutter, CELL_MM),
    );
    if (result.kind === 'error') throw new Error(result.reason);
    const grid = result.grid;

    // The bit reaches every point within its radius of the tool-centre square,
    // the pocket inset by that radius: all of the pocket but its corners.
    const centreX = (minX + maxX) / 2;
    const centreY = (minY + maxY) / 2;
    const insetHalfMm = (maxX - minX) / 2 - radiusMm;
    let standing = 0;
    for (let row = 0; row < grid.heightCells; row += 1) {
      for (let col = 0; col < grid.widthCells; col += 1) {
        const x = grid.originX + (col + 0.5) * CELL_MM;
        const y = grid.originY + (row + 0.5) * CELL_MM;
        const fromCentreSquare = Math.hypot(
          Math.max(0, Math.abs(x - centreX) - insetHalfMm),
          Math.max(0, Math.abs(y - centreY) - insetHalfMm),
        );
        if (fromCentreSquare > radiusMm - REACH_MARGIN_MM) continue;
        const depth = grid.depth[row * grid.widthCells + col] ?? 0;
        if (depth > -DEPTH_MM + FLAT_SLACK_MM) standing += 1;
      }
    }
    // The roughing's outer ring runs along the walls with its corners rounded
    // off, so the half side each finishing ring dropped left 30 of these
    // cells standing to the stock top: a sliver up to 0.14 mm thick on the
    // wall beside the seam's corner.
    expect(standing).toBe(0);
  }, 60_000);
});
