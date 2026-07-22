// Large-job preparation worker (ADR-244). Runs the unbounded prepare
// (compile + optimize + toolpath + estimate) away from the React/UI thread
// so scenes over the ADR-241/ADR-243 responsiveness budgets still get a
// preview and an ETA instead of a permanent pause.
//
// Vite bundles this via the direct
// `new Worker(new URL('./preparation-worker.ts', import.meta.url), { type: 'module' })`
// call in preparation-worker-client.ts.

/// <reference lib="webworker" />

import { prepareLargeJob } from './large-job-preparation';
import type {
  PreparationWorkerRequest,
  PreparationWorkerResponse,
} from './preparation-worker-protocol';

self.onmessage = (e: MessageEvent<PreparationWorkerRequest>): void => {
  const { id, project, jobOrigin, outputScope } = e.data;
  try {
    const options = {
      ...(jobOrigin === undefined ? {} : { jobOrigin }),
      ...(outputScope === undefined ? {} : { outputScope }),
    };
    const response: PreparationWorkerResponse = {
      id,
      kind: 'ok',
      ...prepareLargeJob(project, options),
    };
    self.postMessage(response);
  } catch (err) {
    const response: PreparationWorkerResponse = {
      id,
      kind: 'error',
      message: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(response);
  }
};
