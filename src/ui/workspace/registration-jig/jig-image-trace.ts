import {
  isRegistrationBox,
  removeObject,
  sceneObjectHasVisibleLayer,
  type RasterImage,
  type Scene,
  type SceneObject,
  type TracedImage,
} from '../../../core/scene';
import {
  createRegistrationJigCopyIdAllocator,
  registrationJigObjectIdentity,
  registrationJigReplacedArtworkIds,
  withRegistrationJigChild,
} from '../../../core/scene/registration-jig-artwork';
import { applyTraceToExisting, positionTraceOverRasterSource } from '../../state/scene-mutations';
import type { JigDraft } from './jig-editor-session';

/** The image the jig tracer can replace: the one selected, unlocked, visible bitmap. */
export function jigTraceableImage(
  scene: Scene,
  selectedIds: ReadonlySet<string>,
): RasterImage | null {
  if (selectedIds.size !== 1) return null;
  const [id] = selectedIds;
  const object = scene.objects.find((candidate) => candidate.id === id);
  return object?.kind === 'raster-image' &&
    object.locked !== true &&
    !isRegistrationBox(object) &&
    sceneObjectHasVisibleLayer(scene, object)
    ? object
    : null;
}

/** An image and the copies Centre + copy made of it in the other outlines. */
export type JigImageTraceTargets = {
  readonly image: RasterImage;
  readonly copies: ReadonlyArray<RasterImage>;
};

// Centre + copy puts the same artwork in every outline, so tracing any one of
// those images traces them all; the trace takes over the original's place.
export function jigImageTraceTargets(scene: Scene, imageId: string): JigImageTraceTargets | null {
  const selected = scene.objects.find((object) => object.id === imageId);
  if (selected?.kind !== 'raster-image') return null;
  const image = copiedFrom(scene, selected);
  const copyIds = registrationJigReplacedArtworkIds(scene, new Set([image.id]));
  const copies = scene.objects.filter(
    (object): object is RasterImage => object.kind === 'raster-image' && copyIds.has(object.id),
  );
  return { image, copies };
}

function copiedFrom(scene: Scene, image: RasterImage): RasterImage {
  let original = image;
  for (const ancestor of registrationJigObjectIdentity(image)?.ancestors ?? []) {
    if (ancestor.kind !== 'copy') break;
    const source = scene.objects.find((object) => object.id === ancestor.sourceId);
    if (source?.kind === 'raster-image') original = source;
  }
  return original;
}

/**
 * Replaces a jig image and its copies with the trace, each laid exactly over
 * the bitmap it replaces and kept in that bitmap's stacking, run and group
 * position. The images' Image operation goes when nothing else uses it, so the
 * trace takes the first free operation colour (as Trace Image with the source
 * deleted does on the main canvas). Returns null when the image is gone.
 */
export function replaceJigImageWithTrace(
  draft: JigDraft,
  imageId: string,
  traced: TracedImage,
): JigDraft | null {
  const scene = draft.project.scene;
  const targets = jigImageTraceTargets(scene, imageId);
  if (targets === null) return null;
  const withoutCopies = targets.copies.reduce(
    (current, copy) => removeObject(current, copy.id),
    scene,
  );
  const result = applyTraceToExisting(
    { ...draft, project: { ...draft.project, scene: withoutCopies }, undoStack: [] },
    targets.image.id,
    traced,
    { deleteSourceAfterTrace: true },
  );
  const traceScene = result.project.scene;
  const created = traceScene.objects.find((object) => object.id === traced.id);
  if (created?.kind !== 'traced-image') return null;
  const trace = withImageIdentity(created, targets.image);
  const replacements = new Map<string, SceneObject>([[targets.image.id, trace]]);
  const allocateCopyId = createRegistrationJigCopyIdAllocator(scene, new Set([trace.id]));
  for (const copy of targets.copies) {
    const boxId = registrationJigObjectIdentity(copy)?.boxId;
    if (boxId === undefined) continue;
    const placed = { ...trace, id: allocateCopyId(trace.id, boxId) };
    const transform = positionTraceOverRasterSource(copy, traced).transform;
    replacements.set(
      copy.id,
      withRegistrationJigChild(trace, { ...placed, transform }, boxId, 'copy'),
    );
  }
  return {
    ...draft,
    project: { ...result.project, scene: inPlace(scene, traceScene, replacements) },
    selectedObjectId: trace.id,
    additionalSelectedIds: new Set(),
  };
}

function withImageIdentity(trace: TracedImage, image: RasterImage): TracedImage {
  const identity = registrationJigObjectIdentity(image);
  return identity === null
    ? trace
    : { ...trace, registrationJig: { ...identity, objectId: trace.id } };
}

// Rebuild the order from the scene before the trace, swapping each image for
// its trace; every other object and the operations come from the traced scene.
function inPlace(
  before: Scene,
  traced: Scene,
  replacements: ReadonlyMap<string, SceneObject>,
): Scene {
  const live = new Map(traced.objects.map((object) => [object.id, object]));
  const swap = (id: string): string => replacements.get(id)?.id ?? id;
  return {
    ...traced,
    objects: before.objects.flatMap((object) => {
      const next = replacements.get(object.id) ?? live.get(object.id);
      return next === undefined ? [] : [next];
    }),
    ...(before.artworkOrder === undefined ? {} : { artworkOrder: before.artworkOrder.map(swap) }),
    ...(before.groups === undefined
      ? {}
      : {
          groups: before.groups.map((group) => ({
            ...group,
            objectIds: group.objectIds.map(swap),
          })),
        }),
    ...(before.designTreeOrder === undefined
      ? {}
      : {
          designTreeOrder: before.designTreeOrder.map((ref) =>
            ref.kind === 'object' ? { ...ref, id: swap(ref.id) } : ref,
          ),
        }),
  };
}
