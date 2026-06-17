// Workspace — Canvas2D viewport React component. Renders bed, grid, scene
// polylines, optional preview overlay (F-A8), selection outline + corner
// handles (F-A5/F-A6). Mouse: click-and-drag a handle to scale (corner
// handles keep aspect; Shift allows stretch; Ctrl/Cmd scales from center),
// click-and-drag the body to move,
// drag the rotate handle to rotate (Shift snaps to 15°), Space-drag pans
// the viewport. Wheel+Ctrl zooms. Shift+click on objects toggles into the
// multi-select set.
//
// Drawing helpers live in `draw-scene.ts`; viewport math in
// `view-transform.ts`; the drag state machine in `drag-state.ts`; the
// HTML overlays (drop hint, preview scrubber, etc.) in `overlays.tsx`.

import { canvasTheme } from '../theme/canvas-theme';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type Toolpath } from '../../core/job';
import type { Project } from '../../core/scene';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import { drawScene } from './draw-scene';
import { createDisplayPolylineCache, type DisplayPolylineCache } from './display-polylines';
import { finishPen } from './pen-tool';
import { DragOverlay, DragReadout, EmptyHint, PreviewScrubber, ZoomControls } from './overlays';
import { PreviewStatsPanel, PreviewStatusOverlays } from './preview-overlays';
import { useCanvasBitmapSize, type CanvasBitmapSize } from './use-canvas-bitmap-size';
import { usePreviewToolpath } from './use-preview-toolpath';
import { useDragMove } from './use-workspace-drag';
import { clientToCanvasPx, zoomAtCursorPx } from './view-transform';
import { useJobEstimate } from '../laser/use-job-estimate';

export function Workspace(): JSX.Element {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const project = useStore((s) => s.project);
  const selectedObjectId = useStore((s) => s.selectedObjectId);
  const additionalSelectedIds = useStore((s) => s.additionalSelectedIds);
  const previewMode = useStore((s) => s.previewMode);
  const scrubberT = useUiStore((s) => s.scrubberT);
  const showPreviewTravel = useUiStore((s) => s.showPreviewTravel);
  // Three primitive selectors — Zustand only re-runs the effect when one
  // of them actually changes. A bundled `{...}` selector would create a
  // fresh object every store update and force unnecessary redraws.
  const zoomFactor = useUiStore((s) => s.zoomFactor);
  const panX = useUiStore((s) => s.panX);
  const panY = useUiStore((s) => s.panY);
  const viewState = useMemo(() => ({ zoomFactor, panX, panY }), [zoomFactor, panX, panY]);
  const previewToolpath = usePreviewToolpath(project, previewMode);
  const jobEstimate = useJobEstimate();
  const canvasSize = useCanvasBitmapSize(ref);
  useWorkspaceDraw({
    ref,
    project,
    selectedObjectId,
    additionalSelectedIds,
    previewMode,
    previewToolpath,
    scrubberT,
    showPreviewTravel,
    viewState,
    canvasSize,
  });

  const { handlers, dragKind } = useDragMove(ref, project, previewMode, viewState);
  // Phase G (B6) — drop a half-drawn pen polyline when the project is replaced
  // wholesale (New / Open / undo / redo); otherwise it renders as a ghost over an
  // unrelated scene. Guarded so the per-frame project churn of a transform drag
  // (penDraft already null) doesn't touch the store.
  useEffect(() => {
    if (useUiStore.getState().penDraft !== null) useUiStore.getState().setPenDraft(null);
  }, [project]);
  const isEmpty = project.scene.objects.length === 0;
  const dragOverlay = useUiStore((s) => s.dragOverlay);
  return (
    <>
      <canvas
        ref={ref}
        width={canvasSize.width}
        height={canvasSize.height}
        onMouseDown={handlers.onMouseDown}
        onMouseMove={handlers.onMouseMove}
        onMouseUp={handlers.onMouseUp}
        onMouseLeave={handlers.onMouseUp}
        onDoubleClick={handleCanvasDoubleClick}
        onWheel={(e) => handleCanvasWheel(e, ref.current, project, { zoomFactor, panX, panY })}
        onContextMenu={(e) => {
          // Right-click is rebound to pan; suppress the OS context
          // menu so a right-drag doesn't pop up the menu on release.
          e.preventDefault();
        }}
        style={canvasStyle}
        aria-label="LaserForge workspace"
      />
      {isEmpty && !dragOverlay && <EmptyHint />}
      {dragOverlay && <DragOverlay />}
      {dragKind !== null && (
        <DragReadout
          canvasRef={ref}
          project={project}
          selectedId={selectedObjectId}
          kind={dragKind}
          viewState={viewState}
        />
      )}
      {previewMode && previewToolpath !== null && (
        <>
          <PreviewStatusOverlays project={project} toolpath={previewToolpath} />
          <PreviewStatsPanel toolpath={previewToolpath} estimate={jobEstimate} />
        </>
      )}
      {previewMode && <PreviewScrubber />}
      {/* Bottom-right zoom controls — hidden during preview so the
          scrubber gets the whole bottom strip. */}
      {!previewMode && <ZoomControls />}
    </>
  );
}

function useWorkspaceDraw(args: {
  readonly ref: React.RefObject<HTMLCanvasElement | null>;
  readonly project: Project;
  readonly selectedObjectId: string | null;
  readonly additionalSelectedIds: ReadonlySet<string>;
  readonly previewMode: boolean;
  readonly previewToolpath: Toolpath | null;
  readonly scrubberT: number;
  readonly showPreviewTravel: boolean;
  readonly viewState: { readonly zoomFactor: number; readonly panX: number; readonly panY: number };
  // Not read directly — the draw effect reads canvas.width/height — but a
  // bitmap resize clears the canvas, so the effect must re-run on it.
  readonly canvasSize: CanvasBitmapSize;
}): void {
  const {
    ref,
    project,
    selectedObjectId,
    additionalSelectedIds,
    previewMode,
    previewToolpath,
    scrubberT,
    showPreviewTravel,
    viewState,
    canvasSize,
  } = args;
  // Phase G (B5): the live shape being dragged out, rendered as a dashed
  // preview. Identity changes each mouse-move, so it belongs in the deps below.
  const draftShape = useUiStore((s) => s.draftShape);
  const selectionMarquee = useUiStore((s) => s.selectionMarquee);
  // Phase G (B6): the pen tool's in-progress polyline (also redraws per click /
  // cursor move).
  const penDraft = useUiStore((s) => s.penDraft);
  const [rasterRedrawTick, setRasterRedrawTick] = useState(0);
  const displayPolylineCacheRef = useRef<DisplayPolylineCache | null>(null);
  if (displayPolylineCacheRef.current === null) {
    displayPolylineCacheRef.current = createDisplayPolylineCache();
  }
  const displayPolylineCache = displayPolylineCacheRef.current;
  const requestRasterRedraw = useCallback(() => {
    setRasterRedrawTick((tick) => tick + 1);
  }, []);
  useEffect(() => {
    const canvas = ref.current;
    if (canvas === null) return;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;
    drawScene(ctx, canvas.width, canvas.height, project, {
      selectedId: selectedObjectId,
      additionalSelectedIds,
      preview: previewMode,
      scrubberT,
      previewShowTravel: showPreviewTravel,
      view: viewState,
      onRasterBitmapReady: requestRasterRedraw,
      displayPolylineCache,
      ...(previewToolpath === null ? {} : { previewToolpath }),
      ...(draftShape === null ? {} : { draft: draftShape }),
      ...(penDraft === null ? {} : { penDraft }),
      ...(selectionMarquee === null ? {} : { selectionMarquee }),
    });
  }, [
    ref,
    project,
    selectedObjectId,
    additionalSelectedIds,
    previewMode,
    scrubberT,
    showPreviewTravel,
    viewState,
    canvasSize,
    rasterRedrawTick,
    displayPolylineCache,
    previewToolpath,
    requestRasterRedraw,
    draftShape,
    penDraft,
    selectionMarquee,
  ]);
}

// Wheel-to-zoom anchored at the cursor. Three wheel sources fire
// here: plain mouse-wheel, Ctrl+wheel (mouse), and trackpad pinch
// (browsers convert pinch into a wheel event with ctrlKey true). All
// three zoom at the cursor — the bed-center-anchored zoomBy felt
// unmoored when the user's attention was in a corner.
//
// Module-level so the Workspace function stays under the line cap and
// the prop reference is stable across renders.
function handleCanvasWheel(
  e: React.WheelEvent<HTMLCanvasElement>,
  canvas: HTMLCanvasElement | null,
  project: Project,
  view: { readonly zoomFactor: number; readonly panX: number; readonly panY: number },
): void {
  e.preventDefault();
  if (canvas === null) return;
  const cursorPx = clientToCanvasPx(e, canvas);
  if (cursorPx === null) return;
  const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
  const next = zoomAtCursorPx({
    cursorPx,
    factor,
    canvas: { width: canvas.width, height: canvas.height },
    bed: { width: project.device.bedWidth, height: project.device.bedHeight },
    view,
  });
  useUiStore.getState().setZoom(next.zoomFactor);
  useUiStore.getState().setPan(next.panX, next.panY);
}

// Phase G (B6) — in pen mode a double-click finishes the in-progress polyline
// as an OPEN path; otherwise it falls through to the Phase D text-edit. Module-
// level so the canvas onDoubleClick prop reference stays stable.
function handleCanvasDoubleClick(): void {
  const ui = useUiStore.getState();
  if (ui.toolMode.kind === 'draw' && ui.toolMode.shape === 'polyline') {
    const s = useStore.getState();
    // Gated on !previewMode so a stray dblclick can't commit into a previewed
    // scene; the draft is preserved across a preview toggle either way.
    if (ui.penDraft !== null && !s.previewMode) {
      finishPen({ closed: false, project: s.project, drawShape: s.drawShape });
    }
    return; // in pen mode, never open the text editor
  }
  openTextEditForSelectedText();
}

// Phase D — double-click on a selected text opens the edit dialog
// with its current values pre-populated. Non-text objects are a
// no-op (a future "rename / properties" dialog could land here).
// Module-level so the canvas onDoubleClick prop reference is stable
// and the parent Workspace function stays under the line cap.
function openTextEditForSelectedText(): void {
  const s = useStore.getState();
  const id = s.selectedObjectId;
  if (id === null) return;
  const obj = s.project.scene.objects.find((o) => o.id === id);
  if (obj === undefined || obj.kind !== 'text') return;
  useUiStore.getState().openTextDialog({
    mode: 'edit',
    id: obj.id,
    content: obj.content,
    fontKey: obj.fontKey,
    sizeMm: obj.sizeMm,
    alignment: obj.alignment,
    lineHeight: obj.lineHeight,
    letterSpacing: obj.letterSpacing,
    color: obj.color,
  });
}

const canvasStyle: React.CSSProperties = {
  display: 'block',
  background: canvasTheme.viewportSurround,
  width: '100%',
  height: '100%',
  // Block browser-default touch handling so trackpad gestures and
  // mobile pinch-zoom reach our wheel handler instead of zooming the
  // whole page or scrolling under our feet.
  touchAction: 'none',
};
