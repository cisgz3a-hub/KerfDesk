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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Toolpath } from '../../core/job';
import type { Project } from '../../core/scene';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import { useCanvasColorScheme } from '../theme/use-canvas-color-scheme';
import { drawScene } from './draw-scene';
import { createDisplayPolylineCache, type DisplayPolylineCache } from './display-polylines';
import { DragOverlay, DragReadout, MeasureReadoutOverlay, ZoomControls } from './overlays';
import { useCanvasBitmapSize, type CanvasBitmapSize } from './use-canvas-bitmap-size';
import { usePreviewPlayback } from './use-preview-playback';
import { usePreviewToolpath } from './use-preview-toolpath';
import { useCncRemovalGridState } from './use-cnc-removal-grid';
import type { RemovalGrid } from '../../core/sim';
import { useDragMove } from './use-workspace-drag';
import { useWorkspaceWheelZoom } from './use-workspace-wheel';
import { usePreviewEstimate } from './use-preview-estimate';
import { useCanvasMotionOverlay } from './use-canvas-motion-overlay';
import { CanvasMotionBadge } from './canvas-motion-badge';
import { ArtworkNumberingPrompt } from './ArtworkNumberingPrompt';
import { WorkspacePointerOverlays } from './WorkspacePointerOverlays';
import { WorkspacePreviewDock } from './WorkspacePreviewDock';
import { TracePartsHint } from './TracePartsHint';
import { LaserTabHint } from './LaserTabHint';
import { ExtendShapesHint } from './ExtendShapesHint';
import { TrimShapesHint } from './TrimShapesHint';
import { TwoPointHint } from './TwoPointHint';
import { WarpDeformHint } from './WarpDeformHint';
import './workspace-preview.css';
import { WorkspaceCanvasLayers } from './WorkspaceCanvasLayers';
import { usePreviewBitmapRenderer } from './use-preview-bitmap-renderer';
import type { LaserTabEditor } from './laser-tab-editor';
import type { WarpDeformRequest } from '../state/warp-deform-session';
import { useCanvasDisplay } from './use-warp-deform-preview';
import { useLengthUnit } from '../state/display-units';
import { useCanvasMotion } from './canvas-motion';

export function Workspace(): JSX.Element {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const project = useStore((s) => s.project);
  const { selectedObjectId, selectedPathNode, selectedPathNodes, additionalSelectedIds } =
    useWorkspaceSelection();
  const previewMode = useStore((s) => s.previewMode);
  const routePreviewLabel = useStore(selectRoutePreviewLabel);
  const { scrubberT, showPreviewTravel } = useWorkspacePreviewState();
  const toolMode = useUiStore((s) => s.toolMode);
  const artworkRunFocus = useUiStore((s) => s.artworkRunFocus);
  const viewState = useViewState();
  const previewToolpath = usePreviewToolpath(project, previewMode);
  const canvasMotionOverlay = useCanvasMotionOverlay(project, previewMode);
  const jobEstimate = usePreviewEstimatePlayback(previewMode, previewToolpath);
  const cncRemoval = useCncRemovalGridState(project, previewMode, previewToolpath, scrubberT);
  const cncRemovalGrid = cncRemoval.grid;
  const canvasSize = useCanvasBitmapSize(ref);
  const previewBitmap = usePreviewBitmapRenderer(previewMode);
  const canvas = useCanvasDisplay(project, previewMode, selectedObjectId, additionalSelectedIds);
  const { warpDeformFailure, ...display } = canvas;
  const { handlers, dragKind } = useDragMove(ref, project, previewMode, viewState);
  useWorkspaceDraw({
    ref,
    ...display,
    selectedPathNode,
    selectedPathNodes,
    showPathNodeHandles: toolMode.kind === 'node',
    ...(toolMode.kind === 'cnc-tabs' ? { cncTabLayerColor: toolMode.layerColor } : {}),
    ...(toolMode.kind === 'laser-tabs' ? { laserTabEditor: toolMode } : {}),
    previewMode,
    previewToolpath,
    cncRemovalGrid,
    scrubberT,
    showPreviewTravel,
    viewState,
    canvasSize,
    previewBitmap,
    artworkRunFocus,
    dragging: dragKind !== null,
  });
  useWorkspaceWheelZoom(ref);
  useDropPenDraftOnProjectReplace(project);
  const dragOverlay = useUiStore((s) => s.dragOverlay);
  const pointerOverlayProps = { canvasRef: ref, canvasSize, dragging: dragKind !== null };
  return (
    <div className="lf-workspace-view">
      <div className="lf-workspace-stage">
        <WorkspaceCanvasLayers
          baseRef={ref}
          canvasSize={canvasSize}
          handlers={handlers}
          project={project}
          previewMode={previewMode}
          viewState={viewState}
          canvasMotionOverlay={canvasMotionOverlay}
        />
        {dragOverlay && <DragOverlay />}
        <WorkspaceInteractionOverlays
          canvasRef={ref}
          project={project}
          selectedObjectId={selectedObjectId}
          dragKind={dragKind}
          viewState={viewState}
        />
        <WorkspacePointerOverlays {...pointerOverlayProps} />
        <WorkspaceDesignChrome overlay={canvasMotionOverlay} warpFailure={warpDeformFailure} />
      </div>
      <WorkspacePreviewDock
        previewMode={previewMode}
        project={project}
        toolpath={previewToolpath}
        estimate={jobEstimate}
        routeLabel={routePreviewLabel}
        cncRemovalGrid={cncRemovalGrid}
        cncRemovalGridPending={cncRemoval.pending}
        rasterPending={previewBitmap.pending}
      />
    </div>
  );
}

function usePreviewEstimatePlayback(
  previewMode: boolean,
  previewToolpath: ReturnType<typeof usePreviewToolpath>,
): ReturnType<typeof usePreviewEstimate> {
  const jobEstimate = usePreviewEstimate();
  usePreviewPlayback(previewMode, previewToolpath, jobEstimate);
  return jobEstimate;
}

function useWorkspaceSelection() {
  const selectedObjectId = useStore((s) => s.selectedObjectId);
  const selectedPathNode = useStore((s) => s.selectedPathNode);
  const selectedPathNodes = useStore((s) => s.selectedPathNodes);
  const additionalSelectedIds = useStore((s) => s.additionalSelectedIds);
  return { selectedObjectId, selectedPathNode, selectedPathNodes, additionalSelectedIds };
}

function WorkspaceDesignChrome(props: {
  readonly overlay: ReturnType<typeof useCanvasMotionOverlay>;
  readonly warpFailure: string | null;
}): JSX.Element | null {
  const previewMode = useStore((s) => s.previewMode);
  if (previewMode) return null;
  return (
    <>
      <CanvasMotionBadge overlay={props.overlay} />
      <ArtworkNumberingPrompt />
      <TracePartsHint />
      <LaserTabHint />
      <TrimShapesHint />
      <TwoPointHint />
      <ExtendShapesHint />
      <WarpDeformHint failure={props.warpFailure} />
      <ZoomControls />
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

function useWorkspacePreviewState(): {
  readonly scrubberT: number;
  readonly showPreviewTravel: boolean;
} {
  const scrubberT = useUiStore((state) => state.scrubberT);
  const showPreviewTravel = useUiStore((state) => state.showPreviewTravel);
  return useMemo(() => ({ scrubberT, showPreviewTravel }), [scrubberT, showPreviewTravel]);
}

function useDropPenDraftOnProjectReplace(project: Project): void {
  useEffect(() => {
    if (useUiStore.getState().penDraft !== null) useUiStore.getState().setPenDraft(null);
  }, [project]);
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

type WorkspaceDrawArgs = {
  readonly ref: React.RefObject<HTMLCanvasElement | null>;
  readonly project: Project;
  readonly selectedObjectId: string | null;
  readonly selectedPathNode: ReturnType<typeof useStore.getState>['selectedPathNode'];
  readonly selectedPathNodes: ReturnType<typeof useStore.getState>['selectedPathNodes'];
  readonly showPathNodeHandles: boolean;
  readonly cncTabLayerColor?: string;
  readonly laserTabEditor?: LaserTabEditor;
  readonly warpDeformEditor?: WarpDeformRequest;
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
  readonly previewBitmap: ReturnType<typeof usePreviewBitmapRenderer>;
  readonly artworkRunFocus: ReturnType<typeof useUiStore.getState>['artworkRunFocus'];
  /** A move, scale or rotate drag is under way (ADR-346 Amendment 1). */
  readonly dragging: boolean;
};

type WorkspaceOverlayState = ReturnType<typeof useWorkspaceOverlayState>;

function useWorkspaceOverlayState() {
  // Phase G (B5): the live shape being dragged out, rendered as a dashed
  // preview. Identity changes each mouse-move, so it belongs in the draw deps.
  const draftShape = useUiStore((s) => s.draftShape);
  const selectionMarquee = useUiStore((s) => s.selectionMarquee);
  const snapGuides = useUiStore((s) => s.snapGuides);
  const snapMarker = useUiStore((s) => s.snapMarker);
  const gridMm = useUiStore((s) => s.snapSettings.gridMm);
  const measureDraft = useUiStore((s) => s.measureDraft);
  // Phase G (B6): the pen tool's in-progress polyline (also redraws per click /
  // cursor move).
  const penDraft = useUiStore((s) => s.penDraft);
  const wireframe = useUiStore((s) => s.wireframeView);
  const operationColors = useUiStore((s) => s.operationColorPeek);
  const lengthUnit = useLengthUnit();
  return {
    draftShape,
    selectionMarquee,
    snapGuides,
    snapMarker,
    gridMm,
    measureDraft,
    penDraft,
    wireframe,
    operationColors,
    lengthUnit,
  };
}

function useWorkspaceDraw(args: WorkspaceDrawArgs): void {
  const overlay = useWorkspaceOverlayState();
  const [rasterRedrawTick, setRasterRedrawTick] = useState(0);
  const colorScheme = useCanvasColorScheme();
  const previewBackgroundKey = useMemo(
    () => [args.project, args.cncRemovalGrid, rasterRedrawTick, colorScheme],
    [args.project, args.cncRemovalGrid, rasterRedrawTick, colorScheme],
  );
  const displayPolylineCache = useDisplayPolylineCache();
  const motion = useCanvasMotion();
  const requestRasterRedraw = useCallback(() => {
    setRasterRedrawTick((tick) => tick + 1);
  }, []);
  useEffect(() => {
    const canvas = args.ref.current;
    if (canvas === null) return;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;
    const drag = args.dragging || overlay.selectionMarquee !== null;
    const viewMoving = motion.nextFrame(
      args.viewState,
      drag,
      args.project,
      overlay.selectionMarquee,
    );
    drawWorkspaceScene(ctx, canvas, args, {
      requestRasterRedraw,
      previewBackgroundKey,
      displayPolylineCache,
      ...overlay,
      viewMoving,
    });
    // "still" once the settled frame after a pan or zoom has been drawn.
    canvas.dataset['viewMotion'] = viewMoving ? 'moving' : 'still';
    // `args` is recreated by Workspace; its consumed fields are listed below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    args.ref,
    args.project,
    args.selectedObjectId,
    args.selectedPathNode,
    args.selectedPathNodes,
    args.showPathNodeHandles,
    args.cncTabLayerColor,
    args.laserTabEditor,
    args.warpDeformEditor,
    args.additionalSelectedIds,
    args.previewMode,
    args.scrubberT,
    args.showPreviewTravel,
    args.viewState,
    args.canvasSize,
    args.previewBitmap.drawRoute,
    args.previewBitmap.revision,
    args.artworkRunFocus,
    overlay.measureDraft,
    rasterRedrawTick,
    previewBackgroundKey,
    displayPolylineCache,
    args.previewToolpath,
    args.cncRemovalGrid,
    requestRasterRedraw,
    overlay.draftShape,
    overlay.penDraft,
    overlay.selectionMarquee,
    overlay.snapGuides,
    overlay.snapMarker,
    overlay.gridMm,
    overlay.wireframe,
    overlay.operationColors,
    overlay.lengthUnit,
    motion.settledTick,
  ]);
}

function drawWorkspaceScene(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  args: Parameters<typeof useWorkspaceDraw>[0],
  state: WorkspaceOverlayState & {
    readonly requestRasterRedraw: () => void;
    readonly previewBackgroundKey: object;
    readonly displayPolylineCache: DisplayPolylineCache;
    readonly viewMoving: boolean;
  },
): void {
  drawScene(ctx, canvas.width, canvas.height, args.project, {
    selectedId: args.selectedObjectId,
    showPathNodeHandles: args.showPathNodeHandles,
    selectedPathNode: args.selectedPathNode,
    selectedPathNodes: args.selectedPathNodes,
    additionalSelectedIds: args.additionalSelectedIds,
    preview: args.previewMode,
    scrubberT: args.scrubberT,
    previewShowTravel: args.showPreviewTravel,
    previewRouteRenderer: args.previewBitmap.drawRoute,
    previewBackgroundKey: state.previewBackgroundKey,
    view: args.viewState,
    onRasterBitmapReady: state.requestRasterRedraw,
    displayPolylineCache: state.displayPolylineCache,
    ...(args.previewToolpath === null ? {} : { previewToolpath: args.previewToolpath }),
    cncRemovalGrid: args.cncRemovalGrid,
    ...(state.draftShape === null ? {} : { draft: state.draftShape }),
    ...(state.penDraft === null ? {} : { penDraft: state.penDraft }),
    ...(state.selectionMarquee === null ? {} : { selectionMarquee: state.selectionMarquee }),
    ...(state.measureDraft === null ? {} : { measureDraft: state.measureDraft }),
    ...(state.snapGuides.length === 0 ? {} : { snapGuides: state.snapGuides }),
    ...(state.snapMarker === null ? {} : { snapMarker: state.snapMarker }),
    gridMm: state.gridMm,
    ...(args.cncTabLayerColor === undefined ? {} : { cncTabLayerColor: args.cncTabLayerColor }),
    ...(args.laserTabEditor === undefined ? {} : { laserTabEditor: args.laserTabEditor }),
    ...(args.warpDeformEditor === undefined ? {} : { warpDeformEditor: args.warpDeformEditor }),
    ...(args.artworkRunFocus === null ? {} : { artworkRunFocus: args.artworkRunFocus }),
    wireframe: state.wireframe,
    operationColors: state.operationColors,
    lengthUnit: state.lengthUnit,
    viewMoving: state.viewMoving,
  });
  // Startup reveals the editor after a successful artwork/chrome paint, not
  // merely after React has inserted an empty canvas element.
  canvas.dataset.workspacePainted = 'true';
}

function useDisplayPolylineCache(): DisplayPolylineCache {
  const cacheRef = useRef<DisplayPolylineCache | null>(null);
  if (cacheRef.current === null) cacheRef.current = createDisplayPolylineCache();
  return cacheRef.current;
}
