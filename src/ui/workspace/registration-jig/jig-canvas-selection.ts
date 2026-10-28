import {
  buildSelectionTransformEdit,
  isRegistrationBox,
  sceneObjectHasVisibleLayer,
  selectionMetrics,
  type Project,
  type Scene,
  type SceneObject,
  type SelectionTransform,
  type Vec2,
} from '../../../core/scene';
import { HANDLE_SCREEN_PX, type HandleKind } from '../handles';
import {
  hitSelectionRotateHandle,
  pointerAngleDeg,
  rotateObjectRelative,
  rotateSelectionByDrag,
  selectionRotateAnchor,
} from '../rotate-handle';
import {
  aabbHandlePoints,
  hitAabbHandle,
  resizeEditSetsSize,
  selectionResizeEditFromDrag,
} from '../selection-handles';
import { withObjectTransform } from '../../../core/shapes/rectangle-resize';
import { selectObjectsInMarquee } from '../selection-marquee';

/** Objects the jig canvas may select: unlocked, on a visible layer. Locked
 * outlines, including burned ones, are never selectable. */
export function jigSelectableObjects(scene: Scene): ReadonlyArray<SceneObject> {
  return scene.objects.filter(
    (object) => object.locked !== true && sceneObjectHasVisibleLayer(scene, object),
  );
}

/** The selected objects a canvas gesture or field edit may change. */
export function jigEditableSelection(
  project: Project,
  selectedIds: ReadonlySet<string>,
): ReadonlyArray<SceneObject> {
  return jigSelectableObjects(project.scene).filter((object) => selectedIds.has(object.id));
}

// Every object sharing a group with one of `ids`, overlapping groups included.
function jigGroupClosure(scene: Scene, ids: Iterable<string>): ReadonlySet<string> {
  const closure = new Set(ids);
  let previousSize = 0;
  while (previousSize !== closure.size) {
    previousSize = closure.size;
    for (const group of scene.groups ?? []) {
      if (group.objectIds.some((id) => closure.has(id))) {
        for (const id of group.objectIds) closure.add(id);
      }
    }
  }
  return closure;
}

export function jigSelectionForHit(
  scene: Scene,
  hitId: string,
  selectedIds: ReadonlySet<string>,
  additive: boolean,
): ReadonlySet<string> {
  const groupIds = jigGroupClosure(scene, [hitId]);
  const selectable = jigSelectableObjects(scene);
  const next = new Set(additive || selectedIds.has(hitId) ? selectedIds : []);
  const removing = additive && selectedIds.has(hitId);
  for (const object of selectable) {
    if (!groupIds.has(object.id)) continue;
    if (removing) next.delete(object.id);
    else next.add(object.id);
  }
  return new Set(selectable.filter((object) => next.has(object.id)).map((object) => object.id));
}

/** Ctrl+A: all the artwork the canvas could select. Outlines are left out;
 * Jig layout has its own Select all outlines. */
export function jigSelectAll(scene: Scene): ReadonlySet<string> {
  return new Set(
    jigSelectableObjects(scene)
      .filter((object) => !isRegistrationBox(object))
      .map((object) => object.id),
  );
}

/** Adds what the marquee catches (left to right: enclosed; right to left:
 * touched, as on the main canvas) to `selectedIds`, with whole groups. */
export function jigSelectionInMarquee(
  scene: Scene,
  start: Vec2,
  end: Vec2,
  selectedIds: ReadonlySet<string>,
): ReadonlySet<string> {
  const caught = jigGroupClosure(scene, selectObjectsInMarquee(scene, start, end));
  return new Set(
    jigSelectableObjects(scene)
      .filter((object) => selectedIds.has(object.id) || caught.has(object.id))
      .map((object) => object.id),
  );
}

export type JigHandle =
  | { readonly kind: 'resize'; readonly handle: HandleKind }
  | { readonly kind: 'rotate' };

/** The resize or rotate handle of the selection bounds under `point`. */
export function jigHandleAt(
  objects: ReadonlyArray<SceneObject>,
  point: Vec2,
  pxToMm: number,
): JigHandle | null {
  const metrics = selectionMetrics(objects);
  if (metrics === null) return null;
  const { minX, minY, maxX, maxY } = metrics.bbox;
  // Overlapping fixed-pixel handles must leave small artwork an interior move
  // target. The handle portions on and outside the bounds remain available.
  const handleSize = HANDLE_SCREEN_PX * pxToMm;
  if (
    (maxX - minX <= handleSize || maxY - minY <= handleSize) &&
    point.x > minX &&
    point.x < maxX &&
    point.y > minY &&
    point.y < maxY
  )
    return null;
  const handle = hitAabbHandle(metrics.bbox, point, pxToMm);
  if (handle !== null) return { kind: 'resize', handle };
  return hitSelectionRotateHandle(objects, point, pxToMm) ? { kind: 'rotate' } : null;
}

export function moveJigSelection(
  project: Project,
  selectedIds: ReadonlySet<string>,
  dx: number,
  dy: number,
): Project {
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0)) return project;
  return withJigTransforms(
    project,
    jigEditableSelection(project, selectedIds).map((object) => ({
      id: object.id,
      transform: { ...object.transform, x: object.transform.x + dx, y: object.transform.y + dy },
    })),
  );
}

export type JigHandleDrag = {
  /** Scene point where the drag began, and where the pointer is now. */
  readonly start: Vec2;
  readonly point: Vec2;
};

export type JigResizeResult = {
  readonly project: Project;
  /** True when the drag asked for a stretch that rotated artwork cannot take. */
  readonly refused: boolean;
};

/** Resize the selection bounds from a handle about the opposite corner or
 * edge, with the main canvas's group resize. The handle moves with the
 * pointer from where it was grabbed, so a click never jumps the size. */
export function resizeJigSelection(
  project: Project,
  selectedIds: ReadonlySet<string>,
  drag: JigHandleDrag & { readonly handle: HandleKind; readonly lockAspect: boolean },
): JigResizeResult {
  const unchanged = { project, refused: false };
  const objects = jigEditableSelection(project, selectedIds);
  const metrics = selectionMetrics(objects);
  const grab = aabbHandlePoints(metrics?.bbox ?? NO_BOUNDS).find((h) => h.kind === drag.handle);
  const delta = dragDelta(drag);
  if (metrics === null || grab === undefined || delta === null) return unchanged;
  const edit = selectionResizeEditFromDrag({
    handle: drag.handle,
    bbox: metrics.bbox,
    point: { x: grab.position.x + delta.x, y: grab.position.y + delta.y },
    lockAspect: drag.lockAspect,
  });
  if (!resizeEditSetsSize(edit)) return unchanged;
  const result = buildSelectionTransformEdit(objects, edit);
  if (result.kind === 'error')
    return { project, refused: result.reason === 'non-uniform-rotated-selection' };
  return { project: withJigTransforms(project, result.transforms), refused: false };
}

/** Rotate the selection about the centre of its bounds by the angle the
 * pointer has swept since the grab. `snap` (Shift) uses 15 degree steps: of
 * the absolute angle for one object, of the turn for several. */
export function rotateJigSelection(
  project: Project,
  selectedIds: ReadonlySet<string>,
  drag: JigHandleDrag & { readonly snap: boolean },
): Project {
  const objects = jigEditableSelection(project, selectedIds);
  const anchor = selectionRotateAnchor(objects);
  if (anchor === null || dragDelta(drag) === null) return project;
  const rotation = {
    anchor,
    startPointerAngleDeg: pointerAngleDeg(anchor, drag.start),
    dragTo: drag.point,
    snap: drag.snap,
  };
  const [only] = objects;
  const transforms =
    objects.length === 1 && only !== undefined
      ? [
          {
            id: only.id,
            transform: rotateObjectRelative({ ...rotation, startTransform: only.transform }),
          },
        ]
      : rotateSelectionByDrag({
          ...rotation,
          startTransforms: objects.map(({ id, transform }) => ({ id, transform })),
        });
  return withJigTransforms(project, transforms);
}

const NO_BOUNDS = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

// The pointer's travel since the grab; null for a click or a bad point.
function dragDelta(drag: JigHandleDrag): Vec2 | null {
  const x = drag.point.x - drag.start.x;
  const y = drag.point.y - drag.start.y;
  if (!Number.isFinite(x) || !Number.isFinite(y) || (x === 0 && y === 0)) return null;
  return { x, y };
}

/** The project with these objects' transforms replaced; the same project when
 * nothing actually changes, so a no-op never becomes an undo step. */
export function withJigTransforms(
  project: Project,
  transforms: ReadonlyArray<SelectionTransform>,
): Project {
  const byId = new Map(transforms.map((item) => [item.id, item.transform]));
  let changed = false;
  const objects = project.scene.objects.map((object) => {
    const transform = byId.get(object.id);
    if (transform === undefined || sameTransform(transform, object.transform)) return object;
    changed = true;
    return withObjectTransform(object, transform);
  });
  return changed ? { ...project, scene: { ...project.scene, objects } } : project;
}

function sameTransform(a: SceneObject['transform'], b: SceneObject['transform']): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof typeof a>;
  return [...keys].every((key) => a[key] === b[key]);
}
