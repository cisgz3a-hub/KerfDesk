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
import { APP_DISPLAY_NAME } from '../../core/app-branding';
import type { Project } from '../../core/scene';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import { drawScene } from './draw-scene';
import { createDisplayPolylineCache, type DisplayPolylineCache } from './display-polylines';
import { finishPen } from './pen-tool';
import {
  DragOverlay,
  DragReadout,
  EmptyHint,
  MeasureReadoutOverlay,
  PreviewScrubber,
  ZoomControls,
} from './overlays';
import { PreviewControlsPanel, PreviewStatusOverlays } from './preview-overlays';
import { Cut3DPreviewDialog } from '../relief-viewer';
import { useCanvasBitmapSize, type CanvasBitmapSize } from './use-canvas-bitmap-size';
import { usePreviewPlayback } from './use-preview-playback';
import { usePreviewToolpath } from './use-preview-toolpath';
import { useCncRemovalGrid } from './use-cnc-removal-grid';
import type { RemovalGrid } from '../../core/sim';
import { finishDrawToolOnLeftDoubleClick } from './finish-draw-tool';
import { useDragMove } from './use-workspace-drag';
import { clientToCanvasPx, zoomAtCursorPx } from './view-transform';
import { useJobEstimate } from '../laser/use-job-estimate';

export function Workspace(): JSX.Element {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const project = useStore((s) => s.project);
  const selectedObjectId = useStore((s) => s.selectedObjectId);
  const selectedPathNode = useStore((s) => s.selectedPathNode);
  const selectedPathNodes = useStore((s) => s.selectedPathNodes);
  const additionalSelectedIds = useStore((s) => s.additionalSelectedIds);
  const previewMode = useStore((s) => s.previewMode);
  const routePreviewLabel = useStore(selectRoutePreviewLabel);
  const scrubberT = useUiStore((s) => s.scrubberT);
  const showPreviewTravel = useUiStore((s) => s.showPreviewTravel);
  const toolMode = useUiStore((s) => s.toolMode);
  const viewState = useViewState();
  const { zoomFactor, panX, panY } = viewState;
  const previewToolpath = usePreviewToolpath(project, previewMode);
  usePreviewPlayback(previewMode, previewToolpath);
  const cncRemovalGrid = useCncRemovalGrid(project, previewMode, previewToolpath, scrubberT);
  const jobEstimate = useJobEstimate();
  const canvasSize = useCanvasBitmapSize(ref);
  useWorkspaceDraw({
    ref,
    project,
    selectedObjectId,
    selectedPathNode,
    selectedPathNodes,
    showPathNodeHandles: toolMode.kind === 'node',
    additionalSelectedIds,
    previewMode,
    previewToolpath,
    cncRemovalGrid,
    scrubberT,
    showPreviewTravel,
    viewState,
    canvasSize,
  });

  const { handlers, dragKind } = useDragMove(ref, project, previewMode, viewState);
  useDropPenDraftOnProjectReplace(project);
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
        onWheel={(e) => onCanvasWheel(e, ref.current, project, { zoomFactor, panX, panY })}
        onContextMenu={suppressCanvasContextMenu}
        style={canvasStyle}
        aria-label={`${APP_DISPLAY_NAME} workspace`}
      />
      {project.scene.objects.length === 0 && !dragOverlay && <EmptyHint />}
      {dragOverlay && <DragOverlay />}
      <WorkspaceInteractionOverlays
        canvasRef={ref}
        project={project}
        selectedObjectId={selectedObjectId}
        dragKind={dragKind}
        viewState={viewState}
      />
      <WorkspacePreviewOverlays
        previewMode={previewMode}
        project={project}
        toolpath={previewToolpath}
        estimate={jobEstimate}
        routeLabel={routePreviewLabel}
        cncRemovalGrid={cncRemovalGrid}
      />
      {previewMode && <PreviewScrubber />}
      {/* Bottom-right zoom controls — hidden during preview so the
          scrubber gets the whole bottom strip. */}
      {!previewMode && <ZoomControls />}
    </>
  );
}

// Three primitive selectors — Zustand only re-runs the effect when one of
// them actually changes. A bundled `{...}` selector would create a fresh
// object every store update and force unnecessary redraws.
function useViewState(): {
  readonly zoomFactor: number;
  readonly panX: number;
  readonly panY: number;
} {
  const zoomFactor = useUiStore((s) => s.zoomFactor);
  const panX = useUiStore((s) => s.panX);
  const panY = useUiStore((s) => s.panY);
  return useMemo(() => ({ zoomFactor, panX, panY }), [zoomFactor, panX, panY]);
}

function selectRoutePreviewLabel(state: ReturnType<typeof useStore.getState>): string {
  return state.outputScopeSettings.cutSelectedGraphics ? 'Selected output' : 'Whole project';
}

function useDropPenDraftOnProjectReplace(project: Project): void {
  useEffect(() => {
    if (useUiStore.getState().penDraft !== null) useUiStore.getState().setPenDraft(null);
  }, [project]);
}

function suppressCanvasContextMenu(e: React.MouseEvent<HTMLCanvasElement>): void {
  e.preventDefault();
}

function onCanvasWheel(
  e: React.WheelEvent<HTMLCanvasElement>,
  canvas: HTMLCanvasElement | null,
  project: Project,
  viewState: { readonly zoomFactor: number; readonly panX: number; readonly panY: number },
): void {
  useUiStore.getState().closeWorkspaceContextBar();
  handleCanvasWheel(e, canvas, project, viewState);
}

function WorkspacePreviewOverlays(props: {
  readonly previewMode: boolean;
  readonly project: Project;
  readonly toolpath: Toolpath | null;
  readonly estimate: ReturnType<typeof useJobEstimate>;
  readonly routeLabel: string;
  readonly cncRemovalGrid: RemovalGrid | null;
}): JSX.Element | null {
  const [cut3DOpen, setCut3DOpen] = useState(false);
  if (!props.previewMode || props.toolpath === null) return null;
  const grid = props.cncRemovalGrid;
  const machine = props.project.machine;
  const stockThicknessMm = machine?.kind === 'cnc' ? machine.stock.thicknessMm : 0;
  return (
    <>
      <PreviewStatusOverlays project={props.project} toolpath={props.toolpath} />
      <PreviewControlsPanel
        toolpath={props.toolpath}
        estimate={props.estimate}
        routeLabel={props.routeLabel}
        disabled={props.toolpath.totalLength <= 0}
        {...(grid !== null ? { onOpen3D: () => setCut3DOpen(true) } : {})}
      />
      {cut3DOpen && grid !== null ? (
        <Cut3DPreviewDialog
          grid={grid}
          stockThicknessMm={stockThicknessMm}
          onClose={() => setCut3DOpen(false)}
        />
      ) : null}
    </>
  );
}

function WorkspaceInteractionOverlays(props: {
  readonly canvasRef: React.RefObject<HTMLCanvasElement | null>;
  readonly project: Project;
  readonly selectedObjectId: string | null;
  readonly dragKind: ReturnType<typeof useDragMove>['dragKind'];
  readonly viewState: { readonly zoomFactor: number; readonly panX: number; readonly panY: number };
}): JSX.Element {
  return (
    <>
      {props.dragKind !== null && (
        <DragReadout
          canvasRef={props.canvasRef}
          project={props.project}
          selectedId={props.selectedObjectId}
          kind={props.dragKind}
          viewState={props.viewState}
        />
      )}
      <MeasureReadoutOverlay
        canvasRef={props.canvasRef}
        project={props.project}
        viewState={props.viewState}
      />
    </>
  );
}

function useWorkspaceDraw(args: {
  readonly ref: React.RefObject<HTMLCanvasElement | null>;
  readonly project: Project;
  readonly selectedObjectId: string | null;
  readonly selectedPathNode: ReturnType<typeof useStore.getState>['selectedPathNode'];
  readonly selectedPathNodes: ReturnType<typeof useStore.getState>['selectedPathNodes'];
  readonly showPathNodeHandles: boolean;
  readonly additionalSelectedIds: ReadonlySet<string>;
  readonly previewMode: boolean;
  readonly previewToolpath: Toolpath | null;
  readonly cncRemovalGrid: RemovalGrid | null;
  readonly scrubberT: number;
  readonly showPreviewTravel: boolean;
  readonly viewState: { readonly zoomFactor: number; readonly panX: number; readonly panY: number };
  // Not read directly — the draw effect reads canvas.width/height — but a
  // bitmap resize clears the canvas, so the effect must re-run on it.
  readonly canvasSize: CanvasBitmapSize;
}): void {
  // Phase G (B5): the live shape being dragged out, rendered as a dashed
  // preview. Identity changes each mouse-move, so it belongs in the deps below.
  const draftShape = useUiStore((s) => s.draftShape);
  const selectionMarquee = useUiStore((s) => s.selectionMarquee);
  const snapGuides = useUiStore((s) => s.snapGuides);
  const measureDraft = useUiStore((s) => s.measureDraft);
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
    const canvas = args.ref.current;
    if (canvas === null) return;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;
    drawScene(ctx, canvas.width, canvas.height, args.project, {
      selectedId: args.selectedObjectId,
      showPathNodeHandles: args.showPathNodeHandles,
      selectedPathNode: args.selectedPathNode,
      selectedPathNodes: args.selectedPathNodes,
      additionalSelectedIds: args.additionalSelectedIds,
      preview: args.previewMode,
      scrubberT: args.scrubberT,
      previewShowTravel: args.showPreviewTravel,
      view: args.viewState,
      onRasterBitmapReady: requestRasterRedraw,
      displayPolylineCache,
      ...(args.previewToolpath === null ? {} : { previewToolpath: args.previewToolpath }),
      cncRemovalGrid: args.cncRemovalGrid,
      ...(draftShape === null ? {} : { draft: draftShape }),
      ...(penDraft === null ? {} : { penDraft }),
      ...(selectionMarquee === null ? {} : { selectionMarquee }),
      ...(measureDraft === null ? {} : { measureDraft }),
      ...(snapGuides.length === 0 ? {} : { snapGuides }),
    });
  }, [
    args.ref,
    args.project,
    args.selectedObjectId,
    args.selectedPathNode,
    args.selectedPathNodes,
    args.showPathNodeHandles,
    args.additionalSelectedIds,
    args.previewMode,
    args.scrubberT,
    args.showPreviewTravel,
    args.viewState,
    args.canvasSize,
    measureDraft,
    rasterRedrawTick,
    displayPolylineCache,
    args.previewToolpath,
    args.cncRemovalGrid,
    requestRasterRedraw,
    draftShape,
    penDraft,
    selectionMarquee,
    snapGuides,
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

// Phase G (B6) — double-click exits sticky shape tools; in pen mode it finishes
// the in-progress polyline as an OPEN path. Otherwise it falls through to the
// Phase D text-edit. Module-level so the canvas prop reference stays stable.
function handleCanvasDoubleClick(e: React.MouseEvent<HTMLCanvasElement>): void {
  if (finishDrawToolOnLeftDoubleClick(e)) return;
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
