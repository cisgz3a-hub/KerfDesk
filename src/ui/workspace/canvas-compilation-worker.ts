/// <reference lib="webworker" />

import {
  canvasCompilationResultTransferables,
  executeCanvasCompilationTask,
  type CanvasCompilationWorkerRequest,
  type CanvasCompilationWorkerResponse,
} from './canvas-compilation-worker-protocol';

self.onmessage = (event: MessageEvent<CanvasCompilationWorkerRequest>): void => {
  const request = event.data;
  let response: CanvasCompilationWorkerResponse;
  try {
    response = {
      kind: 'ok',
      submissionId: request.submissionId,
      jobId: request.jobId,
      taskId: request.taskId,
      result: executeCanvasCompilationTask(request.payload),
    };
  } catch (error) {
    response = {
      kind: 'error',
      submissionId: request.submissionId,
      jobId: request.jobId,
      taskId: request.taskId,
      message: error instanceof Error ? error.message : String(error),
    };
  }
  self.postMessage(
    response,
    response.kind === 'ok' ? canvasCompilationResultTransferables(response.result) : [],
  );
};
