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
import { jigRunPhase } from './jig-run-phase';

// Jig mode edits the open project itself (ADR-638): there is no draft to save
// or discard, so what the jig page shows is always what Frame and Start burn.
// The helpers here stay pure. They work on a view of the project in which the
// outlines are unlocked while they may still be moved, and `jigStoreChange`
// locks them again before anything reaches the store, so a stray drag on the
// main canvas can never move an outline.

export type JigDraft = Pick<
  AppState,
  'project' | 'selectedObjectId' | 'additionalSelectedIds' | 'registrationArtworkOutputSnapshot'
>;

export type JigEditorSession = {
  /** True when this jig-mode visit created the jig: its outlines cannot have
   *  been burned, so a resized grid stays centred where it was. */
  readonly fresh: boolean;
  readonly draft: JigDraft;
};

export type JigViewOptions = {
  readonly fresh?: boolean;
  /** The operator unlocked burned outlines on purpose (Artwork only). */
  readonly outlinesUnlocked?: boolean;
};

type JigStoreState = JigDraft & Pick<AppState, 'undoStack'>;

/** The jig page's view of the store. Outlines are editable until they are
 *  burned (Artwork only), or after an explicit Unlock. */
export function jigSessionView(state: JigDraft, options: JigViewOptions = {}): JigEditorSession {
  const editable =
    options.outlinesUnlocked === true || jigRunPhase(state.project.scene) !== 'artwork';
  return {
    fresh: options.fresh === true,
    draft: {
      project: editable ? editableProject(state.project) : lockOutlines(state.project),
      selectedObjectId: state.selectedObjectId,
      additionalSelectedIds: state.additionalSelectedIds,
      registrationArtworkOutputSnapshot:
        state.project.registrationArtworkOutputSnapshot ?? state.registrationArtworkOutputSnapshot,
    },
  };
}

/** The view, plus a starting outline when the project has no jig yet. A new jig
 *  starts in Outline only: its outlines are burned first. */
export function createJigEditorSession(
  state: JigDraft,
  options: JigViewOptions = {},
): JigEditorSession {
  const fresh = findRegistrationBoxes(state.project.scene).length === 0;
  const session = jigSessionView(state, { ...options, fresh: options.fresh ?? fresh });
  return fresh ? createDefaultJig(session) : session;
}

function createDefaultJig(session: JigEditorSession): JigEditorSession {
  const { draft } = session;
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
  let next: JigDraft = { ...draft, ...created };
  next = { ...next, ...applyRegistrationOutput({ ...next, undoStack: [] }, 'box') };
  return changeJigDraft(session, {
    project: editableProject(next.project),
    registrationArtworkOutputSnapshot: next.registrationArtworkOutputSnapshot,
    selectedObjectId: draft.selectedObjectId,
    additionalSelectedIds: draft.additionalSelectedIds,
  });
}

/**
 * The store change that publishes a jig edit, or null when the edit changed
 * nothing. A selection-only change adds no undo step; anything else is one
 * undoable edit with the outlines locked again.
 */
export function jigStoreChange(
  state: JigStoreState,
  before: JigEditorSession,
  after: JigEditorSession,
  undoName?: string,
): Partial<AppState> | null {
  if (after === before) return null;
  const selection = {
    selectedObjectId: after.draft.selectedObjectId,
    additionalSelectedIds: after.draft.additionalSelectedIds,
  };
  if (
    after.draft.project === before.draft.project &&
    after.draft.registrationArtworkOutputSnapshot === before.draft.registrationArtworkOutputSnapshot
  ) {
    return sameSelection(before.draft, after.draft) ? null : selection;
  }
  const project = lockOutlines(after.draft.project);
  return {
    project,
    ...selection,
    registrationArtworkOutputSnapshot: project.scene.layers.some(
      (layer) => layer.id === REGISTRATION_LAYER_ID,
    )
      ? after.draft.registrationArtworkOutputSnapshot
      : null,
    undoStack: pushUndo(state.project, state.undoStack, undoName),
    redoStack: [],
    dirty: true,
  };
}

function sameSelection(left: JigDraft, right: JigDraft): boolean {
  return (
    left.selectedObjectId === right.selectedObjectId &&
    left.additionalSelectedIds.size === right.additionalSelectedIds.size &&
    [...left.additionalSelectedIds].every((id) => right.additionalSelectedIds.has(id))
  );
}

// Memoised per project so the canvas receives the same view object until the
// project really changes; a new object would cancel a drag in progress.
const editableViews = new WeakMap<Project, Project>();
const lockedViews = new WeakMap<Project, Project>();

function editableProject(project: Project): Project {
  return withOutlineLock(project, false, editableViews);
}

function lockOutlines(project: Project): Project {
  return withOutlineLock(project, true, lockedViews);
}

function withOutlineLock(
  project: Project,
  locked: boolean,
  cache: WeakMap<Project, Project>,
): Project {
  const cached = cache.get(project);
  if (cached !== undefined) return cached;
  const needsChange = project.scene.objects.some(
    (object) => movableOutline(object) && (object.locked === true) !== locked,
  );
  const result = needsChange
    ? {
        ...project,
        scene: {
          ...project.scene,
          objects: project.scene.objects.map((object) =>
            movableOutline(object) && (object.locked === true) !== locked
              ? { ...object, locked }
              : object,
          ),
        },
      }
    : project;
  cache.set(project, result);
  cache.set(result, result);
  return result;
}

// A captured board belongs to Place Board and always stays locked (ADR-130).
function movableOutline(object: Project['scene']['objects'][number]): boolean {
  return (
    isRegistrationBox(object) && object.kind === 'shape' && object.provenance !== 'captured-board'
  );
}

/** True while the jig page shows the outlines locked against moving. */
export function jigOutlinesLocked(project: Project): boolean {
  return findRegistrationBoxes(project.scene).some(
    (box) => box.locked === true && box.provenance !== 'captured-board',
  );
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
    draft.registrationArtworkOutputSnapshot === session.draft.registrationArtworkOutputSnapshot &&
    sameSelection(draft, session.draft)
  )
    return session;
  return { ...session, draft };
}

export function replaceJigLayout(
  session: JigEditorSession,
  spec: RegistrationJigSetSpec,
): JigEditorSession {
  const previous = session.draft.project.scene.layers;
  // Outlines this visit created cannot have been burned, so a resized grid
  // stays centred where it was instead of growing from one corner.
  const result = applyReplaceRegistrationJigSet(
    { ...session.draft, undoStack: [] },
    spec,
    () => crypto.randomUUID(),
    session.fresh ? 'centre' : 'corner',
  );
  const project = result.project;
  if (project === undefined || project === session.draft.project) return session;
  // The legacy creation action selects Artwork only. Rebuilding the layout must
  // keep the operator's current run and its saved artwork output intent.
  const scene = {
    ...project.scene,
    layers: project.scene.layers.map((layer) => {
      const existing = previous.find((candidate) => candidate.id === layer.id);
      return existing === undefined ? layer : { ...layer, output: existing.output };
    }),
  };
  return changeJigDraft(session, {
    ...result,
    project: editableProject({ ...project, scene }),
  });
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
