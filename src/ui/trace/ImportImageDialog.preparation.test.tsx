import { act } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { RawImageData } from '../../core/trace';
import type { TraceWorkerRequest, TraceWorkerResponse } from './trace-worker';
import type {
  ConvertBitmapWorkerRequest,
  ConvertBitmapWorkerResponse,
} from '../raster/convert-bitmap-worker-protocol';

vi.mock('./image-loader', () => ({
  PREVIEW_MAX_EDGE_PX: 2048,
  loadImageAsRawData: vi.fn(),
  dataUrlToFile: vi.fn(async () => new File(['fixture'], 'fixture.png')),
}));

import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import { loadImageAsRawData } from './image-loader';
import {
  chooseSettlementOutput,
  mountSettlementDialog,
  settlementResult,
  settlementSource,
  submitSettlement,
} from './trace-settlement.test-support';
import { resetConvertBitmapWorkerForTests } from '../raster/convert-bitmap-worker-client';

const image: RawImageData = {
  width: 401,
  height: 400,
  data: new Uint8ClampedArray(401 * 400 * 4).fill(255),
};
const workers: ControlledWorker[] = [];
class ControlledWorker {
  onmessage:
    | ((event: MessageEvent<TraceWorkerResponse | ConvertBitmapWorkerResponse>) => void)
    | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  readonly requests: Array<TraceWorkerRequest | ConvertBitmapWorkerRequest> = [];
  readonly terminate = vi.fn();
  readonly bitmap: boolean;
  constructor(url: URL) {
    this.bitmap = String(url).includes('convert-bitmap-worker');
    workers.push(this);
  }
  postMessage(request: TraceWorkerRequest | ConvertBitmapWorkerRequest) {
    this.requests.push(request);
  }
  complete() {
    const request = this.requests.at(-1)!;
    if (request === undefined) return;
    if (this.bitmap) {
      this.onmessage?.({
        data: { id: request.id, kind: 'ok', raster: { ...settlementSource, id: 'bitmap' } },
      } as MessageEvent);
    } else {
      const response: TraceWorkerResponse = { id: request.id, kind: 'ok', ...settlementResult };
      this.onmessage?.({ data: response } as MessageEvent);
    }
  }
}

let mounted: Awaited<ReturnType<typeof mountSettlementDialog>> | undefined;
let finishDecode: (() => void) | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('Worker', ControlledWorker);
  vi.mocked(loadImageAsRawData).mockReset().mockResolvedValue(image);
});
afterEach(async () => {
  await mounted?.close();
  mounted = undefined;
  await act(async () => finishDecode?.());
  finishDecode = undefined;
  await act(async () => {
    for (const worker of workers) worker.complete();
  });
  resetConvertBitmapWorkerForTests();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function latestTrace() {
  return workers.filter((worker) => !worker.bitmap).at(-1)!;
}
function latestBitmap() {
  return workers.filter((worker) => worker.bitmap).at(-1)!;
}
function requestCount() {
  return workers.reduce((total, worker) => total + (worker.bitmap ? 0 : worker.requests.length), 0);
}
function decodePending() {
  const pending = new Promise<RawImageData>((resolve) => {
    finishDecode = () => resolve(image);
  });
  vi.mocked(loadImageAsRawData).mockReturnValue(pending);
}
async function choosePreset(value: string) {
  await act(async () => {
    const select = mounted!.host.querySelector<HTMLSelectElement>('[aria-label="Trace preset"]')!;
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
async function finishPreview() {
  await act(async () => latestTrace().complete());
}
async function closeDialog() {
  await act(async () => useUiStore.getState().closeImageDialog());
}
async function dragBoundary() {
  const stage = mounted!.host.querySelector<HTMLDivElement>('[aria-label="Trace preview"]')!;
  stage.getBoundingClientRect = () => ({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 100,
    bottom: 50,
    width: 100,
    height: 50,
    toJSON: () => ({}),
  });
  await act(async () => {
    stage.dispatchEvent(
      new MouseEvent('mousedown', { clientX: 10, clientY: 10, button: 0, bubbles: true }),
    );
    stage.dispatchEvent(
      new MouseEvent('mousemove', { clientX: 60, clientY: 40, buttons: 1, bubbles: true }),
    );
    stage.dispatchEvent(
      new MouseEvent('mouseup', { clientX: 60, clientY: 40, button: 0, bubbles: true }),
    );
  });
}

it('adopts an unfinished matching preview without a second decode or worker request', async () => {
  mounted = await mountSettlementDialog();
  const previewWorker = latestTrace();
  const before = requestCount();
  await submitSettlement(mounted.host);
  expect(requestCount()).toBe(before);
  expect(loadImageAsRawData).toHaveBeenCalledTimes(1);
  expect(previewWorker.terminate).not.toHaveBeenCalled();
  await finishPreview();
  expect(useUiStore.getState().imageDialog).toBeNull();
  expect(useStore.getState().project.scene.objects[0]?.kind).toBe('traced-image');
});

it('adopts the existing decode when Submit occurs before pixels arrive', async () => {
  decodePending();
  mounted = await mountSettlementDialog();
  const before = requestCount();
  await submitSettlement(mounted.host);
  expect(loadImageAsRawData).toHaveBeenCalledTimes(1);
  await act(async () => finishDecode?.());
  expect(requestCount()).toBe(before + 1);
  await finishPreview();
  expect(useUiStore.getState().imageDialog).toBeNull();
});

it('adopts the latest debounced settings without decoding twice', async () => {
  mounted = await mountSettlementDialog();
  await finishPreview();
  await choosePreset('Sharp');
  const before = requestCount();
  await submitSettlement(mounted.host);
  await act(async () => vi.advanceTimersByTimeAsync(300));
  expect(loadImageAsRawData).toHaveBeenCalledTimes(1);
  expect(requestCount()).toBe(before + 1);
  await finishPreview();
  expect(useUiStore.getState().imageDialog).toBeNull();
});

it('Cancel terminates the actual trace worker owned by an early submission', async () => {
  mounted = await mountSettlementDialog();
  const before = useStore.getState().project;
  await submitSettlement(mounted.host);
  const owned = latestTrace();
  await closeDialog();
  expect(owned.terminate).toHaveBeenCalledOnce();
  await act(async () => owned.complete());
  expect(useStore.getState().project).toBe(before);
});

it('Cancel terminates an in-flight raster output worker', async () => {
  mounted = await mountSettlementDialog();
  await finishPreview();
  await chooseSettlementOutput(mounted.host, 'raster', true);
  const before = useStore.getState().project;
  await submitSettlement(mounted.host);
  const owned = latestBitmap();
  await closeDialog();
  expect(owned.terminate).toHaveBeenCalledOnce();
  expect(useStore.getState().project).toBe(before);
});

it('Cancel during an adopted decode cannot start a worker when that decode resolves late', async () => {
  decodePending();
  mounted = await mountSettlementDialog();
  await submitSettlement(mounted.host);
  const before = requestCount();
  await closeDialog();
  await act(async () => finishDecode?.());
  expect(requestCount()).toBe(before);
});

it('freezes settings, output and source deletion while preserving view, zoom and Cancel', async () => {
  mounted = await mountSettlementDialog();
  await finishPreview();
  await chooseSettlementOutput(mounted.host, 'raster', true);
  await submitSettlement(mounted.host);
  const controls = [
    ...mounted.host.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
      '.lf-trace-dialog-controls input, .lf-trace-dialog-controls select, .lf-trace-delete-source input',
    ),
  ];
  expect(controls.length).toBeGreaterThan(3);
  expect(controls.every((control) => control.matches(':disabled'))).toBe(true);
  expect(
    mounted.host
      .querySelector<HTMLButtonElement>('[aria-label="Show original image"]')
      ?.matches(':disabled'),
  ).toBe(false);
  expect(
    mounted.host.querySelector<HTMLButtonElement>('[aria-label="Zoom in"]')?.matches(':disabled'),
  ).toBe(false);
  const cancel = [...mounted.host.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() === 'Cancel',
  );
  expect(cancel?.matches(':disabled')).toBe(false);
});

it('freezes boundary dragging, clear and mode after submission', async () => {
  mounted = await mountSettlementDialog();
  await finishPreview();
  await dragBoundary();
  await act(async () => vi.advanceTimersByTimeAsync(300));
  await finishPreview();
  await chooseSettlementOutput(mounted.host, 'raster', true);
  await submitSettlement(mounted.host);
  const mode = mounted.host.querySelector<HTMLSelectElement>('[aria-label="Trace boundary mode"]');
  expect(mode === null || mode.matches(':disabled')).toBe(true);
  const clear = [...mounted.host.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() === 'Clear Boundary',
  );
  expect(clear === undefined || clear.matches(':disabled')).toBe(true);
  const before = requestCount();
  await dragBoundary();
  await act(async () => vi.advanceTimersByTimeAsync(300));
  expect(requestCount()).toBe(before);
});

it('replacement of the captured source aborts committed tracing but unrelated state edits do not', async () => {
  mounted = await mountSettlementDialog();
  await submitSettlement(mounted.host);
  const owned = latestTrace();
  await act(async () => useStore.setState({ dirty: true }));
  expect(owned.terminate).not.toHaveBeenCalled();
  const state = useStore.getState();
  await act(async () =>
    useStore.setState({
      project: {
        ...state.project,
        scene: { ...state.project.scene, objects: [{ ...settlementSource }] },
      },
    }),
  );
  expect(owned.terminate).toHaveBeenCalledOnce();
  expect(mounted.host.querySelector('button[type="submit"]')?.matches(':disabled')).toBe(false);
  expect(mounted.host.textContent).not.toContain('Tracing...');
});

it('coalesces two synchronous Submit events into one computation and history entry', async () => {
  mounted = await mountSettlementDialog();
  const before = requestCount();
  await act(async () => {
    const form = mounted!.host.querySelector('form')!;
    form.requestSubmit();
    form.requestSubmit();
  });
  expect(requestCount()).toBe(before);
  await finishPreview();
  expect(useStore.getState().undoStack).toHaveLength(1);
});

it('an aborted submission cannot unfreeze an immediate retry in the same dialog', async () => {
  mounted = await mountSettlementDialog();
  await submitSettlement(mounted.host);
  const old = latestTrace();
  const project = useStore.getState().project;
  await act(async () => {
    useStore.setState({
      project: {
        ...project,
        scene: { ...project.scene, objects: [{ ...settlementSource }] },
      },
    });
    mounted!.host.querySelector('form')!.requestSubmit();
  });
  expect(old.terminate).toHaveBeenCalledOnce();
  const retry = latestTrace();
  expect(retry).not.toBe(old);
  expect(retry.terminate).not.toHaveBeenCalled();
  expect(mounted.host.querySelector('button[type="submit"]')?.matches(':disabled')).toBe(true);
  await finishPreview();
  expect(useStore.getState().undoStack).toHaveLength(1);
  expect(useUiStore.getState().imageDialog).toBeNull();
});

it('an old cancelled decode cannot start tracing or abort a replacement request', async () => {
  decodePending();
  mounted = await mountSettlementDialog();
  await submitSettlement(mounted.host);
  const completeOldDecode = finishDecode!;
  vi.mocked(loadImageAsRawData).mockResolvedValue(image);
  await act(async () => {
    useUiStore.getState().openImageDialog({ ...settlementSource, source: 'replacement.png' });
  });
  const replacement = latestTrace();
  const before = requestCount();
  await act(async () => completeOldDecode());
  expect(requestCount()).toBe(before);
  expect(replacement.terminate).not.toHaveBeenCalled();
  await finishPreview();
  expect(mounted.host.textContent).toContain('Show Points');
});

it('an Image operation edit aborts obsolete bitmap work while an unrelated edit preserves it', async () => {
  mounted = await mountSettlementDialog();
  await finishPreview();
  await chooseSettlementOutput(mounted.host, 'raster', true);
  await submitSettlement(mounted.host);
  const owned = latestBitmap();
  await act(async () => useStore.setState({ dirty: true }));
  expect(owned.terminate).not.toHaveBeenCalled();
  const project = useStore.getState().project;
  await act(async () =>
    useStore.setState({
      project: {
        ...project,
        scene: {
          ...project.scene,
          layers: project.scene.layers.map((layer) => ({
            ...layer,
            linesPerMm: layer.linesPerMm + 1,
          })),
        },
      },
    }),
  );
  expect(owned.terminate).toHaveBeenCalledOnce();
  expect(useStore.getState().undoStack).toHaveLength(0);
  expect(mounted.host.querySelector('button[type="submit"]')?.matches(':disabled')).toBe(false);
});
