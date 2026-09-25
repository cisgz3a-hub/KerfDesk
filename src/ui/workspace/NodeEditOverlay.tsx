// Node-editor layer over the workspace (ADR-376). While the node tool is armed
// it highlights the node or segment a click or key would act on, the segment
// picked by clicking it and what a drag is about to do, points the cursor at
// the same target, and owns the node tool's keys.

import { useLayoutEffect, useMemo, useRef } from 'react';
import type { Project } from '../../core/scene';
import { useStore } from '../state/store';
import { useUiStore } from '../state/ui-store';
import { drawNodeEditOverlay } from './draw-node-edit-overlay';
import { useNodeEditKeys } from './node-edit-keys';
import { resolveSelectedSegment, useNodeEditStore } from './node-edit-store';
import { nodeEditHoverAt, nodeEditTarget } from './node-edit-target';
import type { CanvasBitmapSize } from './use-canvas-bitmap-size';
import { computeView, type ViewState } from './view-transform';

export function NodeEditOverlay(props: {
  readonly baseRef: React.RefObject<HTMLCanvasElement | null>;
  readonly canvasSize: CanvasBitmapSize;
  readonly project: Project;
  readonly previewMode: boolean;
  readonly viewState: ViewState;
}): JSX.Element | null {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const active = useUiStore((state) => state.toolMode.kind === 'node') && !props.previewMode;
  useNodeEditKeys(active);
  const selectedObjectId = useStore((state) => state.selectedObjectId);
  const additionalSelectedIds = useStore((state) => state.additionalSelectedIds);
  const selectedPathNodes = useStore((state) => state.selectedPathNodes);
  const dragging = useStore((state) => state.pendingUndo !== null);
  const pointer = useNodeEditStore((state) => state.pointer);
  const clicked = useNodeEditStore((state) => state.selectedSegment);
  const feedback = useNodeEditStore((state) => state.feedback);
  const { project, canvasSize, viewState } = props;
  const selection = useMemo(
    () => ({ project, selectedObjectId, additionalSelectedIds, selectedPathNodes }),
    [project, selectedObjectId, additionalSelectedIds, selectedPathNodes],
  );
  const hover = useMemo(
    () =>
      active && !dragging && pointer !== null
        ? nodeEditHoverAt(selection, pointer.scenePoint, pointer.pxToMm)
        : null,
    [active, dragging, pointer, selection],
  );
  const selectedSegment = useMemo(() => {
    const segment = resolveSelectedSegment(project, clicked);
    return segment !== null && segment.objectId === nodeEditTarget(selection)?.id ? segment : null;
  }, [project, clicked, selection]);
  const view = useMemo(
    () =>
      computeView(
        canvasSize.width,
        canvasSize.height,
        project.device.bedWidth,
        project.device.bedHeight,
        viewState,
      ),
    [canvasSize, project.device.bedWidth, project.device.bedHeight, viewState],
  );
  useLayoutEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d') ?? null;
    if (canvas === null || ctx === null) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawNodeEditOverlay(ctx, { project, view, hover, selectedSegment, feedback });
  }, [active, project, view, hover, selectedSegment, feedback]);
  useLayoutEffect(() => {
    // The pointer handlers reset the cursor on every move; this runs after.
    const canvas = props.baseRef.current;
    if (canvas === null || hover === null) return;
    canvas.style.cursor = hover.kind === 'node' ? 'move' : 'pointer';
  }, [props.baseRef, hover]);
  if (!active) return null;
  return (
    <canvas
      ref={ref}
      width={canvasSize.width}
      height={canvasSize.height}
      style={overlayStyle}
      aria-hidden="true"
      data-testid="node-edit-layer"
    />
  );
}

const overlayStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  pointerEvents: 'none',
};
