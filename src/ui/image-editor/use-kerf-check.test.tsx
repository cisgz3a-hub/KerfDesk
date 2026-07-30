import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRgbaBuffer } from '../../core/image-edit/rgba-buffer';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type RasterImage,
} from '../../core/scene';
import { DEFAULT_JOB_PLACEMENT } from '../job-placement';
import { useStore } from '../state';
import type { KerfOutputParity } from './editor-kerf-output-parity';
import { createSession } from './editor-session';
import { useImageEditorStore } from './image-editor-store';
import type { KerfCheckWorkerHandle } from './kerf-check-worker-client';
import type { KerfCheckWorkerRequest } from './kerf-check-worker-protocol';
import { useKerfCheck } from './use-kerf-check';

const workerMocks = vi.hoisted(() => ({
  startKerfCheckWorker: vi.fn(),
}));

vi.mock('./kerf-check-worker-client', () => workerMocks);

// React's test-only act marker is absent from the standard globalThis type.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const COLOR = '#808080';
const OTHER_COLOR = '#ff0000';
const SIZE_PX = 20;
const BOUNDS = { minX: 0, minY: 0, maxX: 20, maxY: 20 };
const DEBOUNCE_MS = 400;

type DeferredWorker = {
  readonly handle: KerfCheckWorkerHandle;
  readonly resolve: (value: KerfOutputParity | null) => void;
  readonly reject: (error: Error) => void;
  readonly cancel: ReturnType<typeof vi.fn>;
};

function image(id: string, color = COLOR): RasterImage {
  return {
    kind: 'raster-image',
    id,
    source: `${id}.png`,
    dataUrl: 'data:image/png;base64,source',
    pixelWidth: SIZE_PX,
    pixelHeight: SIZE_PX,
    bounds: BOUNDS,
    transform: IDENTITY_TRANSFORM,
    color,
    dither: 'threshold',
    linesPerMm: 1,
    lumaBase64: 'AAA=',
  };
}

function project(): Project {
  const base = createProject();
  return {
    ...base,
    scene: {
      objects: [image('R1'), image('unrelated', OTHER_COLOR)],
      layers: [
        {
          ...createLayer({ id: 'kerf-layer', color: COLOR, mode: 'image' }),
          dotWidthCorrectionMm: 1,
          linesPerMm: 1,
        },
        {
          ...createLayer({ id: 'unrelated-layer', color: OTHER_COLOR, mode: 'image' }),
          dotWidthCorrectionMm: 0.5,
          linesPerMm: 4,
        },
      ],
    },
  };
}

function session(id: string) {
  const current = createSession(id, `${id}.png`, createRgbaBuffer(SIZE_PX, SIZE_PX), BOUNDS);
  for (let y = 0; y < SIZE_PX; y += 1) {
    const base = (y * SIZE_PX + 2) * 4;
    current.doc.data[base] = 0;
    current.doc.data[base + 1] = 0;
    current.doc.data[base + 2] = 0;
  }
  return current;
}

function parity(removedPixels: number): KerfOutputParity {
  return {
    removedPixels,
    minCorrectionMm: 1,
    maxCorrectionMm: 1,
    thickenCandidate: null,
  };
}

function deferredWorker(): DeferredWorker {
  let resolve = (_value: KerfOutputParity | null): void => undefined;
  let reject = (_error: Error): void => undefined;
  const result = new Promise<KerfOutputParity | null>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  const cancel = vi.fn();
  return { handle: { result, cancel }, resolve, reject, cancel };
}

function resolvedWorker(value: KerfOutputParity | null): KerfCheckWorkerHandle {
  return { result: Promise.resolve(value), cancel: vi.fn() };
}

function firstWorkerRequest(): KerfCheckWorkerRequest {
  const request = workerMocks.startKerfCheckWorker.mock.calls[0]?.[0] as
    | KerfCheckWorkerRequest
    | undefined;
  if (request === undefined) throw new Error('Expected one kerf worker request.');
  return request;
}

function expectTargetScopedRequest(
  request: KerfCheckWorkerRequest,
  sourceData: Uint8ClampedArray,
): void {
  expect(request.object.id).toBe('R1');
  expect(request.object.dataUrl).toBe('');
  expect(request.object.lumaBase64).toBeUndefined();
  expect(request.layers.map((layer) => layer.id)).toEqual(['kerf-layer']);
  expect(request.maskObject).toBeNull();
  expect(request).not.toHaveProperty('project');
  expect(request.composite.data).toBe(sourceData);
}

function Harness(): JSX.Element {
  const composite = useImageEditorStore((state) => state.session?.doc);
  const check = useKerfCheck(composite);
  return <output>{check?.removedPixels ?? 'none'}</output>;
}

describe('useKerfCheck', () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;

  beforeEach(async () => {
    vi.useFakeTimers();
    workerMocks.startKerfCheckWorker.mockReset();
    workerMocks.startKerfCheckWorker.mockReturnValue(resolvedWorker(parity(7)));
    useStore.setState({
      project: project(),
      outputScopeSettings: { cutSelectedGraphics: false, useSelectionOrigin: false },
      selectedObjectId: null,
      additionalSelectedIds: new Set(),
      jobPlacement: DEFAULT_JOB_PLACEMENT,
    });
    useImageEditorStore.setState({ session: session('R1') });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root?.render(<Harness />));
  });

  afterEach(async () => {
    if (root !== null) await act(async () => root?.unmount());
    host?.remove();
    root = null;
    host = null;
    vi.useRealTimers();
  });

  it('debounces one target-scoped request with the shared composite', async () => {
    const source = useImageEditorStore.getState().session?.doc;
    if (source === undefined) throw new Error('Expected an editor source document.');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 1);
    });
    expect(workerMocks.startKerfCheckWorker).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(workerMocks.startKerfCheckWorker).toHaveBeenCalledTimes(1);
    expectTargetScopedRequest(firstWorkerRequest(), source.data);
    expect(source.data.byteLength).toBe(SIZE_PX * SIZE_PX * 4);
    expect(host?.textContent).toBe('7');
  });

  it('cancels superseded work and ignores an older out-of-order completion', async () => {
    const first = deferredWorker();
    const second = deferredWorker();
    workerMocks.startKerfCheckWorker
      .mockReset()
      .mockReturnValueOnce(first.handle)
      .mockReturnValueOnce(second.handle);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    });
    expect(workerMocks.startKerfCheckWorker).toHaveBeenCalledTimes(1);

    await act(async () => {
      useImageEditorStore.setState({ session: session('R1') });
    });
    expect(first.cancel).toHaveBeenCalledTimes(1);
    expect(host?.textContent).toBe('none');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    });
    expect(workerMocks.startKerfCheckWorker).toHaveBeenCalledTimes(2);

    await act(async () => {
      second.resolve(parity(9));
      await Promise.resolve();
    });
    expect(host?.textContent).toBe('9');

    await act(async () => {
      first.resolve(parity(3));
      await Promise.resolve();
    });
    expect(host?.textContent).toBe('9');
  });

  it.each(['session', 'project', 'output-scope', 'output-placement'] as const)(
    'hides a completed result immediately when the %s changes',
    async (replacement) => {
      const worker = deferredWorker();
      workerMocks.startKerfCheckWorker.mockReset().mockReturnValue(worker.handle);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
        worker.resolve(parity(5));
        await Promise.resolve();
      });
      expect(host?.textContent).toBe('5');

      await act(async () => {
        if (replacement === 'session') {
          useImageEditorStore.setState({ session: session('R2') });
        } else if (replacement === 'project') {
          useStore.setState({ project: project() });
        } else if (replacement === 'output-scope') {
          useStore.setState({
            outputScopeSettings: { cutSelectedGraphics: true, useSelectionOrigin: false },
            selectedObjectId: 'R1',
            additionalSelectedIds: new Set(),
          });
        } else {
          useStore.setState({
            jobPlacement: { startFrom: 'user-origin', anchor: 'front-left' },
          });
        }
      });

      expect(host?.textContent).toBe('none');
      expect(worker.cancel).toHaveBeenCalledTimes(1);
    },
  );

  it('suppresses the optional advisory when workers are unavailable', async () => {
    workerMocks.startKerfCheckWorker.mockReset().mockReturnValue(null);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    });
    expect(workerMocks.startKerfCheckWorker).toHaveBeenCalledTimes(1);
    expect(host?.textContent).toBe('none');
  });

  it('suppresses worker failures without publishing a stale result', async () => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    });
    expect(host?.textContent).toBe('7');

    const worker = deferredWorker();
    workerMocks.startKerfCheckWorker.mockReturnValueOnce(worker.handle);
    await act(async () => {
      useImageEditorStore.setState({ session: session('R1') });
    });
    expect(host?.textContent).toBe('none');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
      worker.reject(new Error('worker failed'));
      await Promise.resolve();
    });
    expect(workerMocks.startKerfCheckWorker).toHaveBeenCalledTimes(2);
    expect(host?.textContent).toBe('none');
  });
});
