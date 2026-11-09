// Rolling audit v11 W6-P2-2: where the relief roughing bit could not enter, it
// left full stock and the finishing ball then slotted it full width and full
// depth at the finishing feed (13.85 mm² of cross-section in an 8 mm channel,
// against 4.80 mm² for a 1/8" roughing pass), with Job Review claiming the
// roughing levels for the whole relief. The oracle here is the refuter's own
// stock simulator (zz-w6r/p2sim.mts), run on the compiled passes: it sweeps
// each cutter's flat or ball profile over a stock grid in program order and
// measures what each level finishing move removes per millimetre.
import { describe, expect, it } from 'vitest';
import { testReliefHeightfield } from '../../__fixtures__/relief-heightfield';
import type { Vec3 } from '../../core/geometry/vec3';
import type { CncGroup, CncPass } from '../../core/job';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type CncTool,
  type Project,
  type ReliefObject,
} from '../../core/scene';
import { detectMachineJobWarnings } from '../../ui/laser/machine-job-warnings';
import { buildEffectiveOperationReview } from '../../ui/laser/job-review/job-review-effective-operations';
import { cncOperationDetail } from '../../ui/laser/job-review/job-review-detail-facts';
import { prepareOutput } from './prepare-output';

const PX = 0.1;
const SIZE_MM = 44;
const DEPTH_MM = 5;
const ORIGIN = 20;
const NARROW_CENTRE = 32;

// A flat-topped relief with a 16 mm channel and a narrower one, 5 mm deep.
function channelProject(narrowMm: number, along: 'x' | 'y', roughToolId: string): Project {
  const cells = SIZE_MM / PX;
  const across = (i: number): number =>
    along === 'y' ? ((i % cells) + 0.5) * PX : (Math.floor(i / cells) + 0.5) * PX;
  const inChannel = (c: number): boolean =>
    (c > 4 && c < 20) || Math.abs(c - NARROW_CENTRE) < narrowMm / 2;
  const samples = Array.from({ length: cells * cells }, (_, i) =>
    inChannel(across(i)) ? 0 : 0xffff,
  );
  const relief = {
    kind: 'relief',
    id: 'relief',
    source: 'two.png',
    color: '#a0522d',
    reliefSource: testReliefHeightfield({
      width: cells,
      height: cells,
      physicalWidthMm: SIZE_MM,
      physicalHeightMm: SIZE_MM,
      maxDepthMm: DEPTH_MM,
      samplesU16: samples,
    }),
    targetWidthMm: SIZE_MM,
    reliefDepthMm: DEPTH_MM,
    bounds: { minX: ORIGIN, minY: ORIGIN, maxX: ORIGIN + SIZE_MM, maxY: ORIGIN + SIZE_MM },
    transform: { ...IDENTITY_TRANSFORM, x: ORIGIN, y: ORIGIN },
    operationIds: ['r'],
  } as ReliefObject;
  const base = createProject();
  return {
    ...base,
    machine: DEFAULT_CNC_MACHINE_CONFIG,
    scene: {
      ...base.scene,
      objects: [relief],
      layers: [
        {
          ...createLayer({ id: 'r', color: '#a0522d', name: 'Relief' }),
          output: true,
          cnc: {
            ...DEFAULT_CNC_LAYER_SETTINGS,
            toolId: roughToolId,
            depthPerPassMm: 1.5,
            reliefFinishToolId: 'bn-3175',
          },
        },
      ],
    },
  } as Project;
}

type Sweep = {
  maxFinishCrossSectionMm2: number;
  // Most stock any one level finishing move took off a single grid cell.
  maxFinishLevelDepthMm: number;
  deepFinishMoves: number;
};

// The refuter's simulator on compiled passes, over a 0.1 mm grid spanning the
// narrow channel and one bit either side, in program (machine) coordinates.
function sweep(
  groups: ReadonlyArray<CncGroup>,
  tools: ReadonlyArray<CncTool>,
  narrowMm: number,
  along: 'x' | 'y',
): Sweep {
  const G = 0.1;
  const centre = ORIGIN + NARROW_CENTRE;
  const half = narrowMm / 2 + 4;
  // Machine Y runs the other way from the scene, so bound both axes generously.
  const [x0, x1, y0, y1] =
    along === 'y'
      ? [centre - half, centre + half, 0, 400]
      : [0, 400, 400 - centre - half, 400 - centre + half];
  const nx = Math.ceil((x1 - x0) / G);
  const ny = Math.ceil((y1 - y0) / G);
  const stock = new Float32Array(nx * ny);
  const inNarrow = (p: Vec3): boolean =>
    Math.abs((along === 'y' ? p.x : 400 - p.y) - centre) < narrowMm / 2;
  const result: Sweep = {
    maxFinishCrossSectionMm2: 0,
    maxFinishLevelDepthMm: 0,
    deepFinishMoves: 0,
  };
  let moveDepth = 0;
  for (const group of groups) {
    const tool = tools.find((t) => t.id === group.toolId);
    if (tool === undefined) throw new Error(`no tool ${group.toolId}`);
    const radius = tool.diameterMm / 2;
    const ball = tool.kind === 'ball-nose';
    // Stock the cutter removes with its tip at one point, in mm³.
    const cutAt = (cx: number, cy: number, cz: number): number => {
      if (cx + radius < x0 || cx - radius > x1 || cy + radius < y0 || cy - radius > y1) return 0;
      let removed = 0;
      for (
        let gy = Math.max(0, Math.floor((cy - radius - y0) / G));
        gy <= Math.min(ny - 1, Math.ceil((cy + radius - y0) / G));
        gy += 1
      )
        for (
          let gx = Math.max(0, Math.floor((cx - radius - x0) / G));
          gx <= Math.min(nx - 1, Math.ceil((cx + radius - x0) / G));
          gx += 1
        ) {
          const d = Math.hypot(x0 + gx * G - cx, y0 + gy * G - cy);
          if (d > radius) continue;
          const bottom = cz + (ball ? radius - Math.sqrt(radius * radius - d * d) : 0);
          const index = gy * nx + gx;
          if (stock[index]! > bottom) {
            removed += (stock[index]! - bottom) * G * G;
            moveDepth = Math.max(moveDepth, stock[index]! - bottom);
            stock[index] = bottom;
          }
        }
      return removed;
    };
    for (const points of passPoints(group.passes)) {
      // The emitter plunges to each pass's first point: a vertical move,
      // measured by no lateral cross-section.
      const start = points[0];
      if (start !== undefined) cutAt(start.x, start.y, start.z);
      for (let i = 1; i < points.length; i += 1) {
        const a = points[i - 1]!;
        const b = points[i]!;
        const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) / 0.05));
        let removed = 0;
        moveDepth = 0;
        for (let k = 1; k <= n; k += 1)
          removed += cutAt(
            a.x + ((b.x - a.x) * k) / n,
            a.y + ((b.y - a.y) * k) / n,
            a.z + ((b.z - a.z) * k) / n,
          );
        const xy = Math.hypot(b.x - a.x, b.y - a.y);
        if (
          group.cutType === 'relief-finish' &&
          levelMove(a, b) &&
          inNarrow({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: 0 })
        ) {
          result.maxFinishCrossSectionMm2 = Math.max(result.maxFinishCrossSectionMm2, removed / xy);
          result.maxFinishLevelDepthMm = Math.max(result.maxFinishLevelDepthMm, moveDepth);
          if (b.z <= -DEPTH_MM + 0.1) result.deepFinishMoves += 1;
        }
      }
    }
  }
  return result;
}

// A lateral move at one height, long enough to measure a cross-section on.
function levelMove(a: Vec3, b: Vec3): boolean {
  return Math.abs(b.z - a.z) < 0.01 && Math.hypot(b.x - a.x, b.y - a.y) >= 0.2;
}

function passPoints(passes: ReadonlyArray<CncPass>): ReadonlyArray<ReadonlyArray<Vec3>> {
  return passes.flatMap((pass) => {
    if (pass.kind === 'path3d') return [pass.points];
    if (pass.kind !== 'contour') return [];
    const points = pass.polyline.map((p) => ({ x: p.x, y: p.y, z: pass.zMm }));
    const first = points[0];
    return [pass.closed && first !== undefined ? [...points, first] : points];
  });
}

function compiled(project: Project) {
  const result = prepareOutput(project);
  if (!result.ok) throw new Error(JSON.stringify(result.preflight));
  const groups = result.job.groups.filter((g): g is CncGroup => g.kind === 'cnc');
  const effective = buildEffectiveOperationReview(result.job, project.scene).find(
    (e) => e.layerId === 'r',
  );
  const settings = project.scene.layers[0]?.cnc ?? DEFAULT_CNC_LAYER_SETTINGS;
  const detail = cncOperationDetail(
    settings,
    6.35,
    effective?.plungingReliefStages,
    effective?.relief,
  );
  return {
    result,
    groups,
    detail,
    warnings: detectMachineJobWarnings(project, null, null, result),
  };
}

const TOOLS = DEFAULT_CNC_MACHINE_CONFIG.tools;
// A 1/8" bit taking one 1.5 mm depth per pass plus the 0.5 mm finishing
// allowance: the most a finishing pass meets after roughing that reached
// (the refuter's 4.80 mm² for a 1/8" roughing pass, plus the allowance).
const REACHED_CROSS_SECTION_MM2 = 3.175 * 2;
const DEPTH_PER_PASS_MM = 1.5;

describe('finishing steps down where relief roughing could not reach (W6-P2-2)', () => {
  it.each(['y', 'x'] as const)(
    'steps the 1/8" ball down an 8 mm channel along %s that a 1/4" roughing bit cannot enter',
    (along) => {
      const project = channelProject(8, along, 'em-6350');
      const { result, groups, detail, warnings } = compiled(project);
      const plans = result.job.cncCompilation?.reliefPlans ?? [];
      const roughing = plans.find((plan) => plan.stage === 'roughing');
      const finishing = plans.find((plan) => plan.stage === 'finishing');
      expect(roughing?.roughingMissedAreaMm2).toBeGreaterThan(100);
      expect(finishing?.finishingStepLevels).toBeGreaterThanOrEqual(2);
      const measured = sweep(groups, TOOLS, 8, along);
      // Before the fix: 13.85 mm² (across) / 13.29 mm² over 40 mm (along), and
      // the whole 5 mm channel depth off one cell in one level move.
      expect(measured.maxFinishCrossSectionMm2).toBeLessThan(REACHED_CROSS_SECTION_MM2);
      expect(measured.maxFinishLevelDepthMm).toBeLessThanOrEqual(DEPTH_PER_PASS_MM + 0.01);
      expect(measured.deepFinishMoves).toBeGreaterThan(0);
      expect(detail).toMatch(
        /relief roughing \d+ levels to [\d.]+ mm, not reaching about \d+ mm² \(finishing steps down \d+ levels there\)/,
      );
      expect(warnings).toContainEqual(
        expect.stringMatching(
          /the 6\.35 mm roughing bit cannot reach about \d+ mm² of the relief.*The 3\.175 mm finishing bit cuts it first in \d+ step-down levels/s,
        ),
      );
    },
    120_000,
  );

  it('adds nothing where a 1/8" roughing bit reaches the same channel', () => {
    const { result, warnings, detail } = compiled(channelProject(8, 'y', 'em-3175'));
    const plans = result.job.cncCompilation?.reliefPlans ?? [];
    expect(plans.find((plan) => plan.stage === 'roughing')?.roughingMissedAreaMm2).toBeUndefined();
    expect(plans.find((plan) => plan.stage === 'finishing')?.finishingStepLevels).toBeUndefined();
    expect(detail).not.toContain('not reaching');
    expect(warnings.join('\n')).not.toContain('cannot reach');
  }, 120_000);
});
