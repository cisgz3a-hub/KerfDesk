// The two pointer-following canvas overlays (ADR-346), composed in one place
// so Workspace.tsx stays a layout shell: the ruler-strip cursor marks, and the
// hover size readout.
//
// Both are display-only DOM over the canvas, `pointer-events: none`, and
// neither participates in the scene redraw. They read the scene, view and tool
// from the stores themselves — Workspace only owns the two facts they cannot
// see: the canvas bitmap size and whether a drag is in progress.

import { useMemo } from 'react';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import { HoverSizeReadout } from './HoverSizeReadout';
import { RulerCursorOverlay } from './RulerCursorOverlay';
import type { CanvasBitmapSize } from './use-canvas-bitmap-size';
import type { ViewState } from './view-transform';

export function WorkspacePointerOverlays(props: {
  readonly canvasSize: CanvasBitmapSize;
  readonly dragging: boolean;
}): JSX.Element {
  const project = useStore((state) => state.project);
  const previewMode = useStore((state) => state.previewMode);
  const toolMode = useUiStore((state) => state.toolMode);
  const viewState = usePointerViewState();
  return (
    <>
      <RulerCursorOverlay project={project} canvasSize={props.canvasSize} viewState={viewState} />
      <HoverSizeReadout
        project={project}
        canvasSize={props.canvasSize}
        viewState={viewState}
        // Measuring is for the select tool at rest: a drag has its own readout
        // and owns the pointer, and Preview is not an editing surface.
        enabled={!previewMode && !props.dragging && toolMode.kind === 'select'}
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
