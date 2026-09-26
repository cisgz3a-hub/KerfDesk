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
import { useJobEstimate } from '../laser/use-job-estimate';
import { useCanvasMotionOverlay } from './use-canvas-motion-overlay';
import { CanvasMotionBadge } from './canvas-motion-badge';
import { ArtworkNumberingPrompt } from './ArtworkNumberingPrompt';
import { WorkspacePointerOverlays } from './WorkspacePointerOverlays';
import { WorkspacePreviewDock } from './WorkspacePreviewDock';
import { NodeEditHint } from './NodeEditHint';
import './workspace-preview.css';
import { WorkspaceCanvasLayers } from './WorkspaceCanvasLayers';
import { usePreviewBitmapRenderer } from './use-preview-bitmap-renderer';
import { canvasTextSelection, useCanvasTextDisplayProject } from './workspace-text-interaction';

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
  const jobEstimate = useJobEstimate();
  usePreviewPlayback(previewMode, previewToolpath, jobEstimate);
  const cncRemoval = useCncRemovalGridState(project, previewMode, previewToolpath, scrubberT);
  const cncRemovalGrid = cncRemoval.grid;
  const canvasSize = useCanvasBitmapSize(ref);
  const previewBitmap = usePreviewBitmapRenderer(previewMode);
  const { displayProject, textEditing } = useCanvasTextDisplayProject(project, previewMode);
  useWorkspaceDraw({
    ref,
    project: displayProject,
    ...canvasTextSelection(textEditing, selectedObjectId, additionalSelectedIds),
    selectedPathNode,
    selectedPathNodes,
    showPathNodeHandles: toolMode.kind === 'node',
    ...(toolMode.kind === 'cnc-tabs' ? { cncTabLayerColor: toolMode.layerColor } : {}),
    previewMode,
    previewToolpath,
    cncRemovalGrid,
    scrubberT,
    showPreviewTravel,
    viewState,
    canvasSize,
    previewBitmap,
    artworkRunFocus,
  });

  const { handlers, dragKind } = useDragMove(ref, project, previewMode, viewState);
  useWorkspaceWheelZoom(ref);
  useDropPenDraftOnProjectReplace(project);
  const dragOverlay = useUiStore((s) => s.dragOverlay);
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
        <WorkspacePointerOverlays canvasSize={canvasSize} dragging={dragKind !== null} />
        <WorkspaceDesignChrome previewMode={previewMode} overlay={canvasMotionOverlay} />
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

function useWorkspaceSelection() {
  const selectedObjectId = useStore((s) => s.selectedObjectId);
  const selectedPathNode = useStore((s) => s.selectedPathNode);
  const selectedPathNodes = useStore((s) => s.selectedPathNodes);
  const additionalSelectedIds = useStore((s) => s.additionalSelectedIds);
  return { selectedObjectId, selectedPathNode, selectedPathNodes, additionalSelectedIds };
}

function WorkspaceDesignChrome(props: {
  readonly previewMode: boolean;
  readonly overlay: ReturnType<typeof useCanvasMotionOverlay>;
}): JSX.Element | null {
  if (props.previewMode) return null;
  return (
    <>
      <CanvasMotionBadge overlay={props.overlay} />
      <ArtworkNumberingPrompt />
      <NodeEditHint />
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
};

function useWorkspaceDraw(args: WorkspaceDrawArgs): void {
  // Phase G (B5): the live shape being dragged out, rendered as a dashed
  // preview. Identity changes each mouse-move, so it belongs in the deps below.
  const draftShape = useUiStore((s) => s.draftShape);
  const selectionMarquee = useUiStore((s) => s.selectionMarquee);
  const snapGuides = useUiStore((s) => s.snapGuides);
  const measureDraft = useUiStore((s) => s.measureDraft);
  // Phase G (B6): the pen tool's in-progress polyline (also redraws per click /
  // cursor move).
  const penDraft = useUiStore((s) => s.penDraft);
  const wireframe = useUiStore((s) => s.wireframeView);
  const [rasterRedrawTick, setRasterRedrawTick] = useState(0);
  const colorScheme = useCanvasColorScheme();
  const previewBackgroundKey = useMemo(
    () => [args.project, args.cncRemovalGrid, rasterRedrawTick, colorScheme],
    [args.project, args.cncRemovalGrid, rasterRedrawTick, colorScheme],
  );
  const displayPolylineCache = useDisplayPolylineCache();
  const requestRasterRedraw = useCallback(() => {
    setRasterRedrawTick((tick) => tick + 1);
  }, []);
  useEffect(() => {
    const canvas = args.ref.current;
    if (canvas === null) return;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;
    drawWorkspaceScene(ctx, canvas, args, {
      requestRasterRedraw,
      previewBackgroundKey,
      displayPolylineCache,
      draftShape,
      penDraft,
      selectionMarquee,
      measureDraft,
      snapGuides,
      wireframe,
    });
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
    args.additionalSelectedIds,
    args.previewMode,
    args.scrubberT,
    args.showPreviewTravel,
    args.viewState,
    args.canvasSize,
    args.previewBitmap.drawRoute,
    args.previewBitmap.revision,
    args.artworkRunFocus,
    measureDraft,
    rasterRedrawTick,
    previewBackgroundKey,
    displayPolylineCache,
    args.previewToolpath,
    args.cncRemovalGrid,
    requestRasterRedraw,
    draftShape,
    penDraft,
    selectionMarquee,
    snapGuides,
    wireframe,
  ]);
}

function drawWorkspaceScene(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  args: Parameters<typeof useWorkspaceDraw>[0],
  state: {
    readonly requestRasterRedraw: () => void;
    readonly previewBackgroundKey: object;
    readonly displayPolylineCache: DisplayPolylineCache;
    readonly draftShape: ReturnType<typeof useUiStore.getState>['draftShape'];
    readonly penDraft: ReturnType<typeof useUiStore.getState>['penDraft'];
    readonly selectionMarquee: ReturnType<typeof useUiStore.getState>['selectionMarquee'];
    readonly measureDraft: ReturnType<typeof useUiStore.getState>['measureDraft'];
    readonly snapGuides: ReturnType<typeof useUiStore.getState>['snapGuides'];
    readonly wireframe: boolean;
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
    ...(args.cncTabLayerColor === undefined ? {} : { cncTabLayerColor: args.cncTabLayerColor }),
    ...(args.artworkRunFocus === null ? {} : { artworkRunFocus: args.artworkRunFocus }),
    wireframe: state.wireframe,
  });
}

function useDisplayPolylineCache(): DisplayPolylineCache {
  const cacheRef = useRef<DisplayPolylineCache | null>(null);
  if (cacheRef.current === null) cacheRef.current = createDisplayPolylineCache();
  return cacheRef.current;
}
