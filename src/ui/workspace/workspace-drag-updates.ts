import type { Project, ShapeObject, Vec2 } from '../../core/scene';
import type { ToolMode } from '../state/ui-store';
import type { DragState } from './drag-state';
import { draftForDrawDrag, drawModifiersFromEvent } from './draw-tool';
import { constrainMeasureEnd, type MeasureDraft } from './measure-tool';
import { updatePathNodeDrag } from './path-node-drag';
import { updatePenCursor } from './pen-tool';

type CanvasMouseEvent = React.MouseEvent<HTMLCanvasElement>;

type NonTransformDragUpdateArgs = {
  readonly e: CanvasMouseEvent;
  readonly drag: DragState | null;
  readonly point: Vec2 | null;
  readonly project: Project;
  readonly toolMode: ToolMode;
  readonly setDraftShape: (shape: ShapeObject | null) => void;
  readonly setMeasureDraft: (draft: MeasureDraft | null) => void;
  readonly setSelectionMarquee: (
    marquee: { readonly start: Vec2; readonly end: Vec2 } | null,
  ) => void;
  readonly setSelectedPathNodePositionDuringInteraction: (scenePoint: Vec2) => void;
  readonly setSelectedCncTabAnchorDuringInteraction: (
    anchorIndex: number,
    layerColor: string,
    scenePoint: Vec2,
  ) => void;
};

export function handleNonTransformDragUpdate(args: NonTransformDragUpdateArgs): boolean {
  if (args.drag?.kind === 'marquee') {
    updateSelectionMarquee({
      drag: args.drag,
      point: args.point,
      setSelectionMarquee: args.setSelectionMarquee,
    });
    return true;
  }
  if (args.drag?.kind === 'measure') {
    updateMeasureDraft({
      drag: args.drag,
      point: args.point,
      constrained: args.e.shiftKey,
      setMeasureDraft: args.setMeasureDraft,
    });
    return true;
  }
  if (args.drag?.kind === 'path-node') {
    updatePathNodeDrag({
      drag: args.drag,
      point: args.point,
      setSelectedPathNodePositionDuringInteraction:
        args.setSelectedPathNodePositionDuringInteraction,
    });
    return true;
  }
  if (handleLiveToolUpdate(args)) return true;
  if (args.drag?.kind === 'draw') {
    updateDrawDraft({ ...args, drag: args.drag });
    return true;
  }
  return false;
}

function handleLiveToolUpdate(args: NonTransformDragUpdateArgs): boolean {
  if (args.drag?.kind === 'cnc-tab') {
    if (args.point !== null) {
      args.setSelectedCncTabAnchorDuringInteraction(
        args.drag.anchorIndex,
        args.drag.layerColor,
        args.point,
      );
    }
    return true;
  }
  if (args.toolMode.kind !== 'draw' || args.toolMode.shape !== 'polyline') return false;
  updatePenCursor(args.point, args.e.shiftKey);
  return true;
}

export function updateMeasureDraft(args: {
  readonly drag: Extract<DragState, { kind: 'measure' }>;
  readonly point: Vec2 | null;
  readonly constrained: boolean;
  readonly setMeasureDraft: (draft: MeasureDraft | null) => void;
}): void {
  if (args.point === null) return;
  args.setMeasureDraft({
    start: args.drag.startScenePoint,
    end: constrainMeasureEnd(args.drag.startScenePoint, args.point, args.constrained),
  });
}

export function updateDrawDraft(args: {
  readonly drag: Extract<DragState, { kind: 'draw' }>;
  readonly point: Vec2 | null;
  readonly project: Project;
  readonly e: CanvasMouseEvent;
  readonly setDraftShape: (shape: ShapeObject | null) => void;
}): void {
  if (args.point === null) return;
  args.setDraftShape(
    draftForDrawDrag(args.drag, args.point, args.project, drawModifiersFromEvent(args.e)),
  );
}

function updateSelectionMarquee(args: {
  readonly drag: Extract<DragState, { kind: 'marquee' }>;
  readonly point: Vec2 | null;
  readonly setSelectionMarquee: (
    marquee: { readonly start: Vec2; readonly end: Vec2 } | null,
  ) => void;
}): void {
  if (args.point === null) return;
  args.setSelectionMarquee({ start: args.drag.startScenePoint, end: args.point });
}
