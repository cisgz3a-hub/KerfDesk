import type { Toolpath } from '../../core/job';
import { previewRouteForDrawing } from './executable-plan-preview-route';
import { preparePreviewFrame } from './preview-route-frame';
import type {
  PreviewRouteWorkerRequest,
  PreviewRouteWorkerResponse,
} from './preview-route-worker-protocol';
import type { ViewTransform } from './view-transform';
import {
  drawTransformedBitmap,
  frameKey,
  paintMatchesTarget,
  sameContent,
  type FrameKey,
  type Painted,
  type Target,
} from './preview-bitmap-view';

const ASYNC_PREVIEW_STEP_THRESHOLD = 20_000;
type Pending = { readonly id: number; readonly frameId: number; readonly target: Target };

// One rendered viewport, one in-flight capture/paint, and one coalesced target.
// The worker receives selected display commands, never the full retained route.
export class PreviewBitmapRenderer {
  private worker: Worker | null = null;
  private failed = false;
  private sequence = 0;
  private frameId = 0;
  private sentKey: FrameKey | null = null;
  private latest: Target | null = null;
  private pending: Pending | null = null;
  private painted: Painted | null = null;

  constructor(private readonly onChange: (pending: boolean, repaint: boolean) => void) {}

  readonly draw = (
    ctx: CanvasRenderingContext2D,
    toolpath: Toolpath,
    view: ViewTransform,
    scrubberT: number,
    showTravel: boolean,
    backgroundKey: object = toolpath,
  ): boolean => {
    const route = previewRouteForDrawing(toolpath);
    if (route.steps.length < ASYNC_PREVIEW_STEP_THRESHOLD || route.totalLength <= 0) {
      if (this.latest !== null) this.clear();
      return false;
    }
    if (!this.ensureWorker()) {
      this.onChange(false, false);
      return false;
    }
    const key = frameKey(this.latest?.key, route, scrubberT, showTravel);
    this.latest = { key, backgroundKey, view, width: ctx.canvas.width, height: ctx.canvas.height };
    if (this.painted !== null && !sameContent(this.painted.target, this.latest)) this.dropBitmap();
    const ready = paintMatchesTarget(this.painted, this.latest);
    this.onChange(!ready, false);
    // Capture the freshly drawn underlay before any old bitmap or rulers are
    // painted. createImageBitmap copies canvas pixels before resolving its promise.
    if (!ready) this.flush(ctx.canvas);
    if (this.failed) return false;
    if (this.painted !== null) drawTransformedBitmap(ctx, this.painted, view);
    return true;
  };

  clear(notify = true): void {
    this.releaseWorker();
    this.dropBitmap();
    this.latest = null;
    this.sentKey = null;
    this.failed = false;
    if (notify) this.onChange(false, false);
  }

  private ensureWorker(): boolean {
    if (
      this.failed ||
      typeof Worker === 'undefined' ||
      typeof OffscreenCanvas === 'undefined' ||
      typeof createImageBitmap === 'undefined'
    )
      return false;
    if (this.worker !== null) return true;
    try {
      const worker = new Worker(new URL('./preview-route-worker.ts', import.meta.url), {
        type: 'module',
      });
      this.worker = worker;
      worker.onmessage = (event: MessageEvent<PreviewRouteWorkerResponse>) => {
        if (worker !== this.worker) {
          if (event.data.kind === 'painted') event.data.bitmap.close();
          return;
        }
        this.accept(event.data);
      };
      worker.onerror = () => {
        if (worker === this.worker) this.fail();
      };
      worker.onmessageerror = () => {
        if (worker === this.worker) this.fail();
      };
      return true;
    } catch {
      this.failed = true;
      return false;
    }
  }

  private flush(canvas: HTMLCanvasElement): void {
    const worker = this.worker;
    if (worker === null || this.pending !== null || this.latest === null) return;
    const target = this.latest;
    const changedFrame = this.sentKey !== target.key;
    const pending = {
      id: ++this.sequence,
      frameId: changedFrame ? ++this.frameId : this.frameId,
      target,
    };
    this.pending = pending;
    try {
      void createImageBitmap(canvas)
        .then((background) => {
          if (this.worker !== worker || this.pending !== pending) {
            background.close();
            return;
          }
          this.postFrame(worker, pending, changedFrame, background);
        })
        .catch(() => {
          if (this.pending === pending) this.fail();
        });
    } catch {
      this.fail();
    }
  }

  private postFrame(
    worker: Worker,
    pending: Pending,
    changedFrame: boolean,
    background: ImageBitmap,
  ): void {
    const target = pending.target;
    try {
      const request: PreviewRouteWorkerRequest = {
        kind: 'render',
        id: pending.id,
        frameId: pending.frameId,
        width: target.width,
        height: target.height,
        view: target.view,
        background,
        ...(changedFrame
          ? {
              frame: preparePreviewFrame(target.key.route, target.key.scrubberT, {
                showTravel: target.key.showTravel,
                showFuture: true,
                showEndpoints: true,
              }),
            }
          : {}),
      };
      worker.postMessage(request, [background]);
      this.sentKey = target.key;
    } catch {
      background.close();
      this.fail();
    }
  }

  private accept(reply: PreviewRouteWorkerResponse): void {
    const pending = this.pending;
    if (pending === null || reply.id !== pending.id || reply.frameId !== pending.frameId) {
      if (reply.kind === 'painted') reply.bitmap.close();
      return;
    }
    this.pending = null;
    if (reply.kind === 'error') {
      this.fail();
      return;
    }
    if (
      this.latest !== null &&
      sameContent(this.latest, pending.target) &&
      !paintMatchesTarget(this.painted, this.latest)
    ) {
      this.dropBitmap();
      this.painted = { bitmap: reply.bitmap, target: pending.target };
    } else reply.bitmap.close();
    // A coalesced view must start after drawScene rebuilds its actual underlay.
    this.onChange(!paintMatchesTarget(this.painted, this.latest), true);
  }

  private fail(): void {
    this.releaseWorker();
    this.dropBitmap();
    this.latest = null;
    this.sentKey = null;
    this.failed = true;
    this.onChange(false, true);
  }

  private releaseWorker(): void {
    if (this.worker !== null) {
      this.worker.onmessage = null;
      this.worker.onerror = null;
      this.worker.onmessageerror = null;
      this.worker.terminate();
      this.worker = null;
    }
    this.pending = null;
  }

  private dropBitmap(): void {
    this.painted?.bitmap.close();
    this.painted = null;
  }
}
