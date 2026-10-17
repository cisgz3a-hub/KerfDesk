import {
  isRegistrationBox,
  removeObject,
  sceneObjectHasVisibleLayer,
  type SceneObject,
  type TextObject,
} from '../../../core/scene';
import { applyFreshImport, applyUpsertText, pruneOrphanLayers } from '../../state/scene-mutations';
import { removeObjectIdsFromGroups } from '../../state/scene-group-actions';
import {
  repairDanglingObjectDependencies,
  reportDependencyRepairs,
} from '../../state/object-delete-actions';
import { applyRegistrationOutput } from '../../state/registration-output-actions';
import { fitJigArtwork } from './fit-jig-artwork';
import {
  changeJigDraft,
  selectedJigIds,
  type JigDraft,
  type JigEditorSession,
} from './jig-editor-session';

export function importJigArtwork(session: JigEditorSession, object: SceneObject): JigEditorSession {
  let draft: JigDraft = {
    ...session.draft,
    ...applyFreshImport({ ...session.draft, undoStack: [] }, object, 0),
  };
  const fitted = fitJigArtwork(object, session.draft.project.scene, selectedJigIds(session.draft));
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
  return finishArtworkEdit(session, draft);
}

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
  return finishArtworkEdit(session, {
    ...session.draft,
    ...patch,
    project: positioned,
    selectedObjectId: object.id,
    additionalSelectedIds: new Set(),
  });
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

export function deleteJigArtwork(session: JigEditorSession): JigEditorSession {
  const ids = selectedJigIds(session.draft);
  let scene = session.draft.project.scene;
  const removed = new Set<string>();
  for (const object of scene.objects) {
    if (
      ids.has(object.id) &&
      !isRegistrationBox(object) &&
      object.locked !== true &&
      sceneObjectHasVisibleLayer(scene, object)
    ) {
      scene = removeObject(scene, object.id);
      removed.add(object.id);
    }
  }
  if (removed.size === 0) return session;
  const repaired = repairDanglingObjectDependencies(removeObjectIdsFromGroups(scene, removed));
  reportDependencyRepairs(repaired);
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
  return changeJigDraft(session, {
    project: {
      ...session.draft.project,
      scene,
      ...(snapshot === null ? {} : { registrationArtworkOutputSnapshot: snapshot }),
    },
    registrationArtworkOutputSnapshot: snapshot,
    selectedObjectId: null,
    additionalSelectedIds: new Set(),
  });
}
