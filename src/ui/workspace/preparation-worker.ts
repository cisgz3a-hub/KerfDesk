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
import { largeJobPreparationFromPrepared } from './large-job-preparation';
import { estimateLiveJobFromPrepared } from '../laser/live-job-estimate';
import type {
  PreparationWorkerRequest,
  PreparationWorkerResponse,
} from './preparation-worker-protocol';
import { hydratePagedRasterProject } from '../import/paged-raster-hydration';
import { renderVariableText } from '../text/render-variable-text';
import { PreparationTransferSender } from './preparation-transfer-sender';
import type { PreparationTransferAcknowledgement } from './preparation-transfer-protocol';

const transferSender = new PreparationTransferSender((response) => self.postMessage(response));

self.onmessage = async (
  e: MessageEvent<PreparationWorkerRequest | PreparationTransferAcknowledgement>,
): Promise<void> => {
  if (acceptCanvasCompilationBridgeConnection(e.data)) return;
  if (transferSender.acceptAcknowledgement(e.data)) return;
  if ('kind' in e.data) return;
  const { id, project, jobOrigin, outputScope, snapshot, projection } = e.data;
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
    const prepared =
      snapshot === undefined
        ? await prepare(hydrated, options)
        : await prepareOutputSnapshot(hydrated, {
            ...options,
            ...snapshot,
            clock: () => new Date(),
            renderVariableText,
            prepare,
          });
    // ETA does not consume a route. Building and cloning every raster span
    // here can exhaust structured-clone memory even when its estimate works.
    if (projection === 'estimate') {
      const response: PreparationWorkerResponse = {
        id,
        kind: 'estimate',
        estimate: estimateLiveJobFromPrepared(prepared, jobOrigin, { unbounded: true }),
      };
      self.postMessage(response);
    } else {
      // Both legacy and optional plan arrays are freshly built for this
      // response. No worker cache owns them; transfer may consume ACKed slots.
      await transferSender.sendOwned(
        id,
        largeJobPreparationFromPrepared(hydrated, prepared, options),
      );
    }
  } catch (err) {
    const response: PreparationWorkerResponse = {
      id,
      kind: 'error',
      message: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(response);
  }
};
