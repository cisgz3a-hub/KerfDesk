import {
  applyTransform,
  findRegistrationBoxes,
  type AABB,
  type Project,
  type Scene,
  type SceneObject,
  type Vec2,
} from '../../../core/scene';
import { reliefAuthoringLinkIds } from '../../../core/relief/relief-authoring-link-ids';
import { registrationJigArtworkInstances } from '../../../core/scene/registration-jig-artwork';
import { sceneObjectCopyDependencyIds } from '../../state/scene-object-copy-dependencies';
import { maxOf, minOf } from '../../../core/util';

// The jig editor opens on a clean canvas (ADR-652): it shows the jig's outlines
// and the artwork that belongs to them, never the rest of the main canvas. That
// other artwork stays in the draft so a save still merges one whole project,
// but the editor never draws, selects or changes it.

/** Main-canvas objects the editor keeps out of view: all of them before a jig
 *  exists, otherwise everything that is not the jig's own. */
export function jigBackgroundIds(scene: Scene): ReadonlySet<string> {
  const boxes = findRegistrationBoxes(scene);
  if (boxes.length === 0) return new Set(scene.objects.map((object) => object.id));
  const members = new Set<string>(boxes.map((box) => box.id));
  for (const instance of registrationJigArtworkInstances(scene))
    for (const object of instance.objects) members.add(object.id);
  // Artwork imported into an outline carries no jig identity until it is
  // copied, so artwork that sits on an outline belongs to the jig as well.
  for (const object of scene.objects)
    if (boxes.some((box) => sitsOnOutline(object, box))) members.add(object.id);
  closeOver(scene, members);
  return new Set(
    scene.objects.filter((object) => !members.has(object.id)).map((object) => object.id),
  );
}

// Nothing the editor can change may reach hidden artwork, so grow the jig until
// it is closed: whole groups (overlapping ones too), the masks, path guides,
// trace sources and relief links its artwork uses, and every other artwork that
// shares them or links to it.
function closeOver(scene: Scene, members: Set<string>): void {
  const uses = scene.objects.map((object) => ({
    id: object.id,
    dependencies: [
      ...sceneObjectCopyDependencyIds(object),
      ...traceSourceLink(object),
      ...reliefLinks(object),
    ],
  }));
  for (let grew = true; grew; ) {
    const before = members.size;
    for (const group of scene.groups ?? [])
      if (group.objectIds.some((id) => members.has(id)))
        for (const id of group.objectIds) members.add(id);
    for (const { id, dependencies } of uses) {
      if (members.has(id)) for (const dependency of dependencies) members.add(dependency);
      else if (dependencies.some((dependency) => members.has(dependency))) members.add(id);
    }
    grew = members.size !== before;
  }
}

// A trace's kept picture is no copy dependency (ADR-673), but Re-trace Original
// reads and can delete it, so it still belongs to the trace's jig.
function traceSourceLink(object: SceneObject): readonly string[] {
  return 'traceSourceId' in object && object.traceSourceId !== undefined
    ? [object.traceSourceId]
    : [];
}

// A retained relief keeps links to the vectors it was authored from.
function reliefLinks(object: SceneObject): readonly string[] {
  if (object.kind !== 'relief' || !('reliefAuthoring' in object)) return [];
  return object.reliefAuthoring === undefined ? [] : reliefAuthoringLinkIds(object.reliefAuthoring);
}

const SIZE_TOLERANCE_MM = 1;

// Centred inside the outline's own rectangle or ellipse, and no larger than the
// outline: a bigger design that merely covers the jig is main-canvas artwork.
// Both are measured in the outline's own frame, so a rotated outline is not
// mistaken for its larger bounding box.
function sitsOnOutline(object: SceneObject, outline: SceneObject): boolean {
  const b = object.bounds;
  const corners = [
    { x: b.minX, y: b.minY },
    { x: b.maxX, y: b.minY },
    { x: b.maxX, y: b.maxY },
    { x: b.minX, y: b.maxY },
  ].flatMap((corner) => toLocal(applyTransform(corner, object.transform), outline) ?? []);
  if (corners.length < 4) return false;
  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  const local = outline.bounds;
  const sx = Math.abs(outline.transform.scaleX);
  const sy = Math.abs(outline.transform.scaleY);
  if (
    (maxOf(xs) - minOf(xs)) * sx > (local.maxX - local.minX) * sx + SIZE_TOLERANCE_MM ||
    (maxOf(ys) - minOf(ys)) * sy > (local.maxY - local.minY) * sy + SIZE_TOLERANCE_MM
  )
    return false;
  const centre = {
    x: (maxOf(xs) + minOf(xs)) / 2,
    y: (maxOf(ys) + minOf(ys)) / 2,
  };
  if (outline.kind === 'shape' && outline.spec.kind === 'ellipse') {
    const rx = (local.maxX - local.minX) / 2;
    const ry = (local.maxY - local.minY) / 2;
    if (rx <= 0 || ry <= 0) return false;
    const dx = (centre.x - (local.minX + rx)) / rx;
    const dy = (centre.y - (local.minY + ry)) / ry;
    return dx * dx + dy * dy <= 1;
  }
  return inside(centre, local);
}

function inside(point: Vec2, bounds: AABB): boolean {
  return (
    point.x >= bounds.minX &&
    point.x <= bounds.maxX &&
    point.y >= bounds.minY &&
    point.y <= bounds.maxY
  );
}

// The inverse of applyTransform: translate, rotate, mirror, then scale back.
function toLocal(point: Vec2, object: SceneObject): Vec2 | null {
  const t = object.transform;
  if (t.scaleX === 0 || t.scaleY === 0) return null;
  const rad = (-t.rotationDeg * Math.PI) / 180;
  const dx = point.x - t.x;
  const dy = point.y - t.y;
  let x = dx * Math.cos(rad) - dy * Math.sin(rad);
  let y = dx * Math.sin(rad) + dy * Math.cos(rad);
  if (t.mirrorX) x = -x;
  if (t.mirrorY) y = -y;
  return { x: x / t.scaleX, y: y / t.scaleY };
}

/** The project the jig canvas and sidebar see: the draft without the background. */
export function jigViewProject(project: Project, background: ReadonlySet<string>): Project {
  if (background.size === 0) return project;
  const objects = project.scene.objects.filter((object) => !background.has(object.id));
  if (objects.length === project.scene.objects.length) return project;
  return { ...project, scene: { ...project.scene, objects } };
}

/** Folds an edit made on the view back into the whole draft. Background objects
 *  keep their place and content; objects new to the edit go on top. */
export function withJigBackground(
  draft: Project,
  edited: Project,
  background: ReadonlySet<string>,
): Project {
  if (background.size === 0 || edited === draft) return edited;
  const editedById = new Map(edited.scene.objects.map((object) => [object.id, object]));
  const draftIds = new Set(draft.scene.objects.map((object) => object.id));
  const objects = [
    ...draft.scene.objects.flatMap((object) => {
      if (background.has(object.id)) return [object];
      const next = editedById.get(object.id);
      return next === undefined ? [] : [next];
    }),
    ...edited.scene.objects.filter((object) => !draftIds.has(object.id)),
  ];
  return { ...edited, scene: { ...edited.scene, objects } };
}
