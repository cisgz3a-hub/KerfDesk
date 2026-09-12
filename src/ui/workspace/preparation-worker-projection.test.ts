import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLayer, createProject, IDENTITY_TRANSFORM } from '../../core/scene';
import { prepareOutput } from '../../io/gcode';
import type * as Gcode from '../../io/gcode';
import { estimateLiveJobFromPrepared } from '../laser/live-job-estimate';
import type {
  PreparationWorkerRequest,
  PreparationWorkerResponse,
} from './preparation-worker-protocol';

const mocks = vi.hoisted(() => ({ preview: vi.fn(), prepare: vi.fn(), snapshot: vi.fn() }));
vi.mock('./draw-preview', () => ({ buildPreviewToolpathFromPrepared: mocks.preview }));
vi.mock('../../io/gcode/prepare-output-async', () => ({ prepareOutputAsync: mocks.prepare }));
vi.mock('./canvas-compilation-worker-pool', () => ({
  acceptCanvasCompilationBridgeConnection: () => false,
  runCanvasCompilationTasks: vi.fn(),
}));
vi.mock('../import/paged-raster-hydration', () => ({
  hydratePagedRasterProject: async (project: unknown) => project,
}));
vi.mock('../../io/gcode', async (original) => ({
  ...(await original<typeof Gcode>()),
  prepareOutputSnapshot: mocks.snapshot,
}));

const project = {
  ...createProject(),
  scene: {
    objects: [
      {
        kind: 'raster-image' as const,
        id: 'raster',
        source: 'projection.png',
        dataUrl: 'data:image/png;base64,unused',
        color: '#808080',
        pixelWidth: 4,
        pixelHeight: 3,
        lumaBase64: btoa(String.fromCharCode(0, 80, 160, 255, 200, 0, 120, 40, 255, 70, 220, 0)),
        linesPerMm: 2,
        dither: 'floyd-steinberg' as const,
        bounds: { minX: 0, minY: 0, maxX: 2, maxY: 1.5 },
        transform: { ...IDENTITY_TRANSFORM, scaleX: 1.3, scaleY: 0.8, rotationDeg: 17 },
        operationIds: ['image'],
      },
    ],
    layers: [
      {
        ...createLayer({ id: 'image', color: '#808080', mode: 'image' }),
        linesPerMm: 2,
        passes: 2,
      },
    ],
  },
};
const prepared = prepareOutput(project);
const expectedEstimate = estimateLiveJobFromPrepared(prepared, undefined, { unbounded: true });
let workerScope: {
  onmessage: ((event: MessageEvent<PreparationWorkerRequest>) => Promise<void>) | null;
  postMessage: ReturnType<typeof vi.fn>;
};

beforeEach(async () => {
  mocks.prepare.mockReset().mockResolvedValue(prepared);
  mocks.snapshot.mockReset().mockResolvedValue(prepared);
  mocks.preview.mockReset().mockImplementation(() => {
    throw new Error('unnecessary route allocation');
  });
  workerScope = { onmessage: null, postMessage: vi.fn() };
  vi.stubGlobal('self', workerScope);
  vi.resetModules();
  await import('./preparation-worker');
});
afterEach(() => vi.unstubAllGlobals());

describe('preparation worker result projection', () => {
  it.each([undefined, {}])(
    'returns the exact estimate without constructing or posting preview geometry (snapshot %j)',
    async (snapshot) => {
      // Exercise the real worker handler and real duration calculation. The
      // preview trap models the unrelated allocation that made a 4096² ETA fail.
      const request: PreparationWorkerRequest = {
        id: 7,
        project,
        projection: 'estimate',
        ...(snapshot === undefined ? {} : { snapshot }),
      };
      await workerScope.onmessage?.(new MessageEvent('message', { data: request }));
      expect(workerScope.postMessage).toHaveBeenCalledExactlyOnceWith({
        id: 7,
        kind: 'estimate',
        estimate: expectedEstimate,
      });
      expect(expectedEstimate.kind).toBe('estimated');
      expect(mocks.preview).not.toHaveBeenCalled();
      expect(mocks.prepare.mock.calls.length + mocks.snapshot.mock.calls.length).toBe(1);
      const response = workerScope.postMessage.mock.calls[0]?.[0] as PreparationWorkerResponse;
      expect(structuredClone(response)).toEqual(response);
      expect(Object.keys(response).sort()).toEqual(['estimate', 'id', 'kind']);
    },
  );

  it('preserves the default full Preview response and builds its route', async () => {
    const toolpath = { steps: [], totalLength: 42 };
    mocks.preview.mockReturnValue(toolpath);
    await workerScope.onmessage?.(new MessageEvent('message', { data: { id: 9, project } }));
    expect(mocks.preview).toHaveBeenCalledTimes(1);
    expect(workerScope.postMessage).toHaveBeenCalledExactlyOnceWith({
      id: 9,
      kind: 'ok',
      toolpath,
      estimate: expectedEstimate,
      jobOriginOffset: { x: 0, y: 0 },
    });
  });
});
