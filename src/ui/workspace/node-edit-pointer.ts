// Keeps the node tool's view of the pointer (ADR-376): where it is over the
// canvas, for hover and for the editing keys, and that it has left. Also the
// node tool's double-click, which adds a node where a segment was clicked.

import type { Project } from '../../core/scene';
import { useStore } from '../state/store';
import { useUiStore } from '../state/ui-store';
import { useNodeEditStore } from './node-edit-store';
import { nodeEditHoverAt } from './node-edit-target';
import { canvasMouseToScene, pxToMmForCanvas, type ViewState } from './view-transform';
import type { OwnedPointerHandlers } from './workspace-pointer-owner';

export function nodeEditPointerHandlers(
  handlers: OwnedPointerHandlers,
  args: {
    readonly canvasRef: React.RefObject<HTMLCanvasElement | null>;
    readonly project: Project;
    readonly previewMode: boolean;
    readonly viewState: ViewState;
  },
): OwnedPointerHandlers {
  return {
    ...handlers,
    onPointerMove: (event) => {
      handlers.onPointerMove(event);
      const canvas = args.canvasRef.current;
      const tracking = useUiStore.getState().toolMode.kind === 'node' && !args.previewMode;
      const scenePoint = tracking
        ? canvasMouseToScene(event, canvas, args.project, args.viewState)
        : null;
      if (scenePoint === null) {
        clearNodeEditPointer();
        return;
      }
      const pxToMm = pxToMmForCanvas(canvas, args.project, args.viewState);
      useNodeEditStore.getState().setPointer({ scenePoint, pxToMm });
    },
  };
}

export function clearNodeEditPointer(): void {
  if (useNodeEditStore.getState().pointer !== null) useNodeEditStore.getState().setPointer(null);
}

export function insertNodeOnDoubleClick(
  event: React.MouseEvent<HTMLCanvasElement>,
  viewState: ViewState,
): boolean {
  const app = useStore.getState();
  const point = canvasMouseToScene(event, event.currentTarget, app.project, viewState);
  if (point === null) return false;
  const pxToMm = pxToMmForCanvas(event.currentTarget, app.project, viewState);
  const hover = nodeEditHoverAt(app, point, pxToMm);
  return hover?.kind === 'segment' && app.insertPathNode(hover.hit.ref, hover.hit.t);
}
