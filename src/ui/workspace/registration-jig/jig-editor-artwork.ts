import {
  findRegistrationBoxes,
  isRegistrationBox,
  removeObject,
  sceneObjectHasVisibleLayer,
  transformedBBox,
  type Scene,
  type SceneObject,
  type TextObject,
  type TracedImage,
} from '../../../core/scene';
import { reliefAuthoringLinkIds } from '../../../core/relief/relief-authoring-link-ids';
import { registrationJigArtworkInstances } from '../../../core/scene/registration-jig-artwork';
import { applyFreshImport, applyUpsertText, pruneOrphanLayers } from '../../state/scene-mutations';
import { removeObjectIdsFromGroups } from '../../state/scene-group-actions';
import { repairDanglingObjectDependencies } from '../../state/object-delete-actions';
import { applyCenterArtworkInRegistrationJigSet } from '../../state/registration-jig-artwork-actions';
import { applyRegistrationOutput } from '../../state/registration-output-actions';
import { fitJigArtwork, jigOutlineAt } from './fit-jig-artwork';
import { replaceJigImageWithTrace } from './jig-image-trace';
import {
  changeJigDraft,
  selectedJigIds,
  selectJigObjects,
  type JigDraft,
  type JigEditorSession,
} from './jig-editor-session';

/** Which outline an import fits into: the anchor outline (by selection), then
 *  one outline further along for each later file in the same batch. */
export type JigImportPlacement = {
  readonly anchorIds: ReadonlySet<string>;
  readonly batchIndex: number;
  /** One design for the whole jig (ADR-638): after fitting, it is centred in
   *  the first outline and copied into every other one, in the same edit. */
  readonly copyToEveryOutline?: boolean;
};

export function importJigArtwork(
  session: JigEditorSession,
  object: SceneObject,
  placement: JigImportPlacement = {
    anchorIds: selectedJigIds(session.draft),
    batchIndex: 0,
    copyToEveryOutline: true,
  },
): JigEditorSession {
  let draft: JigDraft = {
    ...session.draft,
    ...applyFreshImport({ ...session.draft, undoStack: [] }, object, 0),
  };
  const fitted = fitJigArtwork(
    object,
    session.draft.project.scene,
    placement.anchorIds,
    placement.batchIndex,
  );
  if (fitted !== object) {
    draft = {
      ...draft,
      project: {
        ...draft.project,
        scene: {
          ...draft.project.scene,
          objects: draft.project.scene.objects.map((item) =>
            item.id === object.id ? { ...item, transform: fitted.transform } : item,
          ),
        },
      },
    };
  }
  const imported = finishArtworkEdit(session, draft);
  return placement.copyToEveryOutline === true ? copyToEveryOutline(imported, object.id) : imported;
}

// The artwork already fits its outline, so the copies keep its size; a design
// larger than the outline still shrinks to fit inside it.
function copyToEveryOutline(session: JigEditorSession, id: string): JigEditorSession {
  if (findRegistrationBoxes(session.draft.project.scene).length < 2) return session;
  const selected = selectJigObjects(session, new Set([id]));
  return changeJigDraft(
    selected,
    applyCenterArtworkInRegistrationJigSet({ ...selected.draft, undoStack: [] }, { grow: false }),
  );
}

/** New text is copied to every piece at its own size; updating one copy's text
 *  changes only that copy, so each piece can carry its own name. */
export function upsertJigText(session: JigEditorSession, object: TextObject): JigEditorSession {
  const project = session.draft.project;
  const exists = project.scene.objects.some((item) => item.id === object.id);
  const patch = exists
    ? {
        project: {
          ...project,
          scene: {
            ...project.scene,
            objects: project.scene.objects.map((item) => (item.id === object.id ? object : item)),
          },
        },
      }
    : applyUpsertText({ ...session.draft, undoStack: [] }, object);
  const positioned = {
    ...patch.project,
    scene: {
      ...patch.project.scene,
      objects: patch.project.scene.objects.map((item) =>
        item.id === object.id ? { ...item, transform: object.transform } : item,
      ),
    },
  };
  const upserted = finishArtworkEdit(session, {
    ...session.draft,
    ...patch,
    project: positioned,
    selectedObjectId: object.id,
    additionalSelectedIds: new Set(),
  });
  return exists ? upserted : copyToEveryOutline(upserted, object.id);
}

/** Replaces a jig image and its outline copies with a trace of it (ADR-633). */
export function traceJigImage(
  session: JigEditorSession,
  imageId: string,
  traced: TracedImage,
): JigEditorSession {
  const draft = replaceJigImageWithTrace(session.draft, imageId, traced);
  return draft === null ? session : finishArtworkEdit(session, draft);
}

function finishArtworkEdit(session: JigEditorSession, initial: JigDraft): JigEditorSession {
  let draft = initial;
  const previous = session.draft.registrationArtworkOutputSnapshot;
  if (previous !== null) {
    const snapshot = { ...previous };
    for (const layer of draft.project.scene.layers) {
      if (!(layer.id in snapshot)) snapshot[layer.id] = layer.output;
    }
    draft = {
      ...draft,
      ...applyRegistrationOutput(
        { ...draft, undoStack: [], registrationArtworkOutputSnapshot: snapshot },
        'box',
      ),
    };
  }
  return changeJigDraft(session, draft);
}

export function nudgeJigSelection(
  session: JigEditorSession,
  dx: number,
  dy: number,
): JigEditorSession {
  const ids = selectedJigIds(session.draft);
  const project = session.draft.project;
  const objects = project.scene.objects.map((object) => {
    if (
      !ids.has(object.id) ||
      object.locked === true ||
      !sceneObjectHasVisibleLayer(project.scene, object)
    )
      return object;
    return {
      ...object,
      transform: { ...object.transform, x: object.transform.x + dx, y: object.transform.y + dy },
    };
  });
  return changeJigDraft(session, { project: { ...project, scene: { ...project.scene, objects } } });
}

export type JigArtworkDeletion = {
  readonly session: JigEditorSession;
  readonly repairs: Pick<
    ReturnType<typeof repairDanglingObjectDependencies>,
    'repairedImageMasks' | 'repairedPathTextGuides'
  > | null;
};

// Pure: the caller reports the dependency repairs after updating its state,
// never from inside a React state updater.
export function deleteJigArtworkWithRepairs(session: JigEditorSession): JigArtworkDeletion {
  return deleteJigArtworkIds(session, selectedJigIds(session.draft));
}

/** Clear canvas (ADR-638): removes the artwork in the jig's pieces and keeps
 *  the outlines and every design outside them. */
export function clearJigArtwork(session: JigEditorSession): JigArtworkDeletion {
  return deleteJigArtworkIds(session, jigArtworkIds(session.draft.project.scene));
}

/** The artwork Clear canvas removes: every copy that belongs to a jig piece,
 *  and any other unlocked, visible artwork whose centre sits inside an outline
 *  (artwork fitted into one outline but not yet copied, say). */
export function jigArtworkIds(scene: Scene): ReadonlySet<string> {
  const outlines = findRegistrationBoxes(scene);
  const members = new Set(
    registrationJigArtworkInstances(scene).flatMap((instance) =>
      instance.objects.map((object) => object.id),
    ),
  );
  const ids = scene.objects
    .filter(
      (object) =>
        !isRegistrationBox(object) &&
        object.locked !== true &&
        sceneObjectHasVisibleLayer(scene, object) &&
        (members.has(object.id) || jigOutlineAt(outlines, boundsCentre(object)) >= 0),
    )
    .map((object) => object.id);
  return new Set(ids);
}

function boundsCentre(object: SceneObject): { readonly x: number; readonly y: number } {
  const bounds = transformedBBox(object);
  return { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
}

/** Deletes the given unlocked, visible artwork; outlines are never deleted, and
 *  neither is artwork a kept relief still uses as its source. */
export function deleteJigArtworkIds(
  session: JigEditorSession,
  ids: ReadonlySet<string>,
): JigArtworkDeletion {
  let scene = session.draft.project.scene;
  const usedByKeptRelief = new Set(
    scene.objects.flatMap((object) =>
      !ids.has(object.id) &&
      object.kind === 'relief' &&
      'reliefAuthoring' in object &&
      object.reliefAuthoring !== undefined
        ? reliefAuthoringLinkIds(object.reliefAuthoring)
        : [],
    ),
  );
  const removed = new Set<string>();
  for (const object of scene.objects) {
    if (
      ids.has(object.id) &&
      !usedByKeptRelief.has(object.id) &&
      !isRegistrationBox(object) &&
      object.locked !== true &&
      sceneObjectHasVisibleLayer(scene, object)
    ) {
      scene = removeObject(scene, object.id);
      removed.add(object.id);
    }
  }
  if (removed.size === 0) return { session, repairs: null };
  const repaired = repairDanglingObjectDependencies(removeObjectIdsFromGroups(scene, removed));
  scene = pruneOrphanLayers(repaired.scene);
  const previousSnapshot =
    session.draft.registrationArtworkOutputSnapshot ??
    session.draft.project.registrationArtworkOutputSnapshot;
  const liveOperations = new Set(scene.layers.map((layer) => layer.id));
  const snapshot =
    previousSnapshot == null
      ? null
      : Object.fromEntries(
          Object.entries(previousSnapshot).filter(([id]) => liveOperations.has(id)),
        );
  const next = changeJigDraft(session, {
    project: {
      ...session.draft.project,
      scene,
      ...(snapshot === null ? {} : { registrationArtworkOutputSnapshot: snapshot }),
    },
    registrationArtworkOutputSnapshot: snapshot,
    selectedObjectId: null,
    additionalSelectedIds: new Set(),
  });
  return { session: next, repairs: repaired };
}
