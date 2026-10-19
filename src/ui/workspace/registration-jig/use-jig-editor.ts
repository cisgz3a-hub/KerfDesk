import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  findRegistrationBoxes,
  isRegistrationBox,
  type Project,
  type SceneObject,
  type TextObject,
  type TracedImage,
} from '../../../core/scene';
import { keyboardOwnedElsewhere } from '../../common/keyboard-owner';
import { useStore } from '../../state';
import { useLaserStore } from '../../state/laser-store';
import { useUiStore } from '../../state/ui-store';
import { jobControlsBusy, jobNeedsRecovery } from '../../laser/job-controls-busy';
import { reportDependencyRepairs } from '../../state/object-delete-actions';
import { useToastStore } from '../../state/toast-store';
import type { RegistrationJigSetSpec } from '../../state/registration-jig-set-actions';
import {
  centerJigArtwork,
  changeJigDraft,
  createJigEditorSession,
  jigSessionView,
  jigStoreChange,
  removeJigLayout,
  replaceJigLayout,
  selectedJigIds,
  selectJigObjects,
  type JigEditorSession,
  type JigViewOptions,
} from './jig-editor-session';
import {
  clearJigArtwork,
  deleteJigArtworkWithRepairs,
  importJigArtwork,
  jigArtworkIds,
  nudgeJigSelection,
  traceJigImage,
  upsertJigText,
  type JigImportPlacement,
} from './jig-editor-artwork';
import { useJigArtworkImport } from './JigArtworkImport';
import { jigRunPhase, type JigRunPhase } from './jig-run-phase';
import { jigSelectAll } from './jig-canvas-selection';

/** The three steps of a jig job, in the order the operator does them. */
export type JigStep = 'outlines' | 'artwork' | 'burn-artwork';

export type JigEdit = (session: JigEditorSession) => JigEditorSession;

const JIG_EDIT_PAUSED =
  'The machine is moving, so the jig was not changed. Try again when it stops.';

export function useJigEditor(onClose: () => void) {
  const [created] = useState(
    () => findRegistrationBoxes(useStore.getState().project.scene).length === 0,
  );
  const [outlinesUnlocked, setOutlinesUnlocked] = useState(false);
  const unlockedRef = useRef(outlinesUnlocked);
  unlockedRef.current = outlinesUnlocked;
  const draft = useJigStoreSlice();
  const runPhase = jigRunPhase(draft.project.scene);
  const fresh = useJigFresh(created, runPhase);
  const session = useMemo(
    () => jigSessionView(draft, { fresh, outlinesUnlocked }),
    [draft, fresh, outlinesUnlocked],
  );
  const setSession = useCallback(
    (edit: JigEdit, undoName?: string) =>
      applyJigEdit(edit, { fresh, outlinesUnlocked: unlockedRef.current }, undoName),
    [fresh],
  );
  const [step, setStep] = useJigStep(runPhase);
  useJigOpening(created, onClose);
  const working = useJigWorking();
  const edits = useJigEditCallbacks(setSession);
  const artworkImport = useJigArtworkImport(edits.onImport, working.onImportBusy);
  return {
    ...edits,
    session,
    setSession,
    runPhase,
    step,
    setStep,
    readOnly: useMachineMoving(),
    outlinesUnlocked,
    unlockOutlines: () => setOutlinesUnlocked(true),
    busy: working.busy,
    captured: findRegistrationBoxes(draft.project.scene).some(
      (box) => box.provenance === 'captured-board',
    ),
    importing: artworkImport.busy,
    importFiles: artworkImport.importFiles,
    ids: selectedJigIds(session.draft),
    clearCount: useMemo(() => jigArtworkIds(session.draft.project.scene).size, [session]),
    onTextBusy: working.onTextBusy,
    onTraceBusy: working.onTraceBusy,
    // Escape drops the selection, as on the main canvas. Leaving jig mode is
    // always the explicit Done, so a stray Escape never moves the operator.
    onEscape: () => edits.onSelect(new Set()),
    done: () => finishJigMode(onClose),
  };
}

export type JigEditorController = ReturnType<typeof useJigEditor>;

function useJigEditCallbacks(setSession: (edit: JigEdit) => JigEditorSession) {
  // Bumped when the outline layout is rebuilt, so the canvas refits to the new grid.
  const [fitRequest, setFitRequest] = useState(0);
  const onCommit = useCallback(
    (project: Project) => setSession((current) => changeJigDraft(current, { project })),
    [setSession],
  );
  const onSelect = useCallback(
    (ids: ReadonlySet<string>) => setSession((current) => selectJigObjects(current, ids)),
    [setSession],
  );
  // An import, a trace or new text lands after async work, possibly once the
  // machine has started moving. It is then refused with an error, which the
  // importer (a toast), the tracer and the text form show instead of a success.
  const settle = useCallback(
    (edit: JigEdit): void => {
      if (machineMovingNow()) throw new Error(JIG_EDIT_PAUSED);
      setSession(edit);
    },
    [setSession],
  );
  const onImport = useCallback(
    (object: SceneObject, placement?: JigImportPlacement) =>
      settle((current) => importJigArtwork(current, object, placement)),
    [settle],
  );
  const onUpsert = useCallback(
    (object: TextObject) => settle((current) => upsertJigText(current, object)),
    [settle],
  );
  const onTraceImage = useCallback(
    (imageId: string, traced: TracedImage) =>
      settle((current) => traceJigImage(current, imageId, traced)),
    [settle],
  );
  const onReplaceLayout = useCallback(
    (spec: RegistrationJigSetSpec) => {
      setSession((current) => replaceJigLayout(current, spec));
      setFitRequest((request) => request + 1);
    },
    [setSession],
  );
  const onRemoveLayout = useCallback(() => setSession(removeJigLayout), [setSession]);
  const onCentre = useCallback(() => setSession(centerJigArtwork), [setSession]);
  const onClear = useCallback(() => clearJigCanvas(setSession), [setSession]);
  return {
    fitRequest,
    onCentre,
    onClear,
    onCommit,
    onSelect,
    onImport,
    onUpsert,
    onTraceImage,
    onReplaceLayout,
    onRemoveLayout,
  };
}

/**
 * Applies one jig edit to the open project. Nothing changes while the machine
 * is running a job or moving: the run was prepared from the project as it was,
 * and the outline-run completion that selects Artwork only needs it unchanged.
 */
export function applyJigEdit(
  edit: JigEdit,
  options: JigViewOptions,
  undoName?: string,
): JigEditorSession {
  const state = useStore.getState();
  const before = jigSessionView(state, options);
  const after = edit(before);
  const change = jigStoreChange(state, before, after, undoName);
  if (change === null) return after;
  if (change.project !== undefined && machineMovingNow()) return before;
  useStore.setState(change);
  return after;
}

function useJigStoreSlice() {
  const project = useStore((state) => state.project);
  const selectedObjectId = useStore((state) => state.selectedObjectId);
  const additionalSelectedIds = useStore((state) => state.additionalSelectedIds);
  const registrationArtworkOutputSnapshot = useStore(
    (state) => state.registrationArtworkOutputSnapshot,
  );
  return useMemo(
    () => ({ project, selectedObjectId, additionalSelectedIds, registrationArtworkOutputSnapshot }),
    [project, selectedObjectId, additionalSelectedIds, registrationArtworkOutputSnapshot],
  );
}

function machineMovingNow(): boolean {
  const laser = useLaserStore.getState();
  return jobControlsBusy(laser.streamer?.status, laser.motionOperation, laser.controllerOperation);
}

function useMachineMoving(): boolean {
  return useLaserStore((laser) =>
    jobControlsBusy(laser.streamer?.status, laser.motionOperation, laser.controllerOperation),
  );
}

// A new jig opens on its outlines; one whose outlines are burned opens on the
// artwork. A clean outline run selects Artwork only, and the page follows it
// to placing the pieces.
function useJigStep(runPhase: JigRunPhase) {
  const [step, setStep] = useState<JigStep>(() =>
    runPhase === 'artwork' ? 'artwork' : 'outlines',
  );
  const previous = useRef(runPhase);
  useEffect(() => {
    if (previous.current === 'outlines' && runPhase === 'artwork') {
      setStep((current) => (current === 'outlines' ? 'artwork' : current));
    }
    previous.current = runPhase;
  }, [runPhase]);
  return [step, setStep] as const;
}

// A jig this visit created grows centred until it is burned. Once a job has run
// or the outlines are marked burned (Artwork only), they may be on the base, so
// for the rest of the visit the grid keeps its first outline's corner, even
// after Burn outlines again.
function useJigFresh(created: boolean, runPhase: JigRunPhase): boolean {
  const [burned, setBurned] = useState(false);
  const jobRan = useLaserStore((laser) => jobNeedsRecovery(laser.streamer?.status));
  if (!burned && (jobRan || runPhase === 'artwork')) setBurned(true);
  return created && !burned;
}

// Opening jig mode on a project without a jig creates its first outline, as one
// undoable edit. Opening another project leaves jig mode.
function useJigOpening(created: boolean, onClose: () => void): void {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!created || machineMovingNow()) return;
    const state = useStore.getState();
    const before = jigSessionView(state, { fresh: true });
    const opened = createJigEditorSession(state, { fresh: true });
    const change = jigStoreChange(state, before, opened, 'Create registration jig');
    if (change !== null) useStore.setState(change);
  }, [created]);
  useEffect(() => {
    const epoch = useStore.getState().projectDocumentEpoch;
    return useStore.subscribe((state) => {
      if (state.projectDocumentEpoch !== epoch) close.current();
    });
  }, []);
  // Leaving by the Tools menu's Registration Jig toggle gets Done's clean-up.
  useEffect(
    () =>
      useUiStore.subscribe((state, previous) => {
        if (previous.registrationPanelOpen && !state.registrationPanelOpen) dropOutlineSelection();
      }),
    [],
  );
}

function finishJigMode(onClose: () => void): void {
  dropOutlineSelection();
  onClose();
}

// Outlines stay locked on the main canvas, so leaving jig mode drops them from
// the selection rather than leave a selection the main canvas cannot edit.
function dropOutlineSelection(): void {
  const state = useStore.getState();
  const ids = [...selectedJigIds(state)].filter((id) => {
    const object = state.project.scene.objects.find((candidate) => candidate.id === id);
    return object !== undefined && !isRegistrationBox(object);
  });
  if (ids.length !== selectedJigIds(state).size) {
    useStore.setState({
      selectedObjectId: ids[0] ?? null,
      additionalSelectedIds: new Set(ids.slice(1)),
    });
  }
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

/** Jig-page keys. The window's canvas shortcuts stand down in jig mode, so
 *  these are the only canvas keys; machine and file shortcuts still work. */
export function handleJigEditorKey(event: React.KeyboardEvent, editor: JigEditorController): void {
  // A dialog the page opens (Cut Settings) owns the keyboard, as it does over
  // the main canvas; its keys bubble here and must not edit the jig.
  if (keyboardOwnedElsewhere()) return;
  if (isTextInput(event.target)) {
    if (event.key === 'Escape') (event.currentTarget as HTMLElement).focus();
    return;
  }
  if (handleJigCommandKey(event, editor)) return;
  const key = event.key.toLowerCase();
  if (key === 'escape') {
    event.preventDefault();
    editor.onEscape();
  } else if (editor.readOnly) {
    return;
  } else if (key === 'delete' || key === 'backspace') {
    event.preventDefault();
    let repairs: ReturnType<typeof deleteJigArtworkWithRepairs>['repairs'] = null;
    editor.setSession((current) => {
      const deletion = deleteJigArtworkWithRepairs(current);
      repairs = deletion.repairs;
      return deletion.session;
    });
    if (repairs !== null) reportDependencyRepairs(repairs);
  } else {
    const direction = ARROWS[key];
    if (direction === undefined) return;
    const step = event.shiftKey ? 10 : 1;
    event.preventDefault();
    editor.setSession((current) =>
      nudgeJigSelection(current, direction[0] * step, direction[1] * step),
    );
  }
}

// Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z stay the window's project-wide Undo and Redo
// (use-shortcuts.ts); the jig page adds Ctrl/Cmd+Y for Redo, as the jig editor
// had, and Ctrl/Cmd+A selects everything the canvas can select.
function handleJigCommandKey(event: React.KeyboardEvent, editor: JigEditorController): boolean {
  if (!event.ctrlKey && !event.metaKey) return false;
  const key = event.key.toLowerCase();
  if (key === 'z') return true;
  if (key === 'y' && !event.shiftKey) {
    event.preventDefault();
    useStore.getState().redo();
    return true;
  }
  if (key !== 'a' || event.shiftKey) return false;
  event.preventDefault();
  const target = editor.step === 'outlines' ? 'outlines' : 'artwork';
  editor.setSession((current) =>
    selectJigObjects(current, jigSelectAll(current.draft.project.scene, target)),
  );
  return true;
}

// Clear canvas (ADR-641): one undoable edit that empties the pieces and says so.
function clearJigCanvas(setSession: (edit: JigEdit) => JigEditorSession): void {
  let cleared = 0;
  let repairs: ReturnType<typeof clearJigArtwork>['repairs'] = null;
  setSession((current) => {
    const before = current.draft.project.scene.objects.length;
    const deletion = clearJigArtwork(current);
    cleared = before - deletion.session.draft.project.scene.objects.length;
    repairs = deletion.repairs;
    return deletion.session;
  });
  if (repairs !== null) reportDependencyRepairs(repairs);
  if (cleared > 0) {
    useToastStore
      .getState()
      .pushToast(
        `Cleared ${cleared} artwork object${cleared === 1 ? '' : 's'} from the jig. Undo brings ${cleared === 1 ? 'it' : 'them'} back.`,
        'info',
      );
  }
}
