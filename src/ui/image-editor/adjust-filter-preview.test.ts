// Neighbourhood-filter previews in a worker (ADR-245 Amendment 2). A fake
// Worker runs the real worker module, so these check the bytes it returns as
// well as the client's supersede, resample, cancel and fallback rules.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RgbaBuffer } from '../../core/image-edit';
import { createRgbaBuffer } from '../../core/image-edit/rgba-buffer';
import type { SelectionMask } from '../../core/image-select';
import { refreshAdjustPreview, useAdjustDialogStore } from './adjust-dialog-store';
import { START_DELAY_MS } from './adjust-filter-preview';
import { resetFilterPreviewWorkerForTests } from './adjust-filter-worker-client';
import type {
  FilterPreviewRequest,
  FilterPreviewResponse,
} from './adjust-filter-worker-protocol';
import { sampleWindowInto, type PreviewWindow } from './adjust-preview-window';
import { commitAdjustment } from './editor-adjust-session';
import { ADJUSTMENTS, defaultParams, type AdjustmentId } from './editor-adjustments';
import { createSession, withSelection, type EditorSession } from './editor-session';
import { addLayerAboveActive, compositeSession } from './editor-session-layers';
import { useImageEditorStore } from './image-editor-store';

// Just over the worker threshold (512 x 512).
const W = 520;
const H = 512;
const BOUNDS = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
const VIEW_A = { scale: 1, panX: -150, panY: -120 };
const VIEW_B = { scale: 1, panX: -230, panY: -170 };
const VIEWPORT = { width: 160, height: 120 };

// Stands in for the worker's global scope while the tests run. It keeps the
// page's location: Vite resolves the client's worker URL against self.location.
type Scope = {
  onmessage: ((event: MessageEvent<FilterPreviewRequest>) => void) | null;
  postMessage: (response: FilterPreviewResponse) => void;
  readonly location: Location;
};
const scope: Scope = { onmessage: null, postMessage: () => undefined, location: window.location };

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent<FilterPreviewResponse>) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  readonly posted: FilterPreviewRequest[] = [];
  terminated = false;

  constructor() {
    FakeWorker.instances.push(this);
  }

  postMessage(request: FilterPreviewRequest): void {
    this.posted.push(request);
  }

  terminate(): void {
    this.terminated = true;
  }

  /** Run the real worker on the oldest posted request and deliver its replies. */
  run(): void {
    const request = this.posted.shift();
    if (request === undefined) throw new Error('nothing posted');
    scope.postMessage = (response) => {
      if (!this.terminated) this.onmessage?.({ data: response } as MessageEvent);
    };
    scope.onmessage?.({ data: request } as MessageEvent<FilterPreviewRequest>);
  }
}

function photo(alphaOf: (x: number, y: number) => number): RgbaBuffer {
  const buffer = createRgbaBuffer(W, H);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = (y * W + x) * 4;
      const speckle = (x * 37 + y * 101 + ((x * y) % 13) * 7) % 53;
      buffer.data[i] = (x * 3 + speckle) % 256;
      buffer.data[i + 1] = (y * 5 + speckle * 2) % 256;
      buffer.data[i + 2] = ((x + y) * 2 + speckle * 3) % 256;
      buffer.data[i + 3] = alphaOf(x, y);
    }
  }
  return buffer;
}

function feathered(): SelectionMask {
  const alpha = new Uint8Array(W * H);
  for (let y = 100; y < 400; y += 1) {
    for (let x = 120; x < 420; x += 1) {
      alpha[y * W + x] = Math.min(255, 40 + Math.min(x - 120, 419 - x, y - 100, 399 - y) * 30);
    }
  }
  return { width: W, height: H, alpha };
}

// An upper layer over a base, with a feathered selection: the hardest case.
function makeSession(): EditorSession {
  const base = createSession(
    'obj-filter',
    'filter.png',
    photo(() => 255),
    BOUNDS,
  );
  const upper = addLayerAboveActive(base, 'upper');
  upper.doc.data.set(photo((x, y) => (x * 11 + y * 7) % 256).data);
  return withSelection(upper, feathered());
}

function offDefault(id: AdjustmentId): Record<string, number> {
  const spec = ADJUSTMENTS.find((entry) => entry.id === id);
  if (spec === undefined) throw new Error(id);
  const params = defaultParams(spec);
  for (const param of spec.params) {
    params[param.key] = Math.min(param.max, param.defaultValue + param.step * 3);
  }
  return params;
}

function committedCrop(id: AdjustmentId, params: Record<string, number>, win: PreviewWindow) {
  const baked = compositeSession(commitAdjustment(makeSession(), id, params));
  const out = createRgbaBuffer(win.rect.width, win.rect.height);
  sampleWindowInto(baked, win, out);
  return out.data;
}

function dialog() {
  const current = useAdjustDialogStore.getState().dialog;
  if (current === null) throw new Error('dialog closed');
  return current;
}

function lastWorker(): FakeWorker {
  const worker = FakeWorker.instances.at(-1);
  if (worker === undefined) throw new Error('no worker');
  return worker;
}

function openFilter(id: AdjustmentId, params = offDefault(id)): void {
  useAdjustDialogStore.getState().open(id);
  useAdjustDialogStore.getState().setParams(params);
}

beforeAll(async () => {
  vi.stubGlobal('self', scope);
  await import('./adjust-filter-worker');
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('self', scope);
  vi.stubGlobal('Worker', FakeWorker);
  FakeWorker.instances = [];
  useAdjustDialogStore.setState({ dialog: null });
  useImageEditorStore.setState({
    session: makeSession(),
    transform: null,
    view: VIEW_A,
    viewportSize: VIEWPORT,
  });
});

afterEach(() => {
  useAdjustDialogStore.setState({ dialog: null });
  resetFilterPreviewWorkerForTests();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('neighbourhood-filter previews in the worker', () => {
  const FILTERS = ADJUSTMENTS.filter((spec) => !spec.pointwise).map((spec) => spec.id);

  it.each(FILTERS)('%s: shows a bar at once, then a 1:1 preview equal to what OK bakes', (id) => {
    const params = offDefault(id);
    openFilter(id, params);
    refreshAdjustPreview();
    expect(dialog().previewProgress).toBe(0);
    expect(dialog().preview).toBeNull();
    expect(FakeWorker.instances).toHaveLength(0);
    vi.advanceTimersByTime(START_DELAY_MS);
    const worker = lastWorker();
    expect(worker.posted[0]?.source).not.toBeNull();
    worker.run();
    const preview = dialog().preview;
    expect(dialog().previewProgress).toBeNull();
    if (preview === null) throw new Error('no preview');
    const win = { rect: preview.rect, width: preview.rect.width, height: preview.rect.height };
    expect(preview.buffer.width).toBe(preview.rect.width);
    expect([id, ...preview.buffer.data]).toEqual([id, ...committedCrop(id, params, win)]);
  });

  it('a step with other settings terminates the running render, and the latest wins', () => {
    openFilter('gaussian-blur', { sigma: 3 });
    refreshAdjustPreview();
    vi.advanceTimersByTime(START_DELAY_MS);
    const first = lastWorker();
    useAdjustDialogStore.getState().setParams({ sigma: 6 });
    refreshAdjustPreview();
    expect(first.terminated).toBe(true);
    vi.advanceTimersByTime(START_DELAY_MS);
    const second = lastWorker();
    expect(second).not.toBe(first);
    expect(second.posted[0]?.adjustment.params['sigma']).toBe(6);
    second.run();
    const preview = dialog().preview;
    if (preview === null) throw new Error('no preview');
    const win = { rect: preview.rect, width: preview.rect.width, height: preview.rect.height };
    expect([...preview.buffer.data]).toEqual([
      ...committedCrop('gaussian-blur', { sigma: 6 }, win),
    ]);
  });

  it('steps closer together than the start delay start one render', () => {
    openFilter('median', { radius: 1 });
    for (const radius of [2, 3, 2]) {
      useAdjustDialogStore.getState().setParams({ radius });
      refreshAdjustPreview();
      vi.advanceTimersByTime(START_DELAY_MS / 2);
    }
    vi.advanceTimersByTime(START_DELAY_MS);
    expect(FakeWorker.instances).toHaveLength(1);
    expect(lastWorker().posted.map((request) => request.adjustment.params['radius'])).toEqual([2]);
  });

  it('a pan with unchanged settings only resamples what the worker filtered', () => {
    openFilter('halftone');
    refreshAdjustPreview();
    vi.advanceTimersByTime(START_DELAY_MS);
    lastWorker().run();
    useImageEditorStore.setState({ view: VIEW_B });
    refreshAdjustPreview();
    vi.advanceTimersByTime(START_DELAY_MS);
    expect(FakeWorker.instances).toHaveLength(1);
    const worker = lastWorker();
    expect(worker.posted[0]?.source).toBeNull();
    worker.run();
    const preview = dialog().preview;
    if (preview === null) throw new Error('no preview');
    expect(preview.rect.x).toBe(230);
    const win = { rect: preview.rect, width: preview.rect.width, height: preview.rect.height };
    expect([...preview.buffer.data]).toEqual([
      ...committedCrop('halftone', offDefault('halftone'), win),
    ]);
  });

  it('a pan during a render lets it finish, then resamples the new window', () => {
    openFilter('unsharp-mask');
    refreshAdjustPreview();
    vi.advanceTimersByTime(START_DELAY_MS);
    const worker = lastWorker();
    useImageEditorStore.setState({ view: VIEW_B });
    refreshAdjustPreview();
    vi.advanceTimersByTime(START_DELAY_MS);
    expect(worker.terminated).toBe(false);
    expect(worker.posted).toHaveLength(1);
    worker.run();
    expect(dialog().preview).toBeNull();
    expect(worker.posted[0]?.source).toBeNull();
    worker.run();
    expect(dialog().preview?.rect.x).toBe(230);
    expect(dialog().previewProgress).toBeNull();
  });

  it('Cancel preview stops the render and turns Preview off', () => {
    openFilter('gaussian-blur');
    refreshAdjustPreview();
    vi.advanceTimersByTime(START_DELAY_MS);
    useAdjustDialogStore.getState().cancelPreviewRender();
    expect(lastWorker().terminated).toBe(true);
    expect(dialog().previewEnabled).toBe(false);
    expect(dialog().previewProgress).toBeNull();
  });

  it('closing the dialog retires the worker', () => {
    openFilter('high-pass');
    refreshAdjustPreview();
    vi.advanceTimersByTime(START_DELAY_MS);
    lastWorker().run();
    useAdjustDialogStore.getState().cancel();
    expect(lastWorker().terminated).toBe(true);
  });

  it('a worker that fails falls back to previewing on the UI thread', () => {
    openFilter('line-screen');
    refreshAdjustPreview();
    vi.advanceTimersByTime(START_DELAY_MS);
    lastWorker().onerror?.();
    expect(dialog().previewProgress).toBeNull();
    const preview = dialog().preview;
    if (preview === null) throw new Error('no preview');
    const win = { rect: preview.rect, width: preview.rect.width, height: preview.rect.height };
    expect([...preview.buffer.data]).toEqual([
      ...committedCrop('line-screen', offDefault('line-screen'), win),
    ]);
    // Later steps stay on the UI thread.
    useAdjustDialogStore.getState().setParams({ spacing: 20 });
    refreshAdjustPreview();
    expect(dialog().previewProgress).toBeNull();
    expect(FakeWorker.instances).toHaveLength(1);
  });

  it('small documents stay on the UI thread', () => {
    useImageEditorStore.setState({
      session: createSession('obj-small', 'small.png', createRgbaBuffer(64, 64), BOUNDS),
      view: { scale: 1, panX: 0, panY: 0 },
    });
    openFilter('gaussian-blur');
    refreshAdjustPreview();
    expect(dialog().preview).not.toBeNull();
    expect(dialog().previewProgress).toBeNull();
    expect(FakeWorker.instances).toHaveLength(0);
  });
});
