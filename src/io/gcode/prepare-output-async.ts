import {
  finalizeCncCompilationArtifact,
  prepareBoundCncCompilation,
} from '../../core/cnc/compile-cnc-job';
import {
  runCncCompilationTask,
  type CncCompilationTask,
  type CncCompilationTaskResult,
  type PreparedCncCompilationArtifact,
} from '../../core/cnc/cnc-compilation-artifact';
import { compileJob, type Job } from '../../core/job';
import type { Project } from '../../core/scene';
import {
  isProgramMaterializationRangeError,
  programMaterializationFailure,
} from './program-materialization';
import {
  completePreparedOutput,
  prepareOutputInput,
  type PreparedOutput,
  type PrepareOutputOptions,
} from './prepare-output';

export type OutputCompilationProgress = {
  readonly phase: 'normalizing' | 'planning' | 'merging' | 'finalizing';
  readonly mode: 'direct' | 'parallel' | 'sequential-fallback';
  readonly completed: number;
  readonly active: number;
  readonly queued: number;
  readonly total: number;
};

export type CncCompilationTaskRunner = (request: {
  readonly jobId: string;
  readonly tasks: ReadonlyArray<CncCompilationTask>;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: Omit<OutputCompilationProgress, 'phase'>) => void;
}) => Promise<ReadonlyArray<CncCompilationTaskResult>>;

export type PrepareOutputAsyncContext = {
  readonly jobId: string;
  readonly runCncTasks: CncCompilationTaskRunner;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: OutputCompilationProgress) => void;
};

/** Async sibling of prepareOutput; only independently normalized CNC regions fan out. */
export async function prepareOutputAsync(
  project: Project,
  options: PrepareOutputOptions,
  context: PrepareOutputAsyncContext,
): Promise<PreparedOutput> {
  const input = prepareOutputInput(project, options);
  if (!input.ok) return input.prepared;
  try {
    const compiled = await compileOutputProject(input.project, context);
    emitProgress(context, 'finalizing', 'direct', 0, 0, 0, 0);
    return completePreparedOutput(input, compiled);
  } catch (error) {
    if (isProgramMaterializationRangeError(error)) {
      return { ok: false, preflight: programMaterializationFailure() };
    }
    throw error;
  }
}

async function compileOutputProject(
  project: Project,
  context: PrepareOutputAsyncContext,
): Promise<Job> {
  const machine = project.machine;
  if (machine === undefined || machine.kind !== 'cnc')
    return compileJob(project.scene, project.device);
  throwIfAborted(context.signal);
  emitProgress(context, 'normalizing', 'direct', 0, 0, 0, 0);
  const compilationId = `${context.jobId}:cnc`;
  const artifact = prepareBoundCncCompilation(
    { jobId: context.jobId, compilationId },
    project.scene,
    project.device,
    machine,
  );
  const results = await runArtifactTasks(artifact, context);
  throwIfAborted(context.signal);
  emitProgress(context, 'merging', 'direct', results.length, 0, 0, artifact.tasks.length);
  const finalized = finalizeCncCompilationArtifact(artifact, results);
  if (finalized.kind === 'compiled') return finalized.job;
  // A malformed/stale generation is never merged and never recomputed outside
  // the globally bounded broker. The outer Worker surfaces unavailable instead
  // of becoming an unaccounted extra planner lane.
  throw new Error(`Bound CNC compilation rejected: ${finalized.reason}`);
}

async function runArtifactTasks(
  artifact: PreparedCncCompilationArtifact,
  context: PrepareOutputAsyncContext,
): Promise<ReadonlyArray<CncCompilationTaskResult>> {
  if (artifact.tasks.length === 0) return runArtifactTasksDirectly(artifact, context);
  emitProgress(context, 'planning', 'parallel', 0, 0, artifact.tasks.length, artifact.tasks.length);
  return context.runCncTasks({
    jobId: artifact.identity.compilationId,
    tasks: artifact.tasks,
    ...(context.signal === undefined ? {} : { signal: context.signal }),
    onProgress: (progress) => context.onProgress?.({ phase: 'planning', ...progress }),
  });
}

function runArtifactTasksDirectly(
  artifact: PreparedCncCompilationArtifact,
  context: PrepareOutputAsyncContext,
): ReadonlyArray<CncCompilationTaskResult> {
  const total = artifact.tasks.length;
  const results: CncCompilationTaskResult[] = [];
  for (const task of artifact.tasks) {
    throwIfAborted(context.signal);
    emitProgress(
      context,
      'planning',
      'direct',
      results.length,
      1,
      total - results.length - 1,
      total,
    );
    results.push({
      jobId: artifact.identity.compilationId,
      taskId: task.taskId,
      result: runCncCompilationTask(task.payload),
    });
  }
  emitProgress(context, 'planning', 'direct', total, 0, 0, total);
  return results;
}

function emitProgress(
  context: PrepareOutputAsyncContext,
  phase: OutputCompilationProgress['phase'],
  mode: OutputCompilationProgress['mode'],
  completed: number,
  active: number,
  queued: number,
  total: number,
): void {
  try {
    context.onProgress?.({ phase, mode, completed, active, queued, total });
  } catch {
    // Progress is observational and cannot change compilation or output.
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted !== true) return;
  const error = new Error('output compilation aborted');
  error.name = 'AbortError';
  throw error;
}
