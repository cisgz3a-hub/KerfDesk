// move-point-snap — snapping the grabbed point of a moving selection onto other
// artwork (LightBurn gap LBG-F06).
//
// At the start of a move the grab point is resolved to the nearest node,
// midpoint or centre of the moving objects — nearest by distance alone, since
// "the corner I grabbed" is the intent. As the selection moves, that point is
// carried along and snapped to targets on OTHER artwork; the selection then
// shifts so the grabbed point sits exactly on the target. Moving objects are
// never targets.
//
// The grab point is found once per drag and remembered against the drag
// object, from the selection's START transforms, so it never drifts with the
// move it is steering.

import type { Project, Transform, Vec2 } from '../../../core/scene';
import type { SnapSettings } from '../snap-settings';
import { findPointSnap } from './scene-snap-query';
import { enabledPointSnapKinds, type PointSnapKind, type SnapMarker } from './snap-kinds';

export type MoveDragForSnap = {
  readonly kind: 'move';
  readonly objectId: string;
  readonly startScenePoint: Vec2;
  readonly startTx: number;
  readonly startTy: number;
  readonly selectionStartTransforms?: ReadonlyArray<{
    readonly id: string;
    readonly transform: Transform;
  }>;
};

export type MovePointSnap = {
  readonly transform: Transform;
  readonly marker: SnapMarker;
};

// Growth steps of the grab-point search: reach, then 4x, 16x ... until a point
// is found or the search covers the whole moving selection.
const GRAB_SEARCH_GROWTH = 4;
const GRAB_SEARCH_STEPS = 12;

const grabPoints = new WeakMap<object, Vec2 | null>();

export function snapMoveToPoint(args: {
  readonly drag: MoveDragForSnap;
  readonly project: Project;
  readonly proposedTransform: Transform;
  readonly settings: SnapSettings;
  readonly radiusMm: number;
}): MovePointSnap | null {
  const targetKinds = enabledPointSnapKinds(args.settings);
  if (!args.settings.enabled || !(args.radiusMm > 0) || targetKinds.size === 0) return null;
  const movingIds = movingObjectIds(args.drag);
  const grab = grabPointFor(args.drag, args.project, movingIds, args.radiusMm, targetKinds);
  if (grab === null) return null;
  const dx = args.proposedTransform.x - args.drag.startTx;
  const dy = args.proposedTransform.y - args.drag.startTy;
  const target = findPointSnap({
    project: args.project,
    pointMm: { x: grab.x + dx, y: grab.y + dy },
    radiusMm: args.radiusMm,
    kinds: targetKinds,
    exclusion: { objectIds: movingIds },
  });
  if (target === null) return null;
  return {
    transform: {
      ...args.proposedTransform,
      x: args.drag.startTx + target.pointMm.x - grab.x,
      y: args.drag.startTy + target.pointMm.y - grab.y,
    },
    marker: { kind: target.kind, pointMm: target.pointMm },
  };
}

export function movingObjectIds(drag: MoveDragForSnap): ReadonlySet<string> {
  const ids = new Set<string>([drag.objectId]);
  for (const entry of drag.selectionStartTransforms ?? []) ids.add(entry.id);
  return ids;
}

function grabPointFor(
  drag: MoveDragForSnap,
  project: Project,
  movingIds: ReadonlySet<string>,
  radiusMm: number,
  targetKinds: ReadonlySet<PointSnapKind>,
): Vec2 | null {
  if (grabPoints.has(drag)) return grabPoints.get(drag) ?? null;
  const kinds = new Set([...targetKinds].filter((kind) => kind !== 'intersection'));
  const grab = kinds.size === 0 ? null : searchGrabPoint(drag, project, movingIds, radiusMm, kinds);
  grabPoints.set(drag, grab);
  return grab;
}

function searchGrabPoint(
  drag: MoveDragForSnap,
  project: Project,
  movingIds: ReadonlySet<string>,
  radiusMm: number,
  kinds: ReadonlySet<PointSnapKind>,
): Vec2 | null {
  const atStart = projectAtDragStart(drag, project);
  let reach = radiusMm;
  for (let step = 0; step < GRAB_SEARCH_STEPS; step += 1) {
    const found = findPointSnap({
      project: atStart,
      pointMm: drag.startScenePoint,
      radiusMm: reach,
      kinds,
      exclusion: { onlyObjectIds: movingIds },
      ranking: 'distance',
    });
    if (found !== null) return found.pointMm;
    reach *= GRAB_SEARCH_GROWTH;
  }
  return null;
}

// The scene as it was at pointer-down: moving objects at their start transforms.
function projectAtDragStart(drag: MoveDragForSnap, project: Project): Project {
  const starts = new Map<string, Transform>(
    (drag.selectionStartTransforms ?? []).map((entry) => [entry.id, entry.transform]),
  );
  return {
    ...project,
    scene: {
      ...project.scene,
      objects: project.scene.objects.map((object) => {
        const start =
          starts.get(object.id) ??
          (object.id === drag.objectId
            ? { ...object.transform, x: drag.startTx, y: drag.startTy }
            : undefined);
        return start === undefined ? object : { ...object, transform: start };
      }),
    },
  };
}
