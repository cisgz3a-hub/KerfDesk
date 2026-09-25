// Node-tool pointer gestures (ADR-376). A press grabs, in order: a node or
// handle of the artwork being edited, a point on one of its segments, a node
// of other artwork, or picks other artwork to edit. Dragging then moves the
// grabbed nodes or handle (snapping, Shift-constrained, joining an open end
// dropped on another), or bends the grabbed segment so the point under the
// pointer follows it, as LightBurn does. The drag remembers where the item
// started, so it follows the pointer without first jumping onto it.

import { hitTest, type Project, type Vec2 } from '../../core/scene';
import { useStore } from '../state';
import { pathNodeRefsEqual, type PathNodeRef } from '../state/path-node-edit-actions';
import type { PathSegmentRef } from '../state/path-segment-ref';
import { useNodeEditStore } from './node-edit-store';
import { nodeEditHoverAt, pathNodeScenePoint } from './node-edit-target';
import { nodeDragLanding } from './path-node-drag-landing';
import { hitPathNode } from './path-node-hit-test';
import type { PathSegmentHit } from './path-segment-hit-test';
import type { SnapGuide, SnapSettings } from './snapping';

export type PathNodeGrab =
  | { readonly kind: 'node'; readonly ref: PathNodeRef; readonly origin: Vec2 }
  | {
      readonly kind: 'segment';
      readonly ref: PathSegmentRef;
      readonly t: number;
      readonly origin: Vec2;
    };

export type PathNodeDragState = {
  readonly kind: 'path-node';
  readonly startScenePoint: Vec2;
  readonly grab: PathNodeGrab;
};

export type PathNodeDragModifiers = {
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
};

type PressArgs = {
  readonly project: Project;
  readonly scenePoint: Vec2;
  readonly pxToMm: number;
  readonly additive?: boolean;
  readonly selectedObjectId?: string | null;
  readonly additionalSelectedIds?: ReadonlySet<string>;
  readonly selectedPathNodes: ReadonlyArray<PathNodeRef>;
  readonly selectPathNode: (
    ref: PathNodeRef | null,
    options?: { readonly additive?: boolean },
  ) => void;
  readonly selectObject?: (id: string | null) => void;
};

// A click that wanders less than this still only selects the segment.
const BEND_THRESHOLD_PX = 3;
const NO_IDS: ReadonlySet<string> = new Set();

export function beginPathNodeDrag(args: PressArgs): PathNodeDragState | null {
  const selection = {
    project: args.project,
    selectedObjectId: args.selectedObjectId ?? null,
    additionalSelectedIds: args.additionalSelectedIds ?? NO_IDS,
    selectedPathNodes: args.selectedPathNodes,
  };
  const hover = nodeEditHoverAt(selection, args.scenePoint, args.pxToMm);
  if (hover?.kind === 'node') return grabNode(args, hover.ref);
  if (hover?.kind === 'segment') return grabSegment(args, hover.hit);
  const ref = hitPathNode(args.project.scene, args.scenePoint, args.pxToMm, args.selectedPathNodes);
  if (ref !== null) return grabNode(args, ref);
  args.selectPathNode(null);
  useNodeEditStore.getState().selectSegment(null, args.project);
  // Clicking other artwork makes it the one being edited, as in LightBurn.
  const picked =
    args.selectObject === undefined ? null : hitTest(args.project.scene, args.scenePoint);
  if (picked !== null && picked !== selection.selectedObjectId) args.selectObject?.(picked);
  return null;
}

function grabNode(args: PressArgs, ref: PathNodeRef): PathNodeDragState {
  // A plain click on a node already in the multi-selection keeps the whole set
  // and drags it (audit C6) — same rule as dragging an already-selected object.
  // Shift toggles; a click on an unselected node selects just it.
  const alreadySelected = args.selectedPathNodes.some((selected) =>
    pathNodeRefsEqual(selected, ref),
  );
  if (args.additive === true || !alreadySelected) {
    args.selectPathNode(ref, { additive: args.additive === true });
  }
  useNodeEditStore.getState().selectSegment(null, args.project);
  const origin = pathNodeScenePoint(args.project, ref) ?? args.scenePoint;
  return {
    kind: 'path-node',
    startScenePoint: args.scenePoint,
    grab: { kind: 'node', ref, origin },
  };
}

function grabSegment(args: PressArgs, hit: PathSegmentHit): PathNodeDragState {
  args.selectPathNode(null);
  useNodeEditStore.getState().selectSegment(hit.ref, args.project, hit.t);
  return {
    kind: 'path-node',
    startScenePoint: args.scenePoint,
    grab: { kind: 'segment', ref: hit.ref, t: hit.t, origin: hit.point },
  };
}

export function updatePathNodeDrag(args: {
  readonly drag: PathNodeDragState;
  readonly point: Vec2 | null;
  readonly modifiers: PathNodeDragModifiers;
  readonly pxToMm: number;
  readonly snapSettings: SnapSettings;
  readonly setSnapGuides: (guides: ReadonlyArray<SnapGuide>) => void;
}): void {
  if (args.point === null) return;
  const { grab, startScenePoint } = args.drag;
  const offset = { x: args.point.x - startScenePoint.x, y: args.point.y - startScenePoint.y };
  const proposed = { x: grab.origin.x + offset.x, y: grab.origin.y + offset.y };
  const app = useStore.getState();
  if (grab.kind === 'segment') {
    const untouched = app.pendingUndo !== null && app.pendingUndo.project === app.project;
    if (untouched && Math.hypot(offset.x, offset.y) < BEND_THRESHOLD_PX * args.pxToMm) return;
    app.bendPathSegmentDuringInteraction(grab.ref, grab.t, proposed);
    return;
  }
  const landing = nodeDragLanding({
    project: app.pendingUndo?.project ?? app.project,
    grabbed: grab.ref,
    moving: movingAnchors(app.selectedPathNodes, grab.ref),
    origin: grab.origin,
    proposed,
    pxToMm: args.pxToMm,
    constrain: args.modifiers.shiftKey,
    // Ctrl/Cmd suspends snapping for this drag, as it does for object moves.
    snap: args.modifiers.ctrlKey || args.modifiers.metaKey ? null : args.snapSettings,
  });
  args.setSnapGuides(landing.guides);
  useNodeEditStore.getState().setFeedback(landing.feedback);
  app.moveSelectedPathNodesDuringInteraction(grab.ref, landing.point, {
    mirrorHandle: args.modifiers.altKey,
  });
}

/** Release: an open end left on another open end joins them. Runs before the
 *  interaction is committed, so the drag and the join are one undo step. */
export function finishPathNodeDrag(drag: PathNodeDragState): void {
  const join = useNodeEditStore.getState().feedback?.join ?? null;
  useNodeEditStore.getState().setFeedback(null);
  if (drag.grab.kind !== 'node' || join === null) return;
  useStore.getState().joinPathEndpointsDuringInteraction(join.dragged, join.target);
}

function movingAnchors(
  selected: ReadonlyArray<PathNodeRef>,
  grabbed: PathNodeRef,
): ReadonlyArray<PathNodeRef> {
  if (grabbed.handle !== undefined) return [];
  const group = selected.some((ref) => pathNodeRefsEqual(ref, grabbed)) ? selected : [grabbed];
  return group.filter((ref) => ref.handle === undefined);
}
