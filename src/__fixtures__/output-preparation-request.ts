import { runCncCompilationTask } from '../core/cnc/cnc-compilation-artifact';
import type {
  CncCompilationTaskRunner,
  OutputCompilationProgress,
} from '../io/gcode/prepare-output-async';
import type {
  OutputPreparationRequest,
  OutputPreparationResponse,
} from '../ui/laser/output-preparation-protocol';
import { prepareOutputRequest } from '../ui/laser/output-preparation';

export function prepareOutputRequestForTest(
  request: OutputPreparationRequest,
  execution: {
    readonly signal?: AbortSignal;
    readonly onProgress?: (progress: OutputCompilationProgress) => void;
  } = {},
): Promise<OutputPreparationResponse> {
  return prepareOutputRequest(request, {
    jobId: `test-output:${request.kind}`,
    runCncTasks: runTasksSerially,
    ...execution,
  });
}

const runTasksSerially: CncCompilationTaskRunner = async (request) => {
  const results = [];
  for (const [index, task] of request.tasks.entries()) {
    throwIfAborted(request.signal);
    request.onProgress?.({
      mode: 'sequential-fallback',
      completed: index,
      active: 1,
      queued: request.tasks.length - index - 1,
      total: request.tasks.length,
    });
    results.push({
      jobId: request.jobId,
      taskId: task.taskId,
      result: runCncCompilationTask(task.payload),
    });
  }
  return results;
};

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted !== true) return;
  const error = new Error('test output preparation aborted');
  error.name = 'AbortError';
  throw error;
}
