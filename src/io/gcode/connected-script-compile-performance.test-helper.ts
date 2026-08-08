import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { CONNECTED_SCRIPT_ARTWORK_COUNT } from '../../__fixtures__/connected-script-compilation-project';
import type {
  CncCompilationRegionResult,
  CncCompilationTask,
  CncCompilationTaskResult,
} from '../../core/cnc/cnc-compilation-artifact';
import { passesForVCarveMedialRegion } from '../../core/cnc/vcarve-medial-region-passes';
import { planUnrankedVCarveMedialRegion } from '../../core/cnc/vcarve-medial-region-plan';
import { DEFAULT_OUTPUT_SCOPE, type Project } from '../../core/scene';
import { emitPreparedGcode } from './index';
import type { PreparedOutput } from './prepare-output';
import { prepareOutputAsync, type CncCompilationTaskRunner } from './prepare-output-async';

type RegionTiming = {
  readonly taskId: string;
  readonly geometryMs: number;
  readonly passesMs: number;
};

/** Stage and per-region timings from one connected-script output preparation. */
export type CompilationProfile = {
  readonly prepared: PreparedOutput;
  readonly startedAt: number;
  readonly taskRunnerStartedAt: number;
  readonly taskRunnerFinishedAt: number;
  readonly preparedAt: number;
  readonly regionTimings: ReadonlyArray<RegionTiming>;
};

type MutableTaskRunnerProfile = {
  taskRunnerStartedAt: number;
  taskRunnerFinishedAt: number;
  regionTimings: RegionTiming[];
};

/** Exact emitted G-code evidence paired with its completion timestamp. */
export type EmissionProfile = {
  readonly gcode: string;
  readonly emittedAt: number;
  readonly gcodeSha256: string;
  readonly gcodeUtf8Bytes: number;
};

/** Prepares the real script fixture while measuring each deterministic stage. */
export async function profileConnectedScriptCompilation(
  project: Project,
): Promise<CompilationProfile> {
  const startedAt = performance.now();
  const taskProfile: MutableTaskRunnerProfile = {
    taskRunnerStartedAt: 0,
    taskRunnerFinishedAt: 0,
    regionTimings: [],
  };
  const prepared = await prepareOutputAsync(
    project,
    { outputScope: DEFAULT_OUTPUT_SCOPE },
    {
      jobId: 'connected-script-profile',
      runCncTasks: profiledTaskRunner(taskProfile),
    },
  );
  const preparedAt = performance.now();
  return {
    prepared,
    startedAt,
    taskRunnerStartedAt: taskProfile.taskRunnerStartedAt,
    taskRunnerFinishedAt: taskProfile.taskRunnerFinishedAt,
    preparedAt,
    regionTimings: taskProfile.regionTimings,
  };
}

function profiledTaskRunner(profile: MutableTaskRunnerProfile): CncCompilationTaskRunner {
  return async ({ jobId, tasks }) => {
    profile.taskRunnerStartedAt = performance.now();
    const results = tasks.map((task) => profileRegionTask(jobId, task, profile.regionTimings));
    profile.taskRunnerFinishedAt = performance.now();
    return results;
  };
}

function profileRegionTask(
  jobId: string,
  task: CncCompilationTask,
  regionTimings: RegionTiming[],
): CncCompilationTaskResult {
  const geometryStartedAt = performance.now();
  const regionTask = task.payload.regionTask;
  const unranked = planUnrankedVCarveMedialRegion(regionTask.region, regionTask.normalizedIndex, {
    ...regionTask.planOptions,
    law: regionTask.law,
  });
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
}

/** Emits one prepared output and records exact code-unit, byte, and hash evidence. */
export function profileGcodeEmission(prepared: PreparedOutput): EmissionProfile {
  const gcode = emitPreparedGcode(prepared).gcode;
  return {
    gcode,
    emittedAt: performance.now(),
    gcodeSha256: createHash('sha256').update(gcode).digest('hex'),
    gcodeUtf8Bytes: Buffer.byteLength(gcode, 'utf8'),
  };
}

/** Writes the benchmark evidence as one machine-readable record. */
export function logCompilationProfile(
  compilation: CompilationProfile,
  emission: EmissionProfile,
): void {
  console.log(
    JSON.stringify({
      artworkCount: CONNECTED_SCRIPT_ARTWORK_COUNT,
      regionCount: compilation.regionTimings.length,
      stagesMs: {
        preTask: compilation.taskRunnerStartedAt - compilation.startedAt,
        regionPlanning: compilation.taskRunnerFinishedAt - compilation.taskRunnerStartedAt,
        finalize: compilation.preparedAt - compilation.taskRunnerFinishedAt,
        emit: emission.emittedAt - compilation.preparedAt,
        total: emission.emittedAt - compilation.startedAt,
      },
      regionsMs: compilation.regionTimings,
      gcodeCodeUnits: emission.gcode.length,
      gcodeSha256: emission.gcodeSha256,
      gcodeUtf8Bytes: emission.gcodeUtf8Bytes,
    }),
  );
}
