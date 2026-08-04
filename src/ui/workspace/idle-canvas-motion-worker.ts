// Latest-project idle marker worker. V-carve planning belongs here rather than
// in the browser event loop: the marker overlay is informational and must not
// make routine artwork or settings edits wait for a full CAM compile.

/// <reference lib="webworker" />

import { buildIdleCanvasMotionPlanFromRequest } from './idle-canvas-motion-plan';
import { prepareOutputAsync } from '../../io/gcode/prepare-output-async';
import {
  acceptCanvasCompilationBridgeConnection,
  runCanvasCompilationTasks,
} from './canvas-compilation-worker-pool';
import type {
  IdleCanvasMotionWorkerRequest,
  IdleCanvasMotionWorkerResponse,
} from './idle-canvas-motion-worker-protocol';

self.onmessage = async (event: MessageEvent<IdleCanvasMotionWorkerRequest>): Promise<void> => {
  if (acceptCanvasCompilationBridgeConnection(event.data)) return;
  const { id, request } = event.data;
  let response: IdleCanvasMotionWorkerResponse;
  try {
    response = {
      id,
      kind: 'ok',
      plan: await buildIdleCanvasMotionPlanFromRequest(request, (project, options) =>
        prepareOutputAsync(project, options, {
          jobId: `idle-canvas:${id}`,
          runCncTasks: runCanvasCompilationTasks,
        }),
      ),
    };
  } catch (error) {
    response = {
      id,
      kind: 'error',
      message: error instanceof Error ? error.message : String(error),
    };
  }
  self.postMessage(response);
};
