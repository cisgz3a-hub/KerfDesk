/// <reference lib="webworker" />

import { prepareTracePartBounds } from '../../core/trace/trace-part-bounds';
import { computeTracePartGroups } from '../../core/trace/trace-part-groups';
import { unpackColoredPath } from '../packed-project-transfer';
import type { TracePartWorkerRequest, TracePartWorkerResponse } from './trace-part-worker-protocol';

self.onmessage = (event: MessageEvent<TracePartWorkerRequest>): void => {
  const { id, mode } = event.data;
  try {
    const path = unpackColoredPath(event.data.path);
    const bounds = prepareTracePartBounds(path);
    const groups = mode === null ? null : computeTracePartGroups(path, mode);
    const response: TracePartWorkerResponse = { id, kind: 'ok', bounds, groups };
    self.postMessage(response, [bounds.buffer]);
  } catch (error) {
    const response: TracePartWorkerResponse = {
      id,
      kind: 'error',
      message: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(response);
  }
};
