import {
  findRegistrationBoxes,
  isRegistrationBox,
  REGISTRATION_LAYER_ID,
  type Project,
} from '../../../core/scene';
import type { AppState } from '../../state/store';
import {
  applyReplaceRegistrationJigSet,
  type RegistrationJigSetSpec,
} from '../../state/registration-jig-set-actions';
import { applyCenterArtworkInRegistrationJigSet } from '../../state/registration-jig-artwork-actions';
import { applyRemoveRegistrationBox } from '../../state/registration-box-actions';
import { applyRegistrationOutput } from '../../state/registration-output-actions';
import { pushUndo } from '../../state/scene-mutations';

export type JigDraft = Pick<
  AppState,
  'project' | 'selectedObjectId' | 'additionalSelectedIds' | 'registrationArtworkOutputSnapshot'
>;

export type JigEditorSession = {
  readonly baseProject: Project;
  readonly documentEpoch: number;
  readonly firstSave: boolean;
  readonly draft: JigDraft;
  readonly past: ReadonlyArray<JigDraft>;
  readonly future: ReadonlyArray<JigDraft>;
};

export function createJigEditorSession(state: AppState): JigEditorSession {
  const boxes = findRegistrationBoxes(state.project.scene);
  let draft: JigDraft = {
    project: editableProject(state.project),
    selectedObjectId: state.selectedObjectId,
    additionalSelectedIds: state.additionalSelectedIds,
    registrationArtworkOutputSnapshot:
      state.project.registrationArtworkOutputSnapshot ?? state.registrationArtworkOutputSnapshot,
  };
  if (boxes.length === 0) {
    const created = applyReplaceRegistrationJigSet(
      { ...draft, undoStack: [] },
      {
        outline: { kind: 'rectangle', widthMm: 80, heightMm: 40 },
        rows: 1,
        columns: 1,
        spacingX: 5,
        spacingY: 5,
      },
      () => crypto.randomUUID(),
    );
    draft = { ...draft, ...created };
    if (state.selectedObjectId !== null) {
      draft = {
        ...draft,
        selectedObjectId: state.selectedObjectId,
        additionalSelectedIds: state.additionalSelectedIds,
      };
    }
  }
  return {
    baseProject: state.project,
    documentEpoch: state.projectDocumentEpoch,
    firstSave: boxes.length === 0,
    draft,
    past: [],
    future: [],
  };
}

function editableProject(project: Project): Project {
  return {
    ...project,
    scene: {
      ...project.scene,
      objects: project.scene.objects.map((object) =>
        isRegistrationBox(object) &&
        object.kind === 'shape' &&
        object.provenance !== 'captured-board'
          ? { ...object, locked: false }
          : object,
      ),
    },
  };
}

export function selectedJigIds(draft: JigDraft): ReadonlySet<string> {
  return new Set([
    ...(draft.selectedObjectId === null ? [] : [draft.selectedObjectId]),
    ...draft.additionalSelectedIds,
  ]);
}

export function selectJigObjects(
  session: JigEditorSession,
  ids: ReadonlySet<string>,
): JigEditorSession {
  const [first, ...rest] = ids;
  return {
    ...session,
    draft: {
      ...session.draft,
      selectedObjectId: first ?? null,
      additionalSelectedIds: new Set(rest),
    },
  };
}

export function changeJigDraft(
  session: JigEditorSession,
  patch: Partial<JigDraft>,
): JigEditorSession {
  const draft = { ...session.draft, ...patch };
  if (
    draft.project === session.draft.project &&
    draft.registrationArtworkOutputSnapshot === session.draft.registrationArtworkOutputSnapshot
  )
    return session;
  return { ...session, draft, past: [...session.past, session.draft].slice(-50), future: [] };
}

export function replaceJigLayout(
  session: JigEditorSession,
  spec: RegistrationJigSetSpec,
): JigEditorSession {
  const previous = session.draft.project.scene.layers;
  const result = applyReplaceRegistrationJigSet({ ...session.draft, undoStack: [] }, spec, () =>
    crypto.randomUUID(),
  );
  const project = result.project;
  if (project === undefined || project === session.draft.project) return session;
  // The legacy creation action selects Artwork only. Rebuilding a draft must
  // preserve the operator's current run and its saved artwork output intent.
  const scene = {
    ...project.scene,
    layers: project.scene.layers.map((layer) => {
      const existing = previous.find((candidate) => candidate.id === layer.id);
      return existing === undefined ? layer : { ...layer, output: existing.output };
    }),
  };
  return changeJigDraft(session, { ...result, project: { ...project, scene } });
}

export function centerJigArtwork(session: JigEditorSession): JigEditorSession {
  return changeJigDraft(
    session,
    applyCenterArtworkInRegistrationJigSet({ ...session.draft, undoStack: [] }),
  );
}

export function removeJigLayout(session: JigEditorSession): JigEditorSession {
  // Restore artwork intent before removing the layer that owns the two-run mode.
  const restored = applyRegistrationOutput({ ...session.draft, undoStack: [] }, 'artwork');
  const result = applyRemoveRegistrationBox({ ...session.draft, ...restored, undoStack: [] });
  return result === null
    ? session
    : changeJigDraft(session, { ...result, registrationArtworkOutputSnapshot: null });
}

export function undoJigDraft(session: JigEditorSession, redo = false): JigEditorSession {
  const source = redo ? session.future : session.past;
  const draft = source.at(-1);
  if (draft === undefined) return session;
  return {
    ...session,
    draft,
    past: redo ? [...session.past, session.draft] : source.slice(0, -1),
    future: redo ? source.slice(0, -1) : [...session.future, session.draft],
  };
}

export function commitJigEditorSession(
  state: AppState,
  session: JigEditorSession,
): Partial<AppState> | null {
  if (state.project !== session.baseProject || state.projectDocumentEpoch !== session.documentEpoch)
    return null;
  if (findRegistrationBoxes(state.project.scene).some((box) => box.provenance === 'captured-board'))
    return null;
  let draft = session.draft;
  if (session.firstSave && findRegistrationBoxes(draft.project.scene).length > 0) {
    draft = { ...draft, ...applyRegistrationOutput({ ...draft, undoStack: [] }, 'box') };
  }
  const project = {
    ...draft.project,
    scene: {
      ...draft.project.scene,
      objects: draft.project.scene.objects.map((object) =>
        isRegistrationBox(object) ? { ...object, locked: true } : object,
      ),
    },
  };
  // Publish one edit, never the editor's intermediate history or machine state.
  return {
    project,
    selectedObjectId: draft.selectedObjectId,
    additionalSelectedIds: draft.additionalSelectedIds,
    registrationArtworkOutputSnapshot: project.scene.layers.some(
      (layer) => layer.id === REGISTRATION_LAYER_ID,
    )
      ? draft.registrationArtworkOutputSnapshot
      : null,
    undoStack: pushUndo(state.project, state.undoStack),
    redoStack: [],
    dirty: true,
  };
}
