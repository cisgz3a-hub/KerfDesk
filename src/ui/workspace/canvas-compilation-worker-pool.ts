import type {
  CncCompilationTask,
  CncCompilationTaskResult,
} from '../../core/cnc/cnc-compilation-artifact';
import type { CncCompilationTaskRunner } from '../../io/gcode/prepare-output-async';
import type {
  BoundedCompilationId,
  BoundedCompilationProgress,
  BoundedCompilationTask,
} from './bounded-compilation-worker-pool-protocol';
import { BoundedCompilationBridgeClient } from './bounded-compilation-bridge-client';
import {
  isCanvasCompilationBridgeConnection,
  type CanvasCompilationTaskPayload,
  type CanvasCompilationTaskResult,
} from './canvas-compilation-worker-protocol';

let bridgeClient: BoundedCompilationBridgeClient<
  CanvasCompilationTaskPayload,
  CanvasCompilationTaskResult
> | null = null;

/** First-line outer-Worker hook for the main realm's transferred bridge port. */
export function acceptCanvasCompilationBridgeConnection(value: unknown): boolean {
  if (!isCanvasCompilationBridgeConnection(value)) return false;
  bridgeClient?.dispose(new Error('canvas compilation bridge replaced'));
  bridgeClient = new BoundedCompilationBridgeClient(value.port);
  return true;
}

export const runCanvasCompilationTasks: CncCompilationTaskRunner = async (request) => {
  const tasks = request.tasks.map((task) => ({
    taskId: task.taskId,
    payload: canvasTask(task),
  }));
  const results = await runCanvasCompilationWork({
    jobId: request.jobId,
    tasks,
    ...(request.signal === undefined ? {} : { signal: request.signal }),
    ...(request.onProgress === undefined
      ? {}
      : {
          onProgress: (progress) =>
            request.onProgress?.({
              mode: progress.phase,
              completed: progress.completed,
              active: progress.active,
              queued: progress.queued,
              total: progress.total,
            }),
        }),
  });
  return results.map((result, index): CncCompilationTaskResult => {
    const task = request.tasks[index];
    if (task === undefined || result.kind !== 'cnc-vcarve-region') {
      throw new Error('Canvas compilation bridge returned an unbound task result.');
    }
    return {
      jobId: request.jobId,
      taskId: task.taskId,
      result: result.output,
    };
  });
};

export async function runCanvasCompilationWork(request: {
  readonly jobId: BoundedCompilationId;
  readonly tasks: ReadonlyArray<BoundedCompilationTask<CanvasCompilationTaskPayload>>;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: BoundedCompilationProgress) => void;
}): Promise<ReadonlyArray<CanvasCompilationTaskResult>> {
  if (bridgeClient === null) throw new Error('canvas compilation main bridge unavailable');
  return bridgeClient.submit(request);
}

export function resetCanvasCompilationWorkerPoolForTests(): void {
  bridgeClient?.dispose();
  bridgeClient = null;
}

function canvasTask(task: CncCompilationTask): CanvasCompilationTaskPayload {
  return { kind: 'cnc-vcarve-region', input: task.payload };
}
