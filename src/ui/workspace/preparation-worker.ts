// Large-job preparation worker (ADR-244). Runs the unbounded prepare
// (compile + optimize + toolpath + estimate) away from the React/UI thread
// so scenes over the ADR-241/ADR-243 responsiveness budgets still get a
// preview and an ETA instead of a permanent pause.
//
// Vite bundles this via the direct
// `new Worker(new URL('./preparation-worker.ts', import.meta.url), { type: 'module' })`
// call in preparation-worker-client.ts.

/// <reference lib="webworker" />

import { prepareOutputAsync } from '../../io/gcode/prepare-output-async';
import { prepareOutputSnapshot } from '../../io/gcode';
import {
  acceptCanvasCompilationBridgeConnection,
  runCanvasCompilationTasks,
} from './canvas-compilation-worker-pool';
import { largeJobPreparationFromPrepared, prepareLargeJobAsync } from './large-job-preparation';
import type {
  PreparationWorkerRequest,
  PreparationWorkerResponse,
} from './preparation-worker-protocol';
import { hydratePagedRasterProject } from '../import/paged-raster-hydration';
import { renderVariableText } from '../text/render-variable-text';

self.onmessage = async (e: MessageEvent<PreparationWorkerRequest>): Promise<void> => {
  if (acceptCanvasCompilationBridgeConnection(e.data)) return;
  const { id, project, jobOrigin, outputScope, snapshot } = e.data;
  try {
    const options = {
      ...(jobOrigin === undefined ? {} : { jobOrigin }),
      ...(outputScope === undefined ? {} : { outputScope }),
    };
    const hydrated = await hydratePagedRasterProject(project);
    const prepare = (nextProject: typeof hydrated, nextOptions: typeof options) =>
      prepareOutputAsync(nextProject, nextOptions, {
        jobId: `preview:${id}`,
        runCncTasks: runCanvasCompilationTasks,
        onProgress: (progress) => {
          const update: PreparationWorkerResponse = { id, kind: 'progress', progress };
          self.postMessage(update);
        },
      });
    const preparation =
      snapshot === undefined
        ? await prepareLargeJobAsync(hydrated, options, prepare)
        : largeJobPreparationFromPrepared(
            hydrated,
            await prepareOutputSnapshot(hydrated, {
              ...options,
              ...snapshot,
              clock: () => new Date(),
              renderVariableText,
              prepare,
            }),
            options,
          );
    const response: PreparationWorkerResponse = {
      id,
      kind: 'ok',
      ...preparation,
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
