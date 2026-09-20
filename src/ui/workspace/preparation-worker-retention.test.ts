// The ADR-244 worker hands a route over in ACK-paced chunks, so it owns the
// worker for as long as the UI takes to accept every one of them. Anything the
// message handler still has in scope lives through that whole handover. An
// async handler kept both the cloned Project and the compiled Job — each the
// same order of size as the route being sent — alive for it, with no consumer
// left for either. A probe driving this worker over a 1.6M-step fill measured
// 701 MB at the first chunk and 379 MB at transfer-complete before the split
// below, and 434 MB / 112 MB after it.
//
// The retention assertion needs a real collection, so it runs only where the
// hook exists: NODE_OPTIONS=--expose-gc. The dispatcher-shape assertion is the
// deterministic guard, and it is the exact regression — making the handler
// `async` again puts the request back in scope for the transfer.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLayer, createProject, IDENTITY_TRANSFORM } from '../../core/scene';
import type { Project } from '../../core/scene';
import type {
  PreparationWorkerRequest,
  PreparationWorkerResponse,
} from './preparation-worker-protocol';

vi.mock('./canvas-compilation-worker-pool', () => ({
  acceptCanvasCompilationBridgeConnection: () => false,
  runCanvasCompilationTasks: vi.fn(),
}));
vi.mock('../import/paged-raster-hydration', () => ({
  hydratePagedRasterProject: async (project: unknown) => project,
}));

type WorkerScope = {
  onmessage: ((event: MessageEvent<unknown>) => Promise<void> | undefined) | null;
  postMessage: (response: PreparationWorkerResponse) => void;
};

const collector = (globalThis as { gc?: () => void }).gc;

function hatchedProject(): Project {
  const base = createProject();
  const polylines = [];
  for (let index = 0; index < 20; index += 1) {
    const x = index * 3;
    polylines.push({
      points: [
        { x, y: 0 },
        { x: x + 1, y: 0 },
        { x: x + 1, y: 40 },
        { x, y: 40 },
      ],
      closed: true,
    });
  }
  return {
    ...base,
    scene: {
      ...base.scene,
      objects: [
        {
          kind: 'imported-svg',
          id: 'traced',
          source: 'traced.svg',
          bounds: { minX: 0, minY: 0, maxX: 60, maxY: 40 },
          transform: IDENTITY_TRANSFORM,
          paths: [{ color: '#000000', polylines }],
          operationIds: ['fill'],
        },
      ],
      layers: [
        { ...createLayer({ id: 'fill', color: '#000000', mode: 'fill' }), hatchSpacingMm: 0.25 },
      ],
    },
  } as unknown as Project;
}

afterEach(() => vi.unstubAllGlobals());

describe('preparation worker request retention', () => {
  it('drops the request before the acknowledged transfer finishes', async () => {
    const chunks: number[] = [];
    let collected = false;
    let collectedByLastChunk: boolean | null = null;
    const registry = new FinalizationRegistry(() => {
      collected = true;
    });
    const scope: WorkerScope = {
      onmessage: null,
      postMessage: (response) => {
        if (response.kind === 'transfer-chunk') chunks.push(response.sequence);
        if (response.kind === 'transfer-complete') collectedByLastChunk = collected;
        if (
          response.kind === 'transfer-start' ||
          response.kind === 'transfer-chunk' ||
          response.kind === 'transfer-complete'
        ) {
          const ack = { id: response.id, sequence: response.sequence, kind: 'transfer-ack' };
          // A macrotask per acknowledgement, as a real port delivery is: the
          // collector cannot run, and finalizers cannot fire, on microtasks.
          setTimeout(() => {
            collector?.();
            void scope.onmessage?.(new MessageEvent('message', { data: ack }));
          }, 0);
        }
      },
    };
    vi.stubGlobal('self', scope);
    vi.resetModules();
    await import('./preparation-worker');

    // Built and registered inside this frame so the test itself never holds
    // the request that the handler is being asked to let go of.
    const started = ((): Promise<void> | undefined => {
      const request: PreparationWorkerRequest = { id: 3, project: hatchedProject() };
      registry.register(request, 'request');
      return scope.onmessage?.(new MessageEvent('message', { data: request }));
    })();
    await started;

    expect(chunks.length).toBeGreaterThan(1);
    // The handler must not be an async frame: it returns as soon as the chain
    // is built, which is what lets the request go before the transfer runs.
    expect(scope.onmessage?.constructor.name).toBe('Function');
    if (collector !== undefined) expect(collectedByLastChunk).toBe(true);
  }, 60000);
});
