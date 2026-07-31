// DesignCanvas — the Design Studio drawing surface (ADR-272, DS-2/DS-3).
//
// Smoothness is structural, not incidental. Four things do the work:
//  1. TWO stacked canvases on two cadences. The static layer (bed, grid,
//     committed geometry) repaints only when the sketch, view or selection
//     changes; the overlay (live draft, dimension label, marquee) repaints per
//     pointer move. Moving the mouse never re-strokes the drawing.
//  2. Every repaint is coalesced into ONE requestAnimationFrame, so a burst of
//     pointer moves cannot queue a burst of repaints.
//  3. Both bitmaps are sized in device pixels and the contexts scaled once, so
//     the drawing is crisp on HiDPI without the paint code knowing about it.
//  4. Wheel zoom is anchored on the cursor, so the millimetre under the pointer
//     stays under the pointer — the single thing that makes a CAD canvas feel
//     attached to the hand rather than sliding around.

import { useCallback, useEffect, useRef } from 'react';
import { findEntity, type SketchEntity } from '../../core/design';
import { useStore } from '../state';
import { entityFields, type EntityField } from './design-entity-fields';
import type { DesignSession as DesignStudioSession } from './design-session';
import { paintDesignCanvas } from './design-canvas-draw';
import { createFrameScheduler, frameSchedulerHostFor } from './design-frame-scheduler';
import { paintDesignOverlay } from './design-overlay-draw';
import { ShapeInspector } from './ShapeInspector';
import { useDesignStudioStore } from './design-studio-store';
import { useDesignPointer } from './use-design-pointer';
import { fitView, zoomAt } from './design-view';

const ZOOM_PER_WHEEL_NOTCH = 1.0015;

export function DesignCanvas(): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const staticRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const workspace = useStore((state) => state.project.workspace);
  const entityCount = useDesignStudioStore(
    (state) => state.session?.history.present.entities.length ?? 0,
  );
  const setView = useDesignStudioStore((state) => state.setView);

  useFrameOnOpen(hostRef, workspace.width, workspace.height);
  useLayerPaint(staticRef, overlayRef, hostRef, workspace.width, workspace.height);
  const pointer = useDesignPointer(overlayRef, newEntityId);

  const handleWheel = useCallback(
    (event: React.WheelEvent<HTMLCanvasElement>) => {
      const view = useDesignStudioStore.getState().session?.view;
      const rect = overlayRef.current?.getBoundingClientRect();
      if (view == null || rect === undefined) return;
      const anchor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      setView(zoomAt(view, anchor, ZOOM_PER_WHEEL_NOTCH ** -event.deltaY));
    },
    [setView],
  );

  return (
    <div ref={hostRef} style={hostStyle}>
      <canvas ref={staticRef} style={staticStyle} aria-hidden="true" />
      <canvas
        ref={overlayRef}
        style={overlayStyle}
        aria-label={`Design canvas, ${entityCount} entities`}
        onPointerDown={pointer.onPointerDown}
        onPointerMove={pointer.onPointerMove}
        onPointerUp={pointer.onPointerUp}
        onPointerLeave={pointer.onPointerLeave}
        onWheel={handleWheel}
      />
      <ShapeInspector />
    </div>
  );
}

// Resolves the single selected entity and the field the inspector is touching, so
// the overlay can call out exactly that dimension. Returns nulls whenever there is
// nothing to annotate, which is the common case.
function measuredSelection(session: NonNullable<DesignStudioSession>): {
  readonly entity: SketchEntity | null;
  readonly field: EntityField | null;
} {
  const key = session.activeMeasurement;
  if (key === null || session.selectedIds.size !== 1) return { entity: null, field: null };
  const id = [...session.selectedIds][0];
  const entity = id === undefined ? null : findEntity(session.history.present, id);
  if (entity === null) return { entity: null, field: null };
  const field = entityFields(entity).find((candidate) => candidate.key === key) ?? null;
  return { entity, field };
}

// crypto.randomUUID is a UI concern: pure core may not generate identity, so the
// canvas mints the id and hands it to the store (the draw-tool.ts precedent).
function newEntityId(): string {
  return crypto.randomUUID();
}

// Frames the bed the first time the canvas has a measured size. Runs once per
// session: reopening a stashed session keeps the operator's own view.
function useFrameOnOpen(
  hostRef: React.RefObject<HTMLDivElement | null>,
  bedWidthMm: number,
  bedHeightMm: number,
): void {
  const hasView = useDesignStudioStore((state) => state.session?.view != null);
  const setView = useDesignStudioStore((state) => state.setView);
  useEffect(() => {
    if (hasView) return;
    const host = hostRef.current;
    if (host === null) return;
    const { width, height } = host.getBoundingClientRect();
    if (width <= 0 || height <= 0) return;
    setView(
      fitView({
        widthMm: bedWidthMm,
        heightMm: bedHeightMm,
        originXmm: 0,
        originYmm: 0,
        viewportWidthPx: width,
        viewportHeightPx: height,
      }),
    );
  }, [hasView, hostRef, bedWidthMm, bedHeightMm, setView]);
}

// Sizes and paints BOTH layers from one rAF-coalesced pass. Subscribing to the
// store imperatively (rather than through a selector) keeps a pointer-driven
// draft update from re-rendering React at all — the store change goes straight to
// a repaint.
function useLayerPaint(
  staticRef: React.RefObject<HTMLCanvasElement | null>,
  overlayRef: React.RefObject<HTMLCanvasElement | null>,
  hostRef: React.RefObject<HTMLDivElement | null>,
  bedWidthMm: number,
  bedHeightMm: number,
): void {
  useEffect(() => {
    const host = hostRef.current;
    const staticCanvas = staticRef.current;
    const overlayCanvas = overlayRef.current;
    // Both layers are addressed by their own ref. An earlier version found the
    // overlay via staticCanvas.nextElementSibling, which silently coupled painting
    // to DOM child order inside the host — adding any third child could break it.
    if (host === null || staticCanvas === null || overlayCanvas === null) return undefined;

    const paint = (): void => {
      const session = useDesignStudioStore.getState().session;
      if (session?.view == null) return;
      const rect = host.getBoundingClientRect();
      const widthPx = Math.max(1, Math.round(rect.width));
      const heightPx = Math.max(1, Math.round(rect.height));
      const ratio = host.ownerDocument.defaultView?.devicePixelRatio ?? 1;
      const staticCtx = sizedContext(staticCanvas, widthPx, heightPx, ratio);
      const overlayCtx = sizedContext(overlayCanvas, widthPx, heightPx, ratio);
      if (staticCtx === null || overlayCtx === null) return;
      paintDesignCanvas(staticCtx, {
        view: session.view,
        sketch: session.history.present,
        selectedIds: session.selectedIds,
        bedWidthMm,
        bedHeightMm,
        showGrid: session.showGrid,
        gridMm: session.gridMm,
        widthPx,
        heightPx,
      });
      const measured = measuredSelection(session);
      paintDesignOverlay(overlayCtx, {
        view: session.view,
        draft: session.draft,
        marquee: session.marquee,
        measuredEntity: measured.entity,
        measuredField: measured.field,
        snap: session.activeSnap,
        widthPx,
        heightPx,
      });
    };

    const scheduler = createFrameScheduler(
      paint,
      frameSchedulerHostFor(host.ownerDocument.defaultView),
    );
    const unsubscribe = useDesignStudioStore.subscribe(scheduler.request);
    const observer = new ResizeObserver(scheduler.request);
    observer.observe(host);
    // The FIRST paint runs immediately rather than on a frame: a hidden or
    // throttled page does not run frame callbacks at all, and the canvas must not
    // be blank while that is true.
    scheduler.flush();
    // Coming back into view is the other moment a frame is owed but may never have
    // arrived, so repaint outright rather than trusting the pending request.
    const onVisible = (): void => {
      if (!host.ownerDocument.hidden) scheduler.flush();
    };
    host.ownerDocument.addEventListener('visibilitychange', onVisible);
    return () => {
      unsubscribe();
      observer.disconnect();
      host.ownerDocument.removeEventListener('visibilitychange', onVisible);
      scheduler.cancel();
    };
  }, [staticRef, overlayRef, hostRef, bedWidthMm, bedHeightMm]);
}

function sizedContext(
  canvas: HTMLCanvasElement,
  widthPx: number,
  heightPx: number,
  ratio: number,
): CanvasRenderingContext2D | null {
  const ctx = canvas.getContext('2d');
  if (ctx === null) return null;
  if (canvas.width !== widthPx * ratio || canvas.height !== heightPx * ratio) {
    canvas.width = widthPx * ratio;
    canvas.height = heightPx * ratio;
  }
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  return ctx;
}

const hostStyle: React.CSSProperties = {
  position: 'relative',
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  overflow: 'hidden',
};

const layerStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'block',
  width: '100%',
  height: '100%',
};

const staticStyle: React.CSSProperties = { ...layerStyle, pointerEvents: 'none' };

// Only the top layer receives pointer events, so there is one gesture target.
const overlayStyle: React.CSSProperties = {
  ...layerStyle,
  touchAction: 'none',
  cursor: 'crosshair',
};
