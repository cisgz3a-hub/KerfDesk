import {
  findRegistrationBoxes,
  isRegistrationBox,
  REGISTRATION_LAYER_ID,
  registrationRunState,
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
import { jigSceneConflict, rebaseJigDraft, type JigRebaseConflict } from './jig-editor-rebase';
import { jigBackgroundIds } from './jig-editor-scope';

export type JigDraft = Pick<
  AppState,
  'project' | 'selectedObjectId' | 'additionalSelectedIds' | 'registrationArtworkOutputSnapshot'
>;

export type JigEditorSession = {
  readonly baseProject: Project;
  /** Main-canvas objects outside the jig: kept in the draft, never shown or selected. */
  readonly background: ReadonlySet<string>;
  readonly documentEpoch: number;
  readonly firstSave: boolean;
  readonly draft: JigDraft;
  readonly past: ReadonlyArray<JigDraft>;
  readonly future: ReadonlyArray<JigDraft>;
};

export function createJigEditorSession(state: AppState): JigEditorSession {
  const boxes = findRegistrationBoxes(state.project.scene);
  // Artwork only follows the outline burn. Moving outlines then would leave the
  // artwork registered to outlines that no longer match the board, so they stay
  // locked until the operator unlocks them on purpose.
  const burned = registrationRunState(state.project.scene) === 'artwork';
  // A clean canvas: nothing from the main canvas is selected or shown (ADR-652).
  let draft: JigDraft = {
    project: burned ? lockOutlines(state.project) : editableProject(state.project),
    selectedObjectId: null,
    additionalSelectedIds: new Set(),
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
  }
  return {
    baseProject: state.project,
    background: jigBackgroundIds(state.project.scene),
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

/** True while the draft's outlines are locked against moving. */
export function jigOutlinesLocked(project: Project): boolean {
  return findRegistrationBoxes(project.scene).some(
    (box) => box.locked === true && box.provenance !== 'captured-board',
  );
}

/** Explicit, undoable opt-in to move outlines that may already be burned. */
export function unlockJigOutlines(session: JigEditorSession): JigEditorSession {
  if (!jigOutlinesLocked(session.draft.project)) return session;
  return changeJigDraft(session, { project: editableProject(session.draft.project) });
}

/** True once the draft holds an edit the main project does not have. */
export function jigDraftDirty(session: JigEditorSession): boolean {
  return session.past.length > 0;
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
  const [first, ...rest] = [...ids].filter((id) => !session.background.has(id));
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
  // Outlines that never reached the main canvas cannot have been burned, so a
  // resized grid stays centred where it was instead of growing from one corner.
  const result = applyReplaceRegistrationJigSet(
    { ...session.draft, undoStack: [] },
    spec,
    () => crypto.randomUUID(),
    session.firstSave ? 'centre' : 'corner',
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

/** Why a draft cannot be saved: another document was opened, the main project
 *  gained a captured board, or the main project changed what the draft changed. */
export type JigCommitRefusal = 'new-document' | 'captured-board' | JigRebaseConflict;

export type JigCommitResult =
  | { readonly kind: 'saved'; readonly change: Partial<AppState> }
  | { readonly kind: 'refused'; readonly reason: JigCommitRefusal };

export function commitJigEditorSession(
  state: AppState,
  session: JigEditorSession,
): JigCommitResult {
  if (state.projectDocumentEpoch !== session.documentEpoch)
    return { kind: 'refused', reason: 'new-document' };
  if (findRegistrationBoxes(state.project.scene).some((box) => box.provenance === 'captured-board'))
    return { kind: 'refused', reason: 'captured-board' };
  const rebased = rebaseJigDraftOnto(state.project, session);
  if (rebased.kind === 'refused') return rebased;
  let draft = rebased.draft;
  if (session.firstSave && findRegistrationBoxes(draft.project.scene).length > 0) {
    draft = { ...draft, ...applyRegistrationOutput({ ...draft, undoStack: [] }, 'box') };
  }
  const project = lockOutlines(draft.project);
  const conflict = jigSceneConflict(project.scene);
  if (conflict !== null) return { kind: 'refused', reason: conflict };
  // Publish one edit, never the editor's intermediate history or machine state.
  // The editor never sees the main canvas's selection (ADR-652), so that selection,
  // which also scopes Selected artwork only output, comes back as it was.
  const live = new Set(project.scene.objects.map((object) => object.id));
  const selected = [...selectedJigIds(state)].filter((id) => live.has(id));
  const change: Partial<AppState> = {
    project,
    selectedObjectId: selected[0] ?? null,
    additionalSelectedIds: new Set(selected.slice(1)),
    registrationArtworkOutputSnapshot: project.scene.layers.some(
      (layer) => layer.id === REGISTRATION_LAYER_ID,
    )
      ? draft.registrationArtworkOutputSnapshot
      : null,
    undoStack: pushUndo(state.project, state.undoStack),
    redoStack: [],
    dirty: true,
  };
  return { kind: 'saved', change };
}

// The main project may have changed while the editor was open. Carry those
// changes into the draft, or refuse when they overlap the draft's own edits.
function rebaseJigDraftOnto(
  current: Project,
  session: JigEditorSession,
):
  | { readonly kind: 'rebased'; readonly draft: JigDraft }
  | { readonly kind: 'refused'; readonly reason: JigRebaseConflict } {
  const base = session.baseProject;
  if (current === base) return { kind: 'rebased', draft: session.draft };
  const rebased = rebaseJigDraft(base, current, session.draft.project);
  if (rebased.kind === 'conflict') return { kind: 'refused', reason: rebased.conflict };
  const project = rebased.project;
  const live = new Set(project.scene.objects.map((object) => object.id));
  const selected = [...selectedJigIds(session.draft)].filter((id) => live.has(id));
  let draft: JigDraft = {
    ...session.draft,
    project,
    selectedObjectId: selected[0] ?? null,
    additionalSelectedIds: new Set(selected.slice(1)),
  };
  // A completed outline run may select Artwork only while the editor is open.
  // Keep the draft and adopt that output mode instead of discarding the edits.
  const mode = registrationRunState(current.scene);
  if (mode !== registrationRunState(base.scene) && (mode === 'box' || mode === 'artwork'))
    draft = { ...draft, ...applyRegistrationOutput({ ...draft, undoStack: [] }, mode) };
  return { kind: 'rebased', draft };
}

function lockOutlines(project: Project): Project {
  return {
    ...project,
    scene: {
      ...project.scene,
      objects: project.scene.objects.map((object) =>
        isRegistrationBox(object) && object.locked !== true ? { ...object, locked: true } : object,
      ),
    },
  };
}
