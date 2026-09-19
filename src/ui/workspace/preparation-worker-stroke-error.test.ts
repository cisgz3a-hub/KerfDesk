import { afterEach, describe, expect, it, vi } from 'vitest';
import { unrepresentableStrokeProject } from '../../__fixtures__/vcarve-stroke-geometry';
import type { PreparationWorkerRequest } from './preparation-worker-protocol';

const runTasks = vi.hoisted(() => vi.fn());
vi.mock('./canvas-compilation-worker-pool', () => ({
  acceptCanvasCompilationBridgeConnection: () => false,
  runCanvasCompilationTasks: runTasks,
}));
vi.mock('../import/paged-raster-hydration', () => ({
  hydratePagedRasterProject: async (project: unknown) => project,
}));

afterEach(() => vi.unstubAllGlobals());

describe('stroke geometry failure through the preparation worker', () => {
  it('posts the real descriptive compiler error without partial preview output', async () => {
    const workerScope: {
      onmessage: ((event: MessageEvent<PreparationWorkerRequest>) => Promise<void>) | null;
      postMessage: ReturnType<typeof vi.fn>;
    } = { onmessage: null, postMessage: vi.fn() };
    vi.stubGlobal('self', workerScope);
    await import('./preparation-worker');
    const request: PreparationWorkerRequest = { id: 41, project: unrepresentableStrokeProject() };
    await workerScope.onmessage?.(new MessageEvent('message', { data: request }));
    expect(workerScope.postMessage).toHaveBeenCalledExactlyOnceWith({
      id: 41,
      kind: 'error',
      message: expect.stringContaining('could not represent the stroke geometry'),
    });
    expect(runTasks).not.toHaveBeenCalled();
  });
});
