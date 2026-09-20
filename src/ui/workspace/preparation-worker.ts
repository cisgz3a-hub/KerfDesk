// Large-job preparation worker (ADR-244). Runs the unbounded prepare
// (compile + optimize + toolpath + estimate) away from the React/UI thread
// so scenes over the ADR-241/ADR-243 responsiveness budgets still get a
// preview and an ETA instead of a permanent pause.
//
// Vite bundles this via the direct
// `new Worker(new URL('./preparation-worker.ts', import.meta.url), { type: 'module' })`
// call in preparation-worker-client.ts.

/// <reference lib="webworker" />

import type { Project } from '../../core/scene';
import { prepareOutputAsync } from '../../io/gcode/prepare-output-async';
import { prepareOutputSnapshot, type PreparedOutput } from '../../io/gcode';
import {
  acceptCanvasCompilationBridgeConnection,
  runCanvasCompilationTasks,
} from './canvas-compilation-worker-pool';
import {
  largeJobPreparationFromPrepared,
  type LargeJobPreparation,
  type LargeJobPreparationOptions,
} from './large-job-preparation';
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

type PreparationOptions = Pick<
  LargeJobPreparationOptions,
  'jobOrigin' | 'outputScope' | 'initialPosition'
>;

self.onmessage = (
  e: MessageEvent<PreparationWorkerRequest | PreparationTransferAcknowledgement>,
): Promise<void> | undefined => {
  if (acceptCanvasCompilationBridgeConnection(e.data)) return undefined;
  if (transferSender.acceptAcknowledgement(e.data)) return undefined;
  if ('kind' in e.data) return undefined;
  const request = e.data;
  const id = request.id;
  // Deliberately not an async handler, and the payload is deliberately built
  // in its own frame. Each stage owns the request only while it needs it: this
  // frame returns as soon as the chain is built, and previewPayload's frame
  // ends when it hands the route back. The acknowledged chunk transfer that
  // follows owns this worker for as long as the UI takes to accept every
  // chunk, and it now holds nothing but the id and the route it is sending —
  // where an async handler kept the cloned Project and the compiled Job, both
  // the same order of size as the route, alive for that whole handover with no
  // consumer left for either.
  const started =
    request.projection === 'estimate'
      ? estimateResponse(request).then((response) => {
          self.postMessage(response);
        })
      : previewPayload(request).then((payload) => transferSender.sendOwned(id, payload));
  return started.catch((err: unknown) => {
    const response: PreparationWorkerResponse = {
      id,
      kind: 'error',
      message: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(response);
  });
};

function preparationOptions(request: PreparationWorkerRequest): PreparationOptions {
  return {
    ...(request.jobOrigin === undefined ? {} : { jobOrigin: request.jobOrigin }),
    ...(request.outputScope === undefined ? {} : { outputScope: request.outputScope }),
    ...(request.initialPosition === undefined ? {} : { initialPosition: request.initialPosition }),
  };
}

function compile(
  request: PreparationWorkerRequest,
  project: Project,
): PreparedOutput | Promise<PreparedOutput> {
  const id = request.id;
  const options = preparationOptions(request);
  const prepare = (nextProject: Project, nextOptions: PreparationOptions) =>
    prepareOutputAsync(nextProject, nextOptions, {
      jobId: `preview:${id}`,
      runCncTasks: runCanvasCompilationTasks,
      onProgress: (progress) => {
        const update: PreparationWorkerResponse = { id, kind: 'progress', progress };
        self.postMessage(update);
      },
    });
  return request.snapshot === undefined
    ? prepare(project, options)
    : prepareOutputSnapshot(project, {
        ...options,
        ...request.snapshot,
        clock: () => new Date(),
        renderVariableText,
        prepare,
      });
}

// ETA does not consume a route. Building and cloning every raster span
// here can exhaust structured-clone memory even when its estimate works.
async function estimateResponse(
  request: PreparationWorkerRequest,
): Promise<PreparationWorkerResponse> {
  const hydrated = await hydratePagedRasterProject(request.project);
  const prepared = await compile(request, hydrated);
  return {
    id: request.id,
    kind: 'estimate',
    estimate: estimateLiveJobFromPrepared(prepared, request.jobOrigin, {
      ...(request.initialPosition === undefined
        ? {}
        : { initialPosition: request.initialPosition }),
      unbounded: true,
    }),
  };
}

// Both legacy and optional plan arrays are freshly built for this response.
// No worker cache owns them; transfer may consume ACKed slots. Returning the
// payload ends this frame, so the hydrated project and the compiled Job it was
// derived from are unreachable before the first chunk is posted.
async function previewPayload(request: PreparationWorkerRequest): Promise<LargeJobPreparation> {
  const hydrated = await hydratePagedRasterProject(request.project);
  const prepared = await compile(request, hydrated);
  return largeJobPreparationFromPrepared(hydrated, prepared, preparationOptions(request));
}
