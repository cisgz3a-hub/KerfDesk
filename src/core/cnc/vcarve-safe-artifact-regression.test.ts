import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { findNonFiniteCoords, findPlungedTravelIssues } from '../invariants';
import type { CncPath3dPass } from '../job';
import { cncGrblStrategy } from '../output';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  createLayer,
  type ImportedSvg,
  type Scene,
} from '../scene';
import { textToPolylines } from '../text';
import { compileCncJob } from './compile-cnc-job';
import {
  gcodeCuttingEntryCount,
  gcodeXyzFeedBlockCount,
  worstGrblPlannerWindow,
} from './vcarve-gcode-regression.test-support';

const SAFE_TEXT = 'Safe';
const SAFE_FONT_FILE = 'DancingScript-Regular.ttf';
const SAFE_SIZE_MM = 10;
const SAFE_LINE_HEIGHT = 1.4;
const SAFE_SCALE_X = 6.225256797583081;
const SAFE_SCALE_Y = 6.2056;
const SAFE_X_MM = 0;
const SAFE_Y_MM = 337.944;
const SAFE_LAYER_ID = 'operation-ed02d2cc-d575-46f7-b0b6-bf68c926b7f1';
const SAFE_TOOL_ID = 'vb-30';
const SAFE_DEPTH_PER_PASS_MM = 1.5;
const SAFE_FEED_MM_PER_MIN = 1000;
const SAFE_PLUNGE_MM_PER_MIN = 300;
const SAFE_SPINDLE_RPM = 12_000;
const EXPECTED_REGIONS = 4;
const EXPECTED_PASSES = 16;
const MAX_OUTPUT_BYTES = 450_000;
const MAX_OUTPUT_LINES = 16_000;
const MAX_XYZ_BLOCKS = 16_000;
const GRBL_PLANNER_WINDOW_BLOCKS = 16;
const EXPECTED_MAX_DEPTH_MM = 5.924;
const EXPECTED_REGION_POINT_COUNTS = [
  [743, 801, 889, 930],
  [536, 584, 655, 717],
  [722, 774, 904, 1052],
  [374, 440, 557, 690],
] as const;

type SafeCompilation = Awaited<ReturnType<typeof compileSafe>>;

async function compileSafe() {
  const bytes = readFileSync(resolve(__dirname, '../../ui/text/fonts', SAFE_FONT_FILE));
  const fontBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const rendered = await textToPolylines({
    fontBuffer,
    content: SAFE_TEXT,
    sizeMm: SAFE_SIZE_MM,
    alignment: 'left',
    lineHeight: SAFE_LINE_HEIGHT,
    letterSpacing: 0,
    color: '#ff0000',
  });
  const object: ImportedSvg = {
    kind: 'imported-svg',
    id: 'safe-text-recovered',
    source: `${SAFE_FONT_FILE}:${SAFE_TEXT}`,
    bounds: rendered.bounds,
    transform: {
      ...IDENTITY_TRANSFORM,
      x: SAFE_X_MM,
      y: SAFE_Y_MM,
      scaleX: SAFE_SCALE_X,
      scaleY: SAFE_SCALE_Y,
    },
    paths: rendered.paths,
  };
  const scene: Scene = {
    objects: [object],
    layers: [
      {
        ...createLayer({ id: SAFE_LAYER_ID, color: '#ff0000' }),
        cnc: {
          ...DEFAULT_CNC_LAYER_SETTINGS,
          cutType: 'v-carve',
          toolId: SAFE_TOOL_ID,
          depthMm: 1,
          depthPerPassMm: SAFE_DEPTH_PER_PASS_MM,
          vCarveFlatDepthEnabled: false,
          vResolutionMm: 0,
          feedMmPerMin: SAFE_FEED_MM_PER_MIN,
          plungeMmPerMin: SAFE_PLUNGE_MM_PER_MIN,
          spindleRpm: SAFE_SPINDLE_RPM,
        },
      },
    ],
  };
  const job = compileCncJob(scene, DEFAULT_DEVICE_PROFILE, DEFAULT_CNC_MACHINE_CONFIG);
  return { rendered, job, gcode: cncGrblStrategy.emit(job, DEFAULT_DEVICE_PROFILE) };
}

function safePathPasses(compilation: SafeCompilation): ReadonlyArray<CncPath3dPass> {
  const group = compilation.job.groups.find((candidate) => candidate.kind === 'cnc');
  if (group === undefined) throw new Error('Recovered Safe V-carve did not compile a CNC group.');
  return group.passes.filter((pass): pass is CncPath3dPass => pass.kind === 'path3d');
}

function passMinimumX(pass: CncPath3dPass): number {
  return pass.points.reduce(
    (minimum, point) => Math.min(minimum, point.x),
    Number.POSITIVE_INFINITY,
  );
}

function passEndpointKey(pass: CncPath3dPass): string {
  const first = pass.points[0];
  const last = pass.points.at(-1);
  return `${first?.x},${first?.y}:${last?.x},${last?.y}`;
}

const SAFE_COMPILATION = compileSafe();

describe('recovered test11 Safe V-carve artifact regression', () => {
  it('pins the strongest source reconstruction available from the exported artifact', async () => {
    const compilation = await SAFE_COMPILATION;
    expect(compilation.rendered.bounds.minX).toBe(0);
    expect(compilation.rendered.bounds.minY).toBe(0);
    expect(compilation.rendered.bounds.maxX).toBeCloseTo(16.55, 12);
    expect(compilation.rendered.bounds.maxY).toBe(10);
    expect(compilation.gcode).toContain(`; cnc layer-id: ${SAFE_LAYER_ID}`);
    expect(compilation.gcode).toContain(`; cnc tool-id: ${SAFE_TOOL_ID}`);
    expect(compilation.gcode).toContain('; cnc v-carve-depth: flowing-width');
    expect(findNonFiniteCoords(compilation.gcode)).toEqual([]);
    expect(findPlungedTravelIssues(compilation.gcode, { safeZMm: 3.81 })).toEqual([]);
  });

  it('finishes all four depth levels of one region before entering the next', async () => {
    const passes = safePathPasses(await SAFE_COMPILATION);
    expect(passes).toHaveLength(EXPECTED_PASSES);
    expect(passes.every((pass) => pass.lateralFeed === 'z-rate-capped')).toBe(true);
    expect(
      EXPECTED_REGION_POINT_COUNTS.map((_, region) =>
        passes.slice(region * 4, region * 4 + 4).map((pass) => pass.points.length),
      ),
    ).toEqual(EXPECTED_REGION_POINT_COUNTS);
    const regionMinimumXs: number[] = [];
    for (let region = 0; region < EXPECTED_REGIONS; region += 1) {
      const regionPasses = passes.slice(region * 4, region * 4 + 4);
      expect(new Set(regionPasses.map(passEndpointKey)).size).toBe(1);
      regionMinimumXs.push(Math.min(...regionPasses.map(passMinimumX)));
    }
    expect(regionMinimumXs).toEqual([...regionMinimumXs].sort((a, b) => a - b));
  });

  it('keeps the regenerated program within artifact and GRBL streaming budgets', async () => {
    const { gcode } = await SAFE_COMPILATION;
    const lines = gcode.split('\n');
    const xyzBlocks = gcodeXyzFeedBlockCount(gcode);
    const passes = safePathPasses(await SAFE_COMPILATION);
    const maximumDepthMm = -Math.min(
      ...passes.flatMap((pass) => pass.points.map((point) => point.z)),
    );
    const worst = worstGrblPlannerWindow(gcode);

    expect(Buffer.byteLength(gcode, 'utf8')).toBeLessThan(MAX_OUTPUT_BYTES);
    expect(lines.length).toBeLessThan(MAX_OUTPUT_LINES);
    expect(xyzBlocks).toBeLessThan(MAX_XYZ_BLOCKS);
    expect(gcodeCuttingEntryCount(gcode)).toBe(EXPECTED_REGIONS);
    expect(maximumDepthMm).toBe(EXPECTED_MAX_DEPTH_MM);
    expect(gcode).toMatch(/^(?:G1)?X-?\d+\.\d{3}Y-?\d+\.\d{3}Z-?\d+\.\d{3}F1000$/m);
    expect(gcode).toMatch(/^G1 Z-?\d+\.\d{3} F300$/m);
    expect(worst).not.toBeNull();
    if (worst === null) throw new Error('Recovered Safe output has no full planner window.');
    expect(
      worst.marginSeconds,
      `planner window at G-code line ${worst.firstLine} has ${(worst.marginSeconds * 1000).toFixed(3)} ms wire margin:\n${lines
        .slice(worst.firstLine - 1, worst.firstLine - 1 + GRBL_PLANNER_WINDOW_BLOCKS)
        .join('\n')}`,
    ).toBeGreaterThanOrEqual(0);
  });
});
