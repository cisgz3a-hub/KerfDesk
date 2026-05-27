// Workspace — Canvas2D viewport React component. Renders bed, grid, scene
// polylines, optional preview overlay (F-A8), selection outline + corner
// handles (F-A5/F-A6). Mouse: click-and-drag a handle to scale (Shift
// locks aspect, Alt scales from center), click-and-drag the body to move,
// drag the rotate handle to rotate (Shift snaps to 15°), Space-drag pans
// the viewport. Wheel+Ctrl zooms. Shift+click on objects toggles into the
// multi-select set.
//
// Drawing helpers live in `draw-scene.ts`; viewport math in
// `view-transform.ts`; the drag state machine in `drag-state.ts`; the
// HTML overlays (drop hint, preview scrubber, etc.) in `overlays.tsx`.

import { useEffect, useRef, useState } from 'react';
import type { Project } from '../../core/scene';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import { drawScene } from './draw-scene';
import {
  computeMouseDownDrag,
  type DragState,
  nextTransformForDrag,
  panOffsetForDrag,
} from './drag-state';
import { DragOverlay, DragReadout, EmptyHint, PreviewScrubber, ZoomControls } from './overlays';
import { canvasMouseToScene } from './view-transform';

export function Workspace(): JSX.Element {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const project = useStore((s) => s.project);
  const selectedObjectId = useStore((s) => s.selectedObjectId);
  const additionalSelectedIds = useStore((s) => s.additionalSelectedIds);
  const previewMode = useStore((s) => s.previewMode);
  const scrubberT = useUiStore((s) => s.scrubberT);
  // Three primitive selectors — Zustand only re-runs the effect when one
  // of them actually changes. A bundled `{...}` selector would create a
  // fresh object every store update and force unnecessary redraws.
  const zoomFactor = useUiStore((s) => s.zoomFactor);
  const panX = useUiStore((s) => s.panX);
  const panY = useUiStore((s) => s.panY);
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
      view: { zoomFactor, panX, panY },
    });
  }, [
    project,
    selectedObjectId,
    additionalSelectedIds,
    previewMode,
    scrubberT,
    zoomFactor,
    panX,
    panY,
  ]);

  const { handlers, dragKind } = useDragMove(ref, project, previewMode, {
    zoomFactor,
    panX,
    panY,
  });
  const isEmpty = project.scene.objects.length === 0;
  const dragOverlay = useUiStore((s) => s.dragOverlay);
  return (
    <>
      <canvas
        ref={ref}
        width={800}
        height={600}
        onMouseDown={handlers.onMouseDown}
        onMouseMove={handlers.onMouseMove}
        onMouseUp={handlers.onMouseUp}
        onMouseLeave={handlers.onMouseUp}
        onDoubleClick={openTextEditForSelectedText}
        onWheel={(e) => {
          // Pinch-to-zoom on trackpads + Ctrl+Wheel on mice. Both arrive
          // here as wheel events with ctrlKey true (browser convention).
          if (!e.ctrlKey && !e.metaKey) return;
          e.preventDefault();
          const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
          useUiStore.getState().zoomBy(factor);
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
          viewState={{ zoomFactor, panX, panY }}
        />
      )}
      {previewMode && <PreviewScrubber />}
      {/* Bottom-right zoom controls — hidden during preview so the
          scrubber gets the whole bottom strip. */}
      {!previewMode && <ZoomControls />}
    </>
  );
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

type DragHandlers = {
  readonly onMouseDown: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  readonly onMouseMove: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  readonly onMouseUp: () => void;
};

type DragMoveResult = {
  readonly handlers: DragHandlers;
  // null when nothing is being dragged or the active drag is a pan
  // (pan doesn't surface a readout). Drives the floating drag-readout
  // overlay so it's hidden during pans and idle selections.
  readonly dragKind: 'move' | 'scale' | 'rotate' | null;
};

function useDragMove(
  ref: React.RefObject<HTMLCanvasElement | null>,
  project: Project,
  previewMode: boolean,
  viewState: { readonly zoomFactor: number; readonly panX: number; readonly panY: number },
): DragMoveResult {
  const selectedObjectId = useStore((s) => s.selectedObjectId);
  const selectObject = useStore((s) => s.selectObject);
  const toggleSelectObject = useStore((s) => s.toggleSelectObject);
  const setCursorMm = useStore((s) => s.setCursorMm);
  const beginInteraction = useStore((s) => s.beginInteraction);
  const setObjectTransform = useStore((s) => s.setObjectTransform);
  const endInteraction = useStore((s) => s.endInteraction);
  const [drag, setDrag] = useState<DragState | null>(null);
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>): void => {
    if (previewMode) return;
    const next = computeMouseDownDrag({
      e,
      ref,
      project,
      selectedObjectId,
      viewState,
      onShiftClick: toggleSelectObject,
      onPlainClick: selectObject,
    });
    if (next === null) return;
    if (next.kind !== 'pan') beginInteraction();
    setDrag(next);
  };
  const handlers: DragHandlers = {
    onMouseDown: handleMouseDown,
    onMouseMove: (e) => {
      const canvas = ref.current;
      if (drag?.kind === 'pan' && canvas !== null) {
        const next = panOffsetForDrag({ drag, e, canvas, project, viewState });
        useUiStore.getState().setPan(next.panX, next.panY);
        return;
      }
      const point = canvasMouseToScene(e, canvas, project, viewState);
      setCursorMm(point);
      if (drag === null || drag.kind === 'pan' || point === null) return;
      const obj = project.scene.objects.find((o) => o.id === drag.objectId);
      if (obj === undefined) return;
      setObjectTransform(drag.objectId, nextTransformForDrag(drag, obj, point, e));
    },
    onMouseUp: () => {
      setCursorMm(null);
      if (drag === null) return;
      // Pan doesn't push undo (no project state changed), so skip
      // endInteraction in that case.
      if (drag.kind !== 'pan') endInteraction();
      setDrag(null);
    },
  };
  const visibleKind = drag === null || drag.kind === 'pan' ? null : drag.kind;
  return { handlers, dragKind: visibleKind };
}

const canvasStyle: React.CSSProperties = {
  display: 'block',
  background: '#fafafa',
  width: '100%',
  height: '100%',
};
