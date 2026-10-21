import {
  findRegistrationBoxes,
  transformedBBox,
  type AABB,
  type Project,
  type Scene,
} from '../../../core/scene';
import { registrationJigArtworkInstances } from '../../../core/scene/registration-jig-artwork';
import { sceneObjectCopyClosure } from '../../state/scene-object-copy-dependencies';

// The jig editor opens on a clean canvas (ADR-650): it shows the jig's outlines
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
  const outlines = boxes.map(transformedBBox);
  for (const object of scene.objects)
    if (sitsOnOutline(transformedBBox(object), outlines)) members.add(object.id);
  // Groups stay whole, and masks and path guides travel with what uses them.
  for (const group of scene.groups ?? [])
    if (group.objectIds.some((id) => members.has(id)))
      for (const id of group.objectIds) members.add(id);
  const shown = new Set(sceneObjectCopyClosure(scene.objects, members).map((object) => object.id));
  return new Set(
    scene.objects.filter((object) => !shown.has(object.id)).map((object) => object.id),
  );
}

const SIZE_TOLERANCE_MM = 1;

// Centred inside an outline and no larger than it: a bigger design that merely
// covers the jig is main-canvas artwork, not a piece's artwork.
function sitsOnOutline(bounds: AABB, outlines: ReadonlyArray<AABB>): boolean {
  const x = (bounds.minX + bounds.maxX) / 2;
  const y = (bounds.minY + bounds.maxY) / 2;
  return outlines.some(
    (outline) =>
      x >= outline.minX &&
      x <= outline.maxX &&
      y >= outline.minY &&
      y <= outline.maxY &&
      bounds.maxX - bounds.minX <= outline.maxX - outline.minX + SIZE_TOLERANCE_MM &&
      bounds.maxY - bounds.minY <= outline.maxY - outline.minY + SIZE_TOLERANCE_MM,
  );
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
