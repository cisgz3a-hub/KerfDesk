import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PreparedPreviewFrame } from './preview-route-frame';
import { packPreviewFrame } from './preview-route-frame-transfer';
import type {
  PreviewRouteWorkerRequest,
  PreviewRouteWorkerResponse,
} from './preview-route-worker-protocol';

const frame: PreparedPreviewFrame = {
  futureSteps: [],
  wholeSteps: [{ kind: 'travel', from: { x: 0, y: 0 }, to: { x: 1, y: 2 } }],
  partial: null,
  head: null,
  start: null,
  end: null,
};
const moves = vi.fn();
const context = {
  save: vi.fn(),
  restore: vi.fn(),
  clearRect: vi.fn(),
  beginPath: vi.fn(),
  moveTo: moves,
  lineTo: vi.fn(),
  stroke: vi.fn(),
  setLineDash: vi.fn(),
  drawImage: vi.fn(),
};
const bitmaps: Array<{ readonly close: ReturnType<typeof vi.fn> }> = [];
const backgrounds: Array<{ readonly close: ReturnType<typeof vi.fn> }> = [];
class TestCanvas {
  static instances: TestCanvas[] = [];
  constructor(
    public width: number,
    public height: number,
  ) {
    TestCanvas.instances.push(this);
  }
  getContext = vi.fn((_kind: string, _options?: { willReadFrequently: boolean }) => {
    return context;
  });
  transferToImageBitmap() {
    const bitmap = { close: vi.fn() };
    bitmaps.push(bitmap);
    return bitmap;
  }
}
let scope: {
  onmessage: ((event: MessageEvent<PreviewRouteWorkerRequest>) => void) | null;
  postMessage: ReturnType<typeof vi.fn>;
};

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  bitmaps.length = 0;
  backgrounds.length = 0;
  TestCanvas.instances = [];
  scope = { onmessage: null, postMessage: vi.fn() };
  vi.stubGlobal('self', scope);
  vi.stubGlobal('OffscreenCanvas', TestCanvas);
  await import('./preview-route-worker');
});
afterEach(() => vi.unstubAllGlobals());

function render(
  request: Omit<Partial<PreviewRouteWorkerRequest>, 'frame'> & {
    frame?: PreparedPreviewFrame;
  } = {},
) {
  const background = request.background ?? newBackground();
  scope.onmessage?.({
    data: {
      kind: 'render',
      id: 1,
      frameId: 1,
      width: 100,
      height: 80,
      view: { scale: 1, offsetX: 0, offsetY: 0 },
      ...request,
      ...(request.frame === undefined ? {} : { frame: packPreviewFrame(request.frame) }),
      background,
    },
  } as MessageEvent<PreviewRouteWorkerRequest>);
  return scope.postMessage.mock.calls.at(-1)?.[0] as PreviewRouteWorkerResponse;
}

function newBackground(): ImageBitmap {
  const background = { close: vi.fn() };
  backgrounds.push(background);
  return background as unknown as ImageBitmap;
}

describe('Preview route worker ownership', () => {
  it('keeps CPU progress frames separate from exact GPU repaint and reuses their geometry', () => {
    expect(render({ frame, interactive: true }).kind).toBe('painted');
    const interactive = TestCanvas.instances[0]!;
    expect(interactive.getContext).toHaveBeenLastCalledWith('2d', { willReadFrequently: true });
    expect(render({ id: 2, interactive: false }).kind).toBe('painted');
    const settled = TestCanvas.instances[1]!;
    expect(settled.getContext).toHaveBeenLastCalledWith('2d', { willReadFrequently: false });
    expect(moves).toHaveBeenLastCalledWith(0, 0);
    expect(render({ id: 3, interactive: true, width: 200 }).kind).toBe('painted');
    expect(TestCanvas.instances).toHaveLength(2);
    expect(interactive.width).toBe(200);
    expect(settled.width).toBe(100);
    expect(backgrounds.every((background) => background.close.mock.calls.length === 1)).toBe(true);
  });

  it('reuses one prepared frame and canvas for new viewports, then replaces the frame', () => {
    expect(render({ frame }).kind).toBe('painted');
    expect(scope.postMessage.mock.calls[0]?.[1]).toEqual([bitmaps[0]]);
    expect(
      render({ id: 2, width: 200, view: { scale: 2, offsetX: 3, offsetY: -4 } }),
    ).toMatchObject({ kind: 'painted', id: 2, frameId: 1 });
    expect(moves).toHaveBeenLastCalledWith(3, -4);
    expect(TestCanvas.instances).toHaveLength(1);
    expect(TestCanvas.instances[0]?.width).toBe(200);
    const next: PreparedPreviewFrame = {
      ...frame,
      wholeSteps: [{ kind: 'travel', from: { x: 9, y: 8 }, to: { x: 10, y: 8 } }],
    };
    expect(render({ id: 3, frameId: 2, frame: next }).kind).toBe('painted');
    expect(moves).toHaveBeenLastCalledWith(9, 8);
    expect(bitmaps.every((bitmap) => bitmap.close.mock.calls.length === 0)).toBe(true);
    expect(context.drawImage.mock.calls.map((call) => call[0])).toEqual(backgrounds);
    expect(backgrounds.every((background) => background.close.mock.calls.length === 1)).toBe(true);
  });

  it('rejects missing and stale frame identities without publishing a bitmap', () => {
    expect(render()).toMatchObject({ kind: 'error', id: 1, frameId: 1 });
    render({ frame });
    expect(render({ id: 2, frameId: 2 })).toMatchObject({ kind: 'error', id: 2, frameId: 2 });
    expect(bitmaps).toHaveLength(1);
    expect(backgrounds.every((background) => background.close.mock.calls.length === 1)).toBe(true);
  });

  it('closes an untransferred bitmap and reports the exact failure', () => {
    scope.postMessage.mockImplementationOnce(() => {
      throw new Error('bitmap transfer failed');
    });
    expect(render({ frame })).toMatchObject({ kind: 'error', message: 'bitmap transfer failed' });
    expect(bitmaps[0]?.close).toHaveBeenCalledOnce();
    expect(backgrounds[0]?.close).toHaveBeenCalledOnce();
  });

  it('releases the background when its pixels cannot be drawn', () => {
    context.drawImage.mockImplementationOnce(() => {
      throw new Error('background draw failed');
    });
    expect(render({ frame })).toMatchObject({ kind: 'error', message: 'background draw failed' });
    expect(backgrounds[0]?.close).toHaveBeenCalledOnce();
    expect(bitmaps).toHaveLength(0);
  });
});
