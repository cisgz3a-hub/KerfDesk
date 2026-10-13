// Two-Point Rotate / Scale on the canvas (LightBurn Arrange). Three clicks:
// the pivot, a reference point on the artwork, and where that reference point
// should go. The selection turns about the pivot by the angle between the two
// directions; with Shift held on the last click it also scales by the ratio of
// their distances. Snapped points are not required: any bed point works.

import type { MouseEvent as ReactMouseEvent } from 'react';
import type { Project, Vec2 } from '../../core/scene';
import { useStore } from '../state';
import { useToastStore } from '../state/toast-store';
import { useUiStore } from '../state/ui-store';
import { canvasMouseToScene, type ViewState } from './view-transform';

const MIN_ARM_MM = 1e-6;

export type TwoPointMotion = { readonly deltaDeg: number; readonly scale: number };

/** The rotation and scale that carry `from` to `to` about `pivot`. */
export function twoPointMotion(
  pivot: Vec2,
  from: Vec2,
  to: Vec2,
  withScale: boolean,
): TwoPointMotion | null {
  const a = { x: from.x - pivot.x, y: from.y - pivot.y };
  const b = { x: to.x - pivot.x, y: to.y - pivot.y };
  const lengthA = Math.hypot(a.x, a.y);
  const lengthB = Math.hypot(b.x, b.y);
  if (lengthA < MIN_ARM_MM || lengthB < MIN_ARM_MM) return null;
  const deltaDeg = ((Math.atan2(b.y, b.x) - Math.atan2(a.y, a.x)) * 180) / Math.PI;
  return { deltaDeg, scale: withScale ? lengthB / lengthA : 1 };
}

export function twoPointClick(args: {
  readonly e: ReactMouseEvent<HTMLCanvasElement>;
  readonly canvas: HTMLCanvasElement | null;
  readonly project: Project;
  readonly viewState: ViewState;
}): void {
  const ui = useUiStore.getState();
  if (ui.toolMode.kind !== 'two-point') return;
  const point = canvasMouseToScene(args.e, args.canvas, args.project, args.viewState);
  if (point === null) return;
  const { pivot, from } = ui.toolMode;
  if (pivot === undefined) {
    ui.setToolMode({ kind: 'two-point', pivot: point });
    return;
  }
  if (from === undefined) {
    ui.setToolMode({ kind: 'two-point', pivot, from: point });
    return;
  }
  const motion = twoPointMotion(pivot, from, point, args.e.shiftKey);
  if (motion === null) {
    useToastStore.getState().pushToast('Click a point away from the pivot.', 'info');
    return;
  }
  useStore.getState().rotateScaleSelectionAbout(pivot, motion.deltaDeg, motion.scale);
  ui.resetToolMode();
}

export function startTwoPointTool(): void {
  const state = useStore.getState();
  if (state.selectedObjectId === null) {
    useToastStore.getState().pushToast('Select the artwork to rotate or scale first.', 'warning');
    return;
  }
  useUiStore.getState().setToolMode({ kind: 'two-point' });
}
