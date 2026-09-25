// Imperative core of the trace preview's zoom and pan. React state holds only
// the RENDERED zoom (the stage's laid-out size); this engine holds the zoom and
// scroll the user last asked for, so rapid wheel/pinch events chain from the
// request rather than from stale layout.
//
// Re-laying the stage re-rasterises the whole trace: a median 255 ms per step
// for a synthetic 224k-point stroked trace in a 600x280 px viewport in
// Chromium, against one 16.7 ms frame for a lens transform (measured in
// ADR-399). A wheel or pinch burst therefore
// runs 'live': each step only scales the already-painted artwork layer (the
// lens, a standing compositor layer) with a transform, and the stage re-lays
// once, LIVE_ZOOM_SETTLE_MS after the last step, at the same view (ADR-399).
// Nothing here reaches trace options, the Boundary or the worker.

import {
  anchoredScrollOffset,
  clampPreviewZoom,
  clampPreviewZoomToward,
  clampScrollOffset,
  DEFAULT_PREVIEW_ZOOM_RANGE,
  liveLensTransform,
  MIN_PREVIEW_ZOOM,
  type PreviewZoomRange,
} from './trace-preview-zoom-math';

/** A point in client (window) coordinates. */
export type ClientPoint = { readonly clientX: number; readonly clientY: number };
/** 'commit' re-lays the stage now; 'live' previews a gesture step on the lens. */
export type ZoomMode = 'commit' | 'live';

/** Idle gap after the last live wheel/pinch step before the stage re-lays. */
export const LIVE_ZOOM_SETTLE_MS = 150;

type ScrollPosition = { readonly left: number; readonly top: number };
type ElementRef = { readonly current: HTMLDivElement | null };

export class TracePreviewZoomEngine {
  range: PreviewZoomRange = DEFAULT_PREVIEW_ZOOM_RANGE;
  private target = MIN_PREVIEW_ZOOM;
  private rendered = MIN_PREVIEW_ZOOM;
  private pendingScroll: ScrollPosition | null = null;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly viewportRef: ElementRef,
    private readonly lensRef: ElementRef,
    private readonly layOut: (zoom: number) => void,
  ) {}

  /** Latest requested zoom (ahead of the rendered one during a gesture). */
  get requestedZoom(): number {
    return this.target;
  }

  /** Zoom about `anchor` (viewport centre when omitted); false if unchanged. */
  zoomTo(value: number, anchor?: ClientPoint, mode: ZoomMode = 'commit'): boolean {
    const next = clampPreviewZoomToward(this.target, value, this.range);
    const changed = this.retarget(next, anchor);
    if (mode === 'commit') {
      if (changed || this.settleTimer !== null) this.settleNow();
      return changed;
    }
    if (!changed) return false;
    this.showLens();
    this.cancelSettle();
    this.settleTimer = setTimeout(() => this.settleNow(), LIVE_ZOOM_SETTLE_MS);
    return true;
  }

  /** Scroll by screen pixels (positive reveals content to the right/below). */
  panBy(dx: number, dy: number): void {
    const viewport = this.viewportRef.current;
    if (viewport === null || !Number.isFinite(dx) || !Number.isFinite(dy)) return;
    const pending = this.pendingScroll;
    if (pending === null) {
      viewport.scrollLeft += dx;
      viewport.scrollTop += dy;
      return;
    }
    this.pendingScroll = {
      left: clampScrollOffset(pending.left + dx, viewport.clientWidth, this.target),
      top: clampScrollOffset(pending.top + dy, viewport.clientHeight, this.target),
    };
    if (this.settleTimer !== null) this.showLens();
  }

  /** Re-lay a live gesture's zoom now (before a Boundary drag, say). */
  settle(): void {
    if (this.settleTimer !== null) this.settleNow();
  }

  /** The stage was laid out at `zoom` (a React layout effect). */
  onLaidOut(zoom: number): void {
    this.rendered = zoom;
    if (this.target === zoom) {
      clearLens(this.lensRef.current);
      this.applyPendingScroll();
    } else {
      // A live step arrived while React laid out an earlier target: keep that
      // step's scroll pending and re-aim the lens from the new layout.
      this.showLens();
    }
  }

  /** Pull a zoom the new range no longer contains back to its nearest limit. */
  reclamp(): void {
    const clamped = clampPreviewZoom(this.target, this.range);
    if (!Number.isFinite(clamped) || clamped === this.target) return;
    this.retarget(clamped);
    this.settleNow();
  }

  dispose(): void {
    this.cancelSettle();
  }

  // Lay the stage out at the requested zoom. Steps that return to the rendered
  // zoom leave React nothing to commit; the stage already has this size.
  private settleNow(): void {
    this.cancelSettle();
    if (this.target !== this.rendered) {
      this.layOut(this.target);
      return;
    }
    clearLens(this.lensRef.current);
    this.applyPendingScroll();
  }

  private cancelSettle(): void {
    if (this.settleTimer === null) return;
    clearTimeout(this.settleTimer);
    this.settleTimer = null;
  }

  // Record the target zoom and the scroll that keeps `anchor` still.
  private retarget(next: number, anchor?: ClientPoint): boolean {
    const previous = this.target;
    if (!Number.isFinite(next) || next === previous) return false;
    const viewport = this.viewportRef.current;
    if (viewport !== null) {
      // Capture before shrinking the stage: the browser may clamp its current
      // scroll offset during layout, losing the previous inspection point.
      this.pendingScroll = anchoredScroll(viewport, this.pendingScroll, anchor, {
        previous,
        next,
      });
    }
    this.target = next;
    return true;
  }

  private showLens(): void {
    const viewport = this.viewportRef.current;
    const lens = this.lensRef.current;
    const targetScroll = this.pendingScroll;
    if (viewport === null || lens === null || targetScroll === null) return;
    const transform = liveLensTransform({
      size: { width: viewport.clientWidth, height: viewport.clientHeight },
      rendered: this.rendered,
      target: this.target,
      scroll: { left: viewport.scrollLeft, top: viewport.scrollTop },
      targetScroll,
    });
    if (transform === null) return;
    // Scale about the stage origin, whatever the artwork's letterbox offset.
    lens.style.transformOrigin = `${-lens.offsetLeft}px ${-lens.offsetTop}px`;
    lens.style.transform = `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`;
  }

  private applyPendingScroll(): void {
    const viewport = this.viewportRef.current;
    const target = this.pendingScroll;
    if (viewport === null || target === null) return;
    viewport.scrollLeft = target.left;
    viewport.scrollTop = target.top;
    this.pendingScroll = null;
  }
}

function clearLens(lens: HTMLDivElement | null): void {
  if (lens === null) return;
  lens.style.transform = '';
  lens.style.transformOrigin = '';
}

function anchoredScroll(
  viewport: HTMLDivElement,
  pending: ScrollPosition | null,
  anchor: ClientPoint | undefined,
  zoom: { readonly previous: number; readonly next: number },
): ScrollPosition {
  const from = pending ?? { left: viewport.scrollLeft, top: viewport.scrollTop };
  const width = viewport.clientWidth;
  const height = viewport.clientHeight;
  let x = width / 2;
  let y = height / 2;
  if (anchor !== undefined) {
    const rect = viewport.getBoundingClientRect();
    x = anchor.clientX - rect.left - viewport.clientLeft;
    y = anchor.clientY - rect.top - viewport.clientTop;
  }
  return {
    left: anchoredScrollOffset({ scroll: from.left, anchor: x, size: width, ...zoom }),
    top: anchoredScrollOffset({ scroll: from.top, anchor: y, size: height, ...zoom }),
  };
}
