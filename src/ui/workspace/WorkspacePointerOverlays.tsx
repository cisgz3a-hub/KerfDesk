// The pointer-following canvas overlays (ADR-348), composed in one place so
// Workspace.tsx stays a layout shell: the operation colour pulse (ADR-620),
// the ruler-strip cursor marks, the hover size readout, and the Trim Shapes
// highlight (LBG-T04).
//
// These are display-only DOM over the canvas, `pointer-events: none`, and do
// not participate in the scene redraw. They read the scene, view and tool
// from the stores; Workspace supplies the canvas, its bitmap size and whether
// a drag is in progress.

import { useMemo } from 'react';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import { ArtworkPulseOverlay } from './ArtworkPulseOverlay';
import { HoverSizeReadout } from './HoverSizeReadout';
import { MeasureHoverReadout } from './MeasureHoverReadout';
import { RulerCursorOverlay } from './RulerCursorOverlay';
import { ExtendShapesOverlay } from './ExtendShapesOverlay';
import { NodeEditOverlay } from './NodeEditOverlay';
import { TrimShapesOverlay } from './TrimShapesOverlay';
import type { CanvasBitmapSize } from './use-canvas-bitmap-size';
import type { ViewState } from './view-transform';

export function WorkspacePointerOverlays(props: {
  readonly canvasRef: React.RefObject<HTMLCanvasElement | null>;
  readonly canvasSize: CanvasBitmapSize;
  readonly dragging: boolean;
}): JSX.Element {
  const project = useStore((state) => state.project);
  const previewMode = useStore((state) => state.previewMode);
  const toolMode = useUiStore((state) => state.toolMode);
  const viewState = usePointerViewState();
  return (
    <>
      {!previewMode && (
        <ArtworkPulseOverlay
          canvasRef={props.canvasRef}
          project={project}
          canvasSize={props.canvasSize}
          viewState={viewState}
          canvasHoverEnabled={!props.dragging && toolMode.kind === 'select'}
          dragging={props.dragging}
        />
      )}
      <RulerCursorOverlay project={project} canvasSize={props.canvasSize} viewState={viewState} />
      <HoverSizeReadout
        project={project}
        canvasSize={props.canvasSize}
        viewState={viewState}
        // Measuring is for the select tool at rest: a drag has its own readout
        // and owns the pointer, and Preview is not an editing surface.
        enabled={!previewMode && !props.dragging && toolMode.kind === 'select'}
      />
      <MeasureHoverReadout
        project={project}
        canvasSize={props.canvasSize}
        viewState={viewState}
        enabled={!previewMode && !props.dragging && toolMode.kind === 'measure'}
      />
      <ExtendShapesOverlay
        project={project}
        canvasSize={props.canvasSize}
        viewState={viewState}
        enabled={!previewMode && !props.dragging}
      />
      <TrimShapesOverlay
        project={project}
        canvasSize={props.canvasSize}
        viewState={viewState}
        enabled={!previewMode && !props.dragging}
      />
      <NodeEditOverlay
        project={project}
        canvasSize={props.canvasSize}
        viewState={viewState}
        enabled={!previewMode && !props.dragging}
      />
    </>
  );
}

// Primitive selectors, same as Workspace's: a bundled selector would allocate
// a fresh object on every store update and re-render both overlays with it.
function usePointerViewState(): ViewState {
  const zoomFactor = useUiStore((state) => state.zoomFactor);
  const panX = useUiStore((state) => state.panX);
  const panY = useUiStore((state) => state.panY);
  return useMemo(() => ({ zoomFactor, panX, panY }), [zoomFactor, panX, panY]);
}
