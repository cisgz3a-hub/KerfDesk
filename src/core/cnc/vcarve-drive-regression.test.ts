import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { findNonFiniteCoords, findPlungedTravelIssues } from '../invariants';
import { cncGrblStrategy } from '../output';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  createLayer,
  type CncMachineConfig,
  type CncTool,
  type ImportedSvg,
  type Scene,
} from '../scene';
import { textToPolylines } from '../text';
import {
  compileCncJob,
  finalizeCncCompilationArtifact,
  prepareBoundCncCompilation,
} from './compile-cnc-job';
import { runCncCompilationTask } from './cnc-compilation-artifact';
import {
  gcodeCuttingEntryCount,
  gcodeXyzFeedBlockCount,
  worstGrblPlannerWindow,
} from './vcarve-gcode-regression.test-support';

const DRIVE_TEXT = 'Drive';
const DRIVE_SIZE_MM = 10;
const DRIVE_LINE_HEIGHT = 1.4;
const DRIVE_FONT_FILE = 'DancingScript-Regular.ttf';
const DRIVE_COLOR = '#ff0000';
const DRIVE_LAYER_ID = 'operation-38c920a6-9981-4303-b708-8842b955ca33';
const DRIVE_TOOL_ID = '15747405-c421-4e59-ab22-f48e8e7c2925';
const DRIVE_SCALE = 5.041015859639146;
const DRIVE_X_MM = 150;
const DRIVE_Y_MM = 153.76142911852244;
const DRIVE_MAX_DEPTH_MM = 1;
const DRIVE_DEPTH_PER_PASS_MM = 1.5;
const DRIVE_RAMP_ANGLE_DEG = 0.5;
const EXPECTED_FILLED_REGIONS = 6;
const MAX_OUTPUT_BYTES = 150_000;
const MAX_OUTPUT_LINES = 5_000;
const MAX_XYZ_BLOCKS = 5_000;
const GRBL_PLANNER_WINDOW_BLOCKS = 16;
const DRIVE_FIXTURE_TIMEOUT_MS = 30_000;

const DRIVE_TOOL: CncTool = {
  id: DRIVE_TOOL_ID,
  name: 'V carve 90',
  kind: 'v-bit',
  diameterMm: 3.175,
  tipAngleDeg: 90,
};

const DRIVE_MACHINE: CncMachineConfig = {
  ...DEFAULT_CNC_MACHINE_CONFIG,
  tools: [DRIVE_TOOL],
  toolId: DRIVE_TOOL_ID,
};

type DriveCompilation = Awaited<ReturnType<typeof compileDrive>>;

async function compileDrive() {
  const bytes = readFileSync(resolve(__dirname, '../../ui/text/fonts', DRIVE_FONT_FILE));
  const fontBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const rendered = await textToPolylines({
    fontBuffer,
    content: DRIVE_TEXT,
    sizeMm: DRIVE_SIZE_MM,
    alignment: 'left',
    lineHeight: DRIVE_LINE_HEIGHT,
    letterSpacing: 0,
    color: DRIVE_COLOR,
  });
  const object: ImportedSvg = {
    kind: 'imported-svg',
    id: 'drive-text',
    source: 'DancingScript-Regular.ttf:Drive',
    bounds: rendered.bounds,
    transform: {
      ...IDENTITY_TRANSFORM,
      x: DRIVE_X_MM,
      y: DRIVE_Y_MM,
      scaleX: DRIVE_SCALE,
      scaleY: DRIVE_SCALE,
    },
    paths: rendered.paths,
  };
  const scene: Scene = {
    objects: [object],
    layers: [
      {
        ...createLayer({ id: DRIVE_LAYER_ID, color: DRIVE_COLOR }),
        cnc: {
          ...DEFAULT_CNC_LAYER_SETTINGS,
          cutType: 'v-carve',
          toolId: DRIVE_TOOL_ID,
          depthMm: DRIVE_MAX_DEPTH_MM,
          depthPerPassMm: DRIVE_DEPTH_PER_PASS_MM,
          // The supplied legacy job's mandatory 1 mm clamp is its flat-depth
          // intent. Pin that mode explicitly now that ordinary V-carve no
          // longer invents a flat floor from the generic depth field.
          vCarveFlatDepthEnabled: true,
          vResolutionMm: 0,
          vCarveRampEntryDeg: DRIVE_RAMP_ANGLE_DEG,
        },
      },
    ],
  };
  const job = compileCncJob(scene, DEFAULT_DEVICE_PROFILE, DRIVE_MACHINE);
  return { rendered, scene, job, gcode: cncGrblStrategy.emit(job, DEFAULT_DEVICE_PROFILE) };
}

function driveCncGroup(compilation: DriveCompilation) {
  const group = compilation.job.groups.find((candidate) => candidate.kind === 'cnc');
  if (group === undefined) throw new Error('Drive V-carve did not compile a CNC group.');
  return group;
}

function path3dMinX(pass: ReturnType<typeof driveCncGroup>['passes'][number]): number | null {
  if (pass.kind !== 'path3d') return null;
  return pass.points.reduce(
    (minimum, point) => Math.min(minimum, point.x),
    Number.POSITIVE_INFINITY,
  );
}

const DRIVE_COMPILATIONS = Promise.all([compileDrive(), compileDrive()]);

describe('Dancing Script Drive V-carve regression', () => {
  it(
    'keeps mixed-operation, two-object Drive output exact after out-of-order region work',
    async () => {
      const [fixture] = await DRIVE_COMPILATIONS;
      const first = fixture.scene.objects[0];
      if (first?.kind !== 'imported-svg') throw new Error('Drive fixture object is missing');
      const firstVcarveLayer = fixture.scene.layers[0];
      if (firstVcarveLayer === undefined) throw new Error('Drive fixture operation is missing');
      const profileColor = '#2563eb';
      const secondVcarveOperationId = 'drive-vcarve-second';
      const mixed: Scene = {
        objects: [
          { ...first, operationIds: [DRIVE_LAYER_ID] },
          {
            ...first,
            id: 'drive-text-second',
            operationIds: [secondVcarveOperationId],
            transform: { ...first.transform, x: first.transform.x + 70 },
          },
          {
            kind: 'imported-svg',
            id: 'profile-box',
            source: 'mixed-operation-box',
            bounds: { minX: 20, minY: 20, maxX: 35, maxY: 35 },
            transform: IDENTITY_TRANSFORM,
            paths: [
              {
                color: profileColor,
                polylines: [
                  {
                    closed: true,
                    points: [
                      { x: 20, y: 20 },
                      { x: 35, y: 20 },
                      { x: 35, y: 35 },
                      { x: 20, y: 35 },
                    ],
                  },
                ],
              },
            ],
          },
        ],
        layers: [
          ...fixture.scene.layers,
          {
            ...firstVcarveLayer,
            id: secondVcarveOperationId,
          },
          {
            ...createLayer({ id: 'profile-operation', color: profileColor }),
            cnc: {
              ...DEFAULT_CNC_LAYER_SETTINGS,
              cutType: 'profile-on-path',
              toolId: DRIVE_TOOL_ID,
              depthMm: 1,
              depthPerPassMm: 0.5,
            },
          },
        ],
      };
      const artifact = prepareBoundCncCompilation(
        { jobId: 'drive-mixed', compilationId: 'drive-mixed-parallel' },
        mixed,
        DEFAULT_DEVICE_PROFILE,
        DRIVE_MACHINE,
      );
      const results = artifact.tasks
        .map((task) => ({
          jobId: artifact.identity.compilationId,
          taskId: task.taskId,
          result: runCncCompilationTask(task.payload),
        }))
        .reverse();
      const parallel = finalizeCncCompilationArtifact(artifact, results);
      expect(parallel.kind).toBe('compiled');
      if (parallel.kind !== 'compiled') throw new Error(parallel.reason);
      const serial = compileCncJob(mixed, DEFAULT_DEVICE_PROFILE, DRIVE_MACHINE);

      expect(parallel.job).toEqual(serial);
      expect(cncGrblStrategy.emit(parallel.job, DEFAULT_DEVICE_PROFILE)).toBe(
        cncGrblStrategy.emit(serial, DEFAULT_DEVICE_PROFILE),
      );
      expect(
        parallel.job.groups.some(
          (group) => group.kind === 'cnc' && group.cutType === 'profile-on-path',
        ),
      ).toBe(true);
      expect(parallel.job.cncCompilation?.vcarveOperations).toHaveLength(2);
    },
    DRIVE_FIXTURE_TIMEOUT_MS,
  );

  it(
    'pins the exact real-font geometry and deterministic safe absolute output',
    async () => {
      const [first, second] = await DRIVE_COMPILATIONS;
      const path = first.rendered.paths[0];
      const geometry = {
        contours: path?.curves?.length ?? 0,
        curveSegments: path?.curves?.reduce((sum, curve) => sum + curve.segments.length, 0) ?? 0,
        compatibilityPoints:
          path?.polylines.reduce((sum, line) => sum + line.points.length, 0) ?? 0,
        widthMm: first.rendered.bounds.maxX - first.rendered.bounds.minX,
        heightMm: first.rendered.bounds.maxY - first.rendered.bounds.minY,
      };
      expect(geometry).toEqual({
        contours: 7,
        curveSegments: 246,
        compatibilityPoints: 2189,
        widthMm: 19.51,
        heightMm: 8.07,
      });
      expect(path?.polylines.map((line) => line.points.length)).toEqual([
        567, 425, 237, 101, 437, 298, 124,
      ]);
      expect(path?.polylines.every((line) => line.closed)).toBe(true);
      expect(second.job).toEqual(first.job);
      expect(second.gcode).toBe(first.gcode);
      expect(first.gcode).toMatch(/^G21\nG90\nG54\nG94\nG17\n/);
      expect(first.gcode).not.toMatch(/^G(?:20|91|92)\b/m);
      expect(findNonFiniteCoords(first.gcode)).toEqual([]);
      expect(findPlungedTravelIssues(first.gcode, { safeZMm: 3.81 })).toEqual([]);
      expect(first.gcode).toMatch(/G0 Z3\.810\nM5\nG0 X0\.000 Y0\.000\n$/);
    },
    DRIVE_FIXTURE_TIMEOUT_MS,
  );

  it('uses exactly one tool-down entry per filled Drive region', async () => {
    const [first] = await DRIVE_COMPILATIONS;
    const lines = first.gcode.split('\n');
    const xyzBlocks = gcodeXyzFeedBlockCount(first.gcode);

    expect(gcodeCuttingEntryCount(first.gcode)).toBe(EXPECTED_FILLED_REGIONS);
    expect(Buffer.byteLength(first.gcode, 'utf8')).toBeLessThan(MAX_OUTPUT_BYTES);
    expect(lines.length).toBeLessThan(MAX_OUTPUT_LINES);
    expect(xyzBlocks).toBeLessThan(MAX_XYZ_BLOCKS);
  });

  it('finishes filled regions once in source order: D, r, i stem, i dot, v, e', async () => {
    const [first] = await DRIVE_COMPILATIONS;
    const passes = driveCncGroup(first).passes;
    expect(passes).toHaveLength(EXPECTED_FILLED_REGIONS);
    expect(passes.every((pass) => pass.kind === 'path3d')).toBe(true);
    expect(
      passes.every((pass) => pass.kind === 'path3d' && pass.lateralFeed === 'z-rate-capped'),
    ).toBe(true);
    expect(passes.map(path3dMinX)).toEqual([150, 179.792, 197.373, 205.084, 210.114, 229.454]);
  });

  it('uses the cutting feed on flat V-carve motion while capping descending Z rate', async () => {
    const [first] = await DRIVE_COMPILATIONS;
    expect(first.gcode).toMatch(/^(?:G1)?X-?\d+\.\d{3}Y-?\d+\.\d{3}Z-?\d+\.\d{3}F1000$/m);
  });

  it('gives every full GRBL planner window at least its own 115200-baud wire time', async () => {
    const [first] = await DRIVE_COMPILATIONS;
    const worst = worstGrblPlannerWindow(first.gcode);
    expect(worst).not.toBeNull();
    if (worst === null) throw new Error('Drive output has no full cutting planner window.');
    expect(
      worst.marginSeconds,
      `planner window at G-code line ${worst.firstLine} has ${(worst.marginSeconds * 1000).toFixed(3)} ms wire margin:\n${first.gcode
        .split('\n')
        .slice(worst.firstLine - 1, worst.firstLine - 1 + GRBL_PLANNER_WINDOW_BLOCKS)
        .join('\n')}`,
    ).toBeGreaterThanOrEqual(0);
  });
});
