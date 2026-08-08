/// <reference lib="webworker" />

import {
  acceptCanvasCompilationBridgeConnection,
  runCanvasCompilationWork,
} from './canvas-compilation-worker-pool';
import type {
  CanvasCompilationTaskPayload,
  CanvasCompilationTaskResult,
} from './canvas-compilation-worker-protocol';
import type {
  CncRemovalGridWorkerRequest,
  CncRemovalGridWorkerResponse,
} from './cnc-removal-grid-worker-protocol';

type WorkRequest = Exclude<CncRemovalGridWorkerRequest, { readonly kind: 'cancel-relief' }>;
const reliefControllers = new Map<number, AbortController>();

self.onmessage = (event: MessageEvent<CncRemovalGridWorkerRequest>): void => {
  if (acceptCanvasCompilationBridgeConnection(event.data)) return;
  if (event.data.kind === 'cancel-relief') {
    reliefControllers.get(event.data.id)?.abort();
    return;
  }
  void prepare(event.data);
};

async function prepare(request: WorkRequest): Promise<void> {
  let response: CncRemovalGridWorkerResponse;
  const controller = request.kind === 'relief-heightmaps' ? new AbortController() : null;
  if (controller !== null) reliefControllers.set(request.id, controller);
  try {
    const results = await runCanvasCompilationWork({
      jobId: `cnc-${request.kind}:${request.id}`,
      tasks: tasksFor(request),
      ...(controller === null ? {} : { signal: controller.signal }),
    });
    response = bindResponse(request, results);
  } catch (error) {
    response = {
      id: request.id,
      kind: 'error',
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (controller !== null && reliefControllers.get(request.id) === controller) {
      reliefControllers.delete(request.id);
    }
  }
  self.postMessage(response, responseTransfers(response));
}

type WorkerTask = {
  readonly taskId: string;
  readonly payload: CanvasCompilationTaskPayload;
};

function tasksFor(request: WorkRequest): ReadonlyArray<WorkerTask> {
  if (request.kind === 'relief-heightmaps') {
    return request.items.map((item) => ({
      taskId: item.taskId,
      payload: { kind: 'relief-heightmap', source: item.source, options: item.options },
    }));
  }
  if (request.kind === 'grid') {
    return [
      {
        taskId: request.kind,
        payload: {
          kind: 'cnc-removal-grid',
          device: request.device,
          machine: request.machine,
          toolpath: request.toolpath,
          scrubFraction: request.scrubFraction,
        },
      },
    ];
  }
  return [{ taskId: request.kind, payload: { kind: 'cnc-cut3d-surface', grid: request.grid } }];
}

function bindResponse(
  request: WorkRequest,
  results: ReadonlyArray<CanvasCompilationTaskResult>,
): CncRemovalGridWorkerResponse {
  return request.kind === 'relief-heightmaps'
    ? bindReliefResponse(request, results)
    : bindSingleResponse(request, results);
}

function bindReliefResponse(
  request: Extract<WorkRequest, { readonly kind: 'relief-heightmaps' }>,
  results: ReadonlyArray<CanvasCompilationTaskResult>,
): CncRemovalGridWorkerResponse {
  if (results.length !== request.items.length) {
    throw new Error('Relief preview worker returned an unbound result.');
  }
  return {
    id: request.id,
    kind: request.kind,
    items: results.map((result, index) => {
      const item = request.items[index];
      if (item === undefined || result.kind !== 'relief-heightmap') {
        throw new Error('Relief preview worker returned a mismatched result.');
      }
      return { taskId: item.taskId, result: result.output };
    }),
  };
}

function bindSingleResponse(
  request: Exclude<WorkRequest, { readonly kind: 'relief-heightmaps' }>,
  results: ReadonlyArray<CanvasCompilationTaskResult>,
): CncRemovalGridWorkerResponse {
  const result = results[0];
  if (results.length !== 1) throw new Error('CNC preview worker returned an unbound result.');
  if (request.kind === 'grid' && result?.kind === 'cnc-removal-grid') {
    return { id: request.id, kind: request.kind, grid: result.output };
  }
  if (request.kind === 'surface' && result?.kind === 'cnc-cut3d-surface') {
    return { id: request.id, kind: request.kind, surface: result.output };
  }
  throw new Error('CNC preview worker returned a mismatched result.');
}

function responseTransfers(response: CncRemovalGridWorkerResponse): Transferable[] {
  if (response.kind === 'grid') return response.grid === null ? [] : [response.grid.depth.buffer];
  if (response.kind === 'surface') {
    return [
      response.surface.positions.buffer,
      response.surface.indices.buffer,
      response.surface.normals.buffer,
    ];
  }
  if (response.kind === 'relief-heightmaps') {
    return response.items.flatMap((item) =>
      item.result.kind === 'ok' ? [item.result.heightmap.depth.buffer] : [],
    );
  }
  return [];
}
