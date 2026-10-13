// Pointer-up for the editing drags that finish their own history: a guide
// drag (kept, moved or deleted on a ruler) and a node drag dropped onto
// another endpoint (drag-to-join). False hands the drag back to the default
// end of interaction.

import type { Project } from '../../core/scene';
import type { DragState } from './drag-state';
import { finishGuideDrag } from './guide-drag';
import { joinPathNodeOnDrop } from './path-node-drag';
import type { ViewState } from './view-transform';

export function finishEditDrag(
  drag: DragState,
  args: {
    readonly e: React.MouseEvent<HTMLCanvasElement>;
    readonly canvas: HTMLCanvasElement | null;
    readonly project: Project;
    readonly viewState: ViewState;
  },
): boolean {
  if (drag.kind === 'guide') {
    finishGuideDrag(drag, args);
    return true;
  }
  return drag.kind === 'path-node' && joinPathNodeOnDrop(args.canvas, args.project, args.viewState);
}
