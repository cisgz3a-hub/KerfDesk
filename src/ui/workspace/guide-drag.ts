// Guideline drags (LightBurn: drag a guide out of a ruler). Pressing in the
// top ruler pulls out a horizontal guide, in the left ruler a vertical one.
// With the select tool, a press on a guide away from any artwork moves it;
// releasing a guide back over a ruler deletes it. Each drag is one undo step,
// and a click on a ruler that creates nothing leaves no history.

import {
  hitTest,
  type GuideAxis,
  type Project,
  type ProjectGuide,
  type Vec2,
} from '../../core/scene';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import { RULER_THICKNESS_PX } from './canvas-layout';
import { useGuideLockStore } from './guide-lock-store';
import { canvasMouseToScene, pxToMmForCanvas, type ViewState } from './view-transform';

export type GuideDragState = {
  readonly kind: 'guide';
  readonly id: string;
  readonly axis: GuideAxis;
  readonly created: boolean;
};

const GUIDE_HIT_PX = 4;

type PointerArgs = {
  readonly e: React.MouseEvent<HTMLCanvasElement>;
  readonly canvas: HTMLCanvasElement | null;
  readonly project: Project;
  readonly viewState: ViewState;
};

/** Which ruler the pointer is over, by canvas bitmap pixel; null off both. */
function rulerUnder(e: PointerArgs['e'], canvas: HTMLCanvasElement | null): GuideAxis | null {
  if (canvas === null) return null;
  const rect = canvas.getBoundingClientRect();
  if (!(rect.width > 0) || !(rect.height > 0)) return null;
  const px = ((e.clientX - rect.left) / rect.width) * canvas.width;
  const py = ((e.clientY - rect.top) / rect.height) * canvas.height;
  if (py < RULER_THICKNESS_PX && px >= RULER_THICKNESS_PX) return 'y';
  if (px < RULER_THICKNESS_PX && py >= RULER_THICKNESS_PX) return 'x';
  return null;
}

export function beginGuideDrag(args: PointerArgs): GuideDragState | null {
  if (useGuideLockStore.getState().locked) return null;
  const point = canvasMouseToScene(args.e, args.canvas, args.project, args.viewState);
  if (point === null) return null;
  const app = useStore.getState();
  const guides = app.project.guides ?? [];
  const ruler = rulerUnder(args.e, args.canvas);
  if (ruler !== null) {
    const guide: ProjectGuide = {
      id: crypto.randomUUID(),
      axis: ruler,
      positionMm: along(point, ruler),
    };
    app.beginInteraction();
    app.setGuidesDuringInteraction([...guides, guide]);
    return { kind: 'guide', id: guide.id, axis: ruler, created: true };
  }
  if (useUiStore.getState().toolMode.kind !== 'select') return null;
  if (hitTest(args.project.scene, point) !== null) return null;
  const reach = GUIDE_HIT_PX * pxToMmForCanvas(args.canvas, args.project, args.viewState);
  const hit = guides.find(
    (guide) => Math.abs(guide.positionMm - along(point, guide.axis)) <= reach,
  );
  if (hit === undefined) return null;
  app.beginInteraction();
  return { kind: 'guide', id: hit.id, axis: hit.axis, created: false };
}

export function updateGuideDrag(drag: GuideDragState, point: Vec2 | null): void {
  if (point === null) return;
  const app = useStore.getState();
  const guides = (app.project.guides ?? []).map((guide) =>
    guide.id === drag.id ? { ...guide, positionMm: along(point, drag.axis) } : guide,
  );
  app.setGuidesDuringInteraction(guides);
}

export function finishGuideDrag(drag: GuideDragState, args: PointerArgs): void {
  const app = useStore.getState();
  if (rulerUnder(args.e, args.canvas) === null) {
    app.endInteraction();
    return;
  }
  // Dropped back on a ruler: the guide goes. A new one never existed.
  if (drag.created) {
    app.cancelInteraction();
    return;
  }
  app.setGuidesDuringInteraction(
    (app.project.guides ?? []).filter((guide) => guide.id !== drag.id),
  );
  app.endInteraction();
}

function along(point: Vec2, axis: GuideAxis): number {
  return axis === 'x' ? point.x : point.y;
}
