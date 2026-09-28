// Tools whose primary click does its work at once and never starts a drag:
// Position Laser jogs the head to the clicked bed point (ADR-116 follow-up),
// Trim Shapes deletes the highlighted stretch of outline (LBG-T04). Kept out of
// use-workspace-drag.ts so that router stays inside the size and complexity caps.

import type { MouseEvent as ReactMouseEvent } from 'react';
import type { Project } from '../../core/scene';
import type { ToolMode } from '../state/ui-store';
import { dispatchPositionLaser } from './position-laser-click';
import { trimAtPointer } from './trim-shapes-tool';
import { canvasMouseToScene, type ViewState } from './view-transform';

/** True when the active tool handled the click. */
export function runClickTool(args: {
  readonly e: ReactMouseEvent<HTMLCanvasElement>;
  readonly canvas: HTMLCanvasElement | null;
  readonly project: Project;
  readonly viewState: ViewState;
  readonly toolMode: ToolMode;
}): boolean {
  if (args.toolMode.kind === 'position-laser') {
    const point = canvasMouseToScene(args.e, args.canvas, args.project, args.viewState);
    if (point !== null) dispatchPositionLaser(point, args.project.device);
    return true;
  }
  if (args.toolMode.kind === 'trim-shapes') {
    trimAtPointer(args);
    return true;
  }
  return false;
}
