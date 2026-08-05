import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  connectedScriptCompilationProject,
  CONNECTED_SCRIPT_ARTWORK_COUNT,
} from '../../__fixtures__/connected-script-compilation-project';
import type { CncCompilationRegionResult } from '../../core/cnc/cnc-compilation-artifact';
import type {
  asVCarveBoundarySegmentIndex,
  buildVCarveBoundarySegmentIndex,
  everyVCarveBoundarySegmentInBox,
  minimumVCarveBoundaryChordDistance,
  minimumVCarveBoundaryPointDistance,
  someVCarveBoundarySegmentInBox,
} from '../../core/cnc/vcarve-boundary-segment-index';
import { passesForVCarveMedialRegion } from '../../core/cnc/vcarve-medial-region-passes';
import { planUnrankedVCarveMedialRegion } from '../../core/cnc/vcarve-medial-region-plan';
import { DEFAULT_OUTPUT_SCOPE } from '../../core/scene';
import { computeDesignSceneSourceFromPrepared } from '../../ui/workspace/design-scene-source';
import { emitPreparedGcode } from './index';
import { prepareOutputAsync } from './prepare-output-async';

type AsBoundaryIndex = typeof asVCarveBoundarySegmentIndex;
type BuildBoundaryIndex = typeof buildVCarveBoundarySegmentIndex;
type EveryBoundarySegment = typeof everyVCarveBoundarySegmentInBox;
type MinimumChordDistance = typeof minimumVCarveBoundaryChordDistance;
type MinimumPointDistance = typeof minimumVCarveBoundaryPointDistance;
type SomeBoundarySegment = typeof someVCarveBoundarySegmentInBox;

const boundaryIndexProbe = vi.hoisted(() => ({
  arrayConversions: 0,
  arrayQuerySources: 0,
  explicitBuilds: 0,
}));

vi.mock('../../core/cnc/vcarve-boundary-segment-index', async (importOriginal) => {
  const actual = (await importOriginal()) as Readonly<Record<string, unknown>> & {
    readonly asVCarveBoundarySegmentIndex: AsBoundaryIndex;
    readonly buildVCarveBoundarySegmentIndex: BuildBoundaryIndex;
    readonly everyVCarveBoundarySegmentInBox: EveryBoundarySegment;
    readonly minimumVCarveBoundaryChordDistance: MinimumChordDistance;
    readonly minimumVCarveBoundaryPointDistance: MinimumPointDistance;
    readonly someVCarveBoundarySegmentInBox: SomeBoundarySegment;
  };
  const recordArraySource = (source: Parameters<AsBoundaryIndex>[0]): void => {
    if (Array.isArray(source)) boundaryIndexProbe.arrayQuerySources += 1;
  };
  const asBoundaryIndex: AsBoundaryIndex = (source) => {
    if (Array.isArray(source)) boundaryIndexProbe.arrayConversions += 1;
    return actual.asVCarveBoundarySegmentIndex(source);
  };
  const buildBoundaryIndex: BuildBoundaryIndex = (segments) => {
    boundaryIndexProbe.explicitBuilds += 1;
    return actual.buildVCarveBoundarySegmentIndex(segments);
  };
  const everyBoundarySegment: EveryBoundarySegment = (source, box, predicate) => {
    recordArraySource(source);
    return actual.everyVCarveBoundarySegmentInBox(source, box, predicate);
  };
  const minimumChordDistance: MinimumChordDistance = (source, a, b) => {
    recordArraySource(source);
    return actual.minimumVCarveBoundaryChordDistance(source, a, b);
  };
  const minimumPointDistance: MinimumPointDistance = (source, point) => {
    recordArraySource(source);
    return actual.minimumVCarveBoundaryPointDistance(source, point);
  };
  const someBoundarySegment: SomeBoundarySegment = (source, box, predicate) => {
    recordArraySource(source);
    return actual.someVCarveBoundarySegmentInBox(source, box, predicate);
  };
  return {
    ...actual,
    asVCarveBoundarySegmentIndex: asBoundaryIndex,
    buildVCarveBoundarySegmentIndex: buildBoundaryIndex,
    everyVCarveBoundarySegmentInBox: everyBoundarySegment,
    minimumVCarveBoundaryChordDistance: minimumChordDistance,
    minimumVCarveBoundaryPointDistance: minimumPointDistance,
    someVCarveBoundarySegmentInBox: someBoundarySegment,
  };
});

const EXPECTED_REGION_COUNT = 12;
const EXPECTED_GCODE_BYTES = 1_024_912;
const EXPECTED_GCODE_SHA256 = 'dde64575fd5da13a6a62a3505eaee98e318d7165ffe65decd227a4c4ffe9d53e';
const READY_BOUND_MS = 45_000;
const TEST_TIMEOUT_MS = 180_000;

describe('multi-artwork connected-script compilation', () => {
  it(
    'stays byte-exact, measurable, and ready for the real G-code 3D source',
    async () => {
      boundaryIndexProbe.arrayConversions = 0;
      boundaryIndexProbe.arrayQuerySources = 0;
      boundaryIndexProbe.explicitBuilds = 0;
      const project = await connectedScriptProject();
      const startedAt = performance.now();
      let taskRunnerStartedAt = 0;
      let taskRunnerFinishedAt = 0;
      const regionTimings: Array<{
        readonly taskId: string;
        readonly geometryMs: number;
        readonly passesMs: number;
      }> = [];
      const prepared = await prepareOutputAsync(
        project,
        { outputScope: DEFAULT_OUTPUT_SCOPE },
        {
          jobId: 'connected-script-profile',
          runCncTasks: async ({ jobId, tasks }) => {
            taskRunnerStartedAt = performance.now();
            const results = tasks.map((task) => {
              const geometryStartedAt = performance.now();
              const regionTask = task.payload.regionTask;
              const unranked = planUnrankedVCarveMedialRegion(
                regionTask.region,
                regionTask.normalizedIndex,
                { ...regionTask.planOptions, law: regionTask.law },
              );
              const geometryFinishedAt = performance.now();
              const passes = passesForVCarveMedialRegion(unranked.plan, regionTask.law, {
                depthPerPassMm: regionTask.depthPerPassMm,
              });
              const passesFinishedAt = performance.now();
              regionTimings.push({
                taskId: task.taskId,
                geometryMs: geometryFinishedAt - geometryStartedAt,
                passesMs: passesFinishedAt - geometryFinishedAt,
              });
              const result: CncCompilationRegionResult = {
                binding: task.payload.binding,
                regionResult: {
                  normalizedIndex: unranked.plan.normalizedIndex,
                  witness: unranked.witness,
                  passes: passes.passes,
                  offsetFailed: unranked.plan.offsetFailed,
                  thinResidual: passes.thinResidual,
                  passLimited: unranked.plan.passLimited || !passes.toleranceMet,
                },
              };
              return { jobId, taskId: task.taskId, result };
            });
            taskRunnerFinishedAt = performance.now();
            return results;
          },
        },
      );
      const preparedAt = performance.now();
      expect(prepared.ok).toBe(true);
      if (!prepared.ok) return;
      const gcode = emitPreparedGcode(prepared).gcode;
      const emittedAt = performance.now();
      const gcodeSha256 = createHash('sha256').update(gcode).digest('hex');
      console.log(
        JSON.stringify({
          artworkCount: CONNECTED_SCRIPT_ARTWORK_COUNT,
          regionCount: regionTimings.length,
          stagesMs: {
            preTask: taskRunnerStartedAt - startedAt,
            regionPlanning: taskRunnerFinishedAt - taskRunnerStartedAt,
            finalize: preparedAt - taskRunnerFinishedAt,
            emit: emittedAt - preparedAt,
            total: emittedAt - startedAt,
          },
          regionsMs: regionTimings,
          gcodeBytes: gcode.length,
          gcodeSha256,
        }),
      );
      expect(regionTimings).toHaveLength(EXPECTED_REGION_COUNT);
      // Guard the repaired work shape without relying on a machine-speed-sensitive
      // wall-clock threshold: every region builds once, then every query reuses it.
      expect(boundaryIndexProbe.explicitBuilds).toBe(EXPECTED_REGION_COUNT);
      expect(boundaryIndexProbe.arrayConversions).toBe(0);
      expect(boundaryIndexProbe.arrayQuerySources).toBe(0);
      expect(emittedAt - startedAt).toBeLessThan(READY_BOUND_MS);
      expect(gcode).toHaveLength(EXPECTED_GCODE_BYTES);
      expect(gcodeSha256).toBe(EXPECTED_GCODE_SHA256);

      const source = computeDesignSceneSourceFromPrepared(project, prepared);
      expect(source).not.toBeNull();
      if (source === null) return;
      expect(source.moves.some((move) => move.kind === 'cut')).toBe(true);
      expect(
        source.moves.every((move) =>
          move.points.every(
            (point) =>
              Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z),
          ),
        ),
      ).toBe(true);
      expect(source.grid.depth.some((depth) => depth < 0)).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );
});

async function connectedScriptProject() {
  const bytes = readFileSync(resolve(__dirname, '../../ui/text/fonts/DancingScript-Regular.ttf'));
  const fontBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return connectedScriptCompilationProject(fontBuffer);
}
