/// <reference lib="webworker" />

import { inspectGcodeSource } from './gcode-inspector-parse';
import { gcodeInspectorTransferables } from './gcode-inspector-transferables';
import {
  type GcodeInspectorWorkerRequest,
  type GcodeInspectorWorkerResponse,
} from './gcode-inspector-worker-protocol';

self.onmessage = (event: MessageEvent<GcodeInspectorWorkerRequest>): void => {
  void inspect(event.data);
};

async function inspect(request: GcodeInspectorWorkerRequest): Promise<void> {
  try {
    postProgress(request.id, 'reading');
    postProgress(request.id, 'parsing');
    const result = await inspectGcodeSource(request.source, ({ bytesRead, totalBytes }) => {
      postProgress(request.id, 'parsing', bytesRead, totalBytes);
    });
    const response: GcodeInspectorWorkerResponse = {
      id: request.id,
      kind: 'complete',
      result,
    };
    self.postMessage(response, { transfer: [...gcodeInspectorTransferables(result)] });
  } catch (error) {
    const response: GcodeInspectorWorkerResponse = {
      id: request.id,
      kind: 'error',
      message: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(response);
  }
}

function postProgress(
  id: number,
  phase: Extract<GcodeInspectorWorkerResponse, { kind: 'progress' }>['phase'],
  bytesRead?: number,
  totalBytes?: number,
): void {
  const response: GcodeInspectorWorkerResponse = {
    id,
    kind: 'progress',
    phase,
    ...(bytesRead === undefined ? {} : { bytesRead }),
    ...(totalBytes === undefined ? {} : { totalBytes }),
  };
  self.postMessage(response);
}
