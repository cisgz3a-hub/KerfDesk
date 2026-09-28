// Primary clicks for the canvas tools that drag handles of their own: laser
// tabs (ADR-494), and Warp and Deform (LBG-T06). Kept out of
// use-workspace-drag.ts so that module stays under the file-size cap.

import type { Project } from '../../core/scene/project';
import type { ToolMode } from '../state/ui-store';
import type { DragState } from './drag-state';
import { beginLaserTabPointer } from './laser-tab-editor';
import type { ViewState } from './view-transform';
import { beginWarpHandleDrag } from './warp-deform-tool';

/** The tool's drag (null when the click needs none), or null when no such tool is on. */
export function beginHandleToolDrag(args: {
  readonly e: React.MouseEvent<HTMLCanvasElement>;
  readonly canvas: HTMLCanvasElement | null;
  readonly project: Project;
  readonly viewState: ViewState;
  readonly toolMode: ToolMode;
  readonly selectedObjectId: string | null;
}): { readonly kind: 'handled'; readonly drag: DragState | null } | null {
  if (args.toolMode.kind === 'laser-tabs') {
    return { kind: 'handled', drag: beginLaserTabPointer({ ...args, mode: args.toolMode }) };
  }
  if (args.toolMode.kind === 'warp-deform') {
    return { kind: 'handled', drag: beginWarpHandleDrag(args) };
  }
  return null;
}
