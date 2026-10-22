import { useCallback, useMemo, useState } from 'react';
import {
  findRegistrationBoxes,
  type Project,
  type SceneObject,
  type TextObject,
  type TracedImage,
} from '../../../core/scene';
import { useStore } from '../../state';
import { reportDependencyRepairs } from '../../state/object-delete-actions';
import type { RegistrationJigSetSpec } from '../../state/registration-jig-set-actions';
import {
  changeJigDraft,
  commitJigEditorSession,
  createJigEditorSession,
  jigDraftDirty,
  removeJigLayout,
  replaceJigLayout,
  selectedJigIds,
  selectJigObjects,
  undoJigDraft,
  type JigCommitRefusal,
  type JigEditorSession,
} from './jig-editor-session';
import {
  deleteJigArtworkWithRepairs,
  importJigArtwork,
  nudgeJigSelection,
  traceJigImage,
  upsertJigText,
  type JigImportPlacement,
} from './jig-editor-artwork';
import { useJigArtworkImport } from './JigArtworkImport';
import { jigSelectAll } from './jig-canvas-selection';
import { jigViewProject, withJigBackground } from './jig-editor-scope';

export function useJigEditor(onClose: () => void) {
  const [session, setSession] = useState(() => createJigEditorSession(useStore.getState()));
  const [pendingLayout, setPendingLayout] = useState(false);
  const working = useJigWorking();
  // Bumped when the outline layout is rebuilt, so the canvas refits to the new grid.
  const [fitRequest, setFitRequest] = useState(0);
  // The canvas and sidebar edit the jig view; fold each edit back into the
  // whole draft so main-canvas artwork outside the jig stays as it was.
  const onCommit = useCallback(
    (project: Project) =>
      setSession((current) =>
        changeJigDraft(current, {
          project: withJigBackground(current.draft.project, project, current.background),
        }),
      ),
    [],
  );
  const view = useMemo(
    () => jigViewProject(session.draft.project, session.background),
    [session.draft.project, session.background],
  );
  const onSelect = useCallback(
    (ids: ReadonlySet<string>) => setSession((current) => selectJigObjects(current, ids)),
    [],
  );
  const onImport = useCallback(
    (object: SceneObject, placement?: JigImportPlacement) =>
      setSession((current) => importJigArtwork(current, object, placement)),
    [],
  );
  const onUpsert = useCallback(
    (object: TextObject) => setSession((current) => upsertJigText(current, object)),
    [],
  );
  const onTraceImage = useCallback(
    (imageId: string, traced: TracedImage) =>
      setSession((current) => traceJigImage(current, imageId, traced)),
    [],
  );
  const artworkImport = useJigArtworkImport(onImport, working.onImportBusy);
  const onReplaceLayout = useCallback((spec: RegistrationJigSetSpec) => {
    setSession((current) => replaceJigLayout(current, spec));
    setFitRequest((request) => request + 1);
  }, []);
  const onRemoveLayout = useCallback(() => setSession(removeJigLayout), []);
  const captured = findRegistrationBoxes(session.baseProject.scene).some(
    (box) => box.provenance === 'captured-board',
  );
  const closing = useJigEditorClose({
    session,
    pendingLayout,
    busy: working.busy,
    captured,
    onClose,
    onSelect,
  });
  return {
    ...closing,
    session,
    setSession,
    /** The draft as the editor shows it: the jig without main-canvas artwork. */
    view,
    pendingLayout,
    setPendingLayout,
    busy: working.busy,
    captured,
    fitRequest,
    importing: artworkImport.busy,
    importFiles: artworkImport.importFiles,
    ids: selectedJigIds(session.draft),
    onCommit,
    onSelect,
    onImport,
    onUpsert,
    onTraceImage,
    onReplaceLayout,
    onRemoveLayout,
    onTextBusy: working.onTextBusy,
    onTraceBusy: working.onTraceBusy,
  };
}

function useJigWorking() {
  const [working, setWorking] = useState({ import: false, text: false, trace: false });
  const onImportBusy = useCallback(
    (value: boolean) => setWorking((current) => ({ ...current, import: value })),
    [],
  );
  const onTextBusy = useCallback(
    (value: boolean) => setWorking((current) => ({ ...current, text: value })),
    [],
  );
  const onTraceBusy = useCallback(
    (value: boolean) => setWorking((current) => ({ ...current, trace: value })),
    [],
  );
  const busy = working.import || working.text || working.trace;
  return { busy, onImportBusy, onTextBusy, onTraceBusy };
}

// Saving, closing and Escape. Closing with unsaved edits asks first: Escape or
// one stray click must not throw away a whole jig.
function useJigEditorClose(args: {
  readonly session: JigEditorSession;
  readonly pendingLayout: boolean;
  readonly busy: boolean;
  readonly captured: boolean;
  readonly onClose: () => void;
  readonly onSelect: (ids: ReadonlySet<string>) => void;
}) {
  const { session, pendingLayout, busy, captured, onClose, onSelect } = args;
  const [error, setError] = useState('');
  const [confirmingClose, setConfirmingClose] = useState(false);
  const dirty = jigDraftDirty(session) || pendingLayout;
  const canSave = !busy && !pendingLayout && !captured;
  const save = (): boolean => {
    if (!canSave) return false;
    // Nothing to publish: closing must not add an undo step or dirty the project.
    if (!jigDraftDirty(session) && !session.firstSave) {
      onClose();
      return true;
    }
    let refused: JigCommitRefusal | null = null;
    // The draft may assign artwork to a Pro operation: without Pro that waits
    // for the Pro prompt, and the editor closes once the change lands.
    const committed = useStore.getState().commitProjectEdit(
      (state) => {
        const result = commitJigEditorSession(state, session);
        if (result.kind === 'saved') return result.change;
        refused = result.reason;
        return {};
      },
      () => {
        if (refused === null) onClose();
      },
    );
    if (refused !== null) {
      setConfirmingClose(false);
      setError(refusalMessage(refused));
      return false;
    }
    return committed;
  };
  const requestClose = (): void => {
    if (dirty && !captured) setConfirmingClose(true);
    else onClose();
  };
  // Escape first drops the selection, as on the main canvas; only an Escape
  // with nothing selected asks to leave the editor.
  const onEscape = (): void => {
    if (confirmingClose) return;
    if (selectedJigIds(session.draft).size > 0) onSelect(new Set());
    else requestClose();
  };
  return {
    error,
    dirty,
    canSave,
    save,
    requestClose,
    onEscape,
    confirmingClose,
    keepEditing: () => setConfirmingClose(false),
    discard: onClose,
  };
}

const REOPEN = 'Choose Close without saving, then Discard changes, and reopen the editor';

// Changes the draft did not overlap are merged on save, so each refusal names
// what actually collided.
function refusalMessage(reason: JigCommitRefusal): string {
  switch (reason) {
    case 'new-document':
      return `A different project was opened while this editor was open, so these jig edits belong to the previous one. ${REOPEN} to edit the jig in this project.`;
    case 'captured-board':
      return `The main project now holds a captured board outline, which this editor cannot replace. ${REOPEN}; Place Board owns that outline.`;
    case 'outlines':
      return `The jig outlines changed on the main canvas while this editor was open, and this draft holds the whole layout. ${REOPEN} to start from the current outlines.`;
    case 'artwork':
      return `Artwork you changed here was also changed in the main project while this editor was open. ${REOPEN} to start from the current artwork.`;
    case 'operations':
      return `An operation setting you changed here was also changed in the main project, or artwork here uses an operation the main project removed. ${REOPEN} to start from the current operations.`;
    case 'project':
      return `A project setting changed in the main project overlaps this editor's changes. ${REOPEN} to start from the current project.`;
    case 'scene-limits':
      return 'Combining this draft with the main project would exceed a project size limit. Your draft is still open. Remove some artwork or unused operations before saving again.';
    case 'scene-integrity':
      return `Combining this draft with the main project would create conflicting operation colours or artwork references. Your draft is still open. ${REOPEN} to start from the current project.`;
  }
}

export type JigEditorController = ReturnType<typeof useJigEditor>;

export function isTextInput(target: EventTarget): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName))
  );
}

const ARROWS: Readonly<Record<string, readonly [number, number]>> = {
  arrowleft: [-1, 0],
  arrowright: [1, 0],
  arrowup: [0, -1],
  arrowdown: [0, 1],
};

export function handleJigEditorKey(
  event: React.KeyboardEvent,
  session: JigEditorSession,
  setSession: React.Dispatch<React.SetStateAction<JigEditorSession>>,
): void {
  if (isTextInput(event.target) || handleJigCommandKey(event, setSession)) return;
  const key = event.key.toLowerCase();
  if (key === 'delete' || key === 'backspace') {
    event.preventDefault();
    const deletion = deleteJigArtworkWithRepairs(session);
    if (deletion.session === session) return;
    setSession(deletion.session);
    if (deletion.repairs !== null) reportDependencyRepairs(deletion.repairs);
  } else {
    const direction = ARROWS[key];
    if (direction === undefined) return;
    const step = event.shiftKey ? 10 : 1;
    event.preventDefault();
    setSession((current) => nudgeJigSelection(current, direction[0] * step, direction[1] * step));
  }
}

// Ctrl/Cmd+Z and +Y undo and redo; Ctrl/Cmd+A selects everything the canvas can select.
function handleJigCommandKey(
  event: React.KeyboardEvent,
  setSession: React.Dispatch<React.SetStateAction<JigEditorSession>>,
): boolean {
  if (!event.ctrlKey && !event.metaKey) return false;
  const key = event.key.toLowerCase();
  if (key === 'z' || key === 'y') {
    event.preventDefault();
    setSession((current) => undoJigDraft(current, event.shiftKey || key === 'y'));
    return true;
  }
  if (key !== 'a' || event.shiftKey) return false;
  event.preventDefault();
  setSession((current) => selectJigObjects(current, jigSelectAll(current.draft.project.scene)));
  return true;
}
