// Latest-project idle marker worker. V-carve planning belongs here rather than
// in the browser event loop: the marker overlay is informational and must not
// make routine artwork or settings edits wait for a full CAM compile.

/// <reference lib="webworker" />

import { buildIdleCanvasMotionPlanFromRequest } from './idle-canvas-motion-plan';
import type {
  IdleCanvasMotionWorkerRequest,
  IdleCanvasMotionWorkerResponse,
} from './idle-canvas-motion-worker-protocol';

self.onmessage = async (event: MessageEvent<IdleCanvasMotionWorkerRequest>): Promise<void> => {
  const { id, request } = event.data;
  let response: IdleCanvasMotionWorkerResponse;
  try {
    response = {
      id,
      kind: 'ok',
      plan: await buildIdleCanvasMotionPlanFromRequest(request),
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
