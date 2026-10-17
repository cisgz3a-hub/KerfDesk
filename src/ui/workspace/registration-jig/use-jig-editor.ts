import { useCallback, useState } from 'react';
import {
  findRegistrationBoxes,
  type Project,
  type SceneObject,
  type TextObject,
} from '../../../core/scene';
import { useStore } from '../../state';
import { reportDependencyRepairs } from '../../state/object-delete-actions';
import {
  changeJigDraft,
  commitJigEditorSession,
  createJigEditorSession,
  selectedJigIds,
  selectJigObjects,
  undoJigDraft,
  type JigEditorSession,
} from './jig-editor-session';
import {
  deleteJigArtworkWithRepairs,
  importJigArtwork,
  nudgeJigSelection,
  upsertJigText,
} from './jig-editor-artwork';

export function useJigEditor(onClose: () => void) {
  const [session, setSession] = useState(() => createJigEditorSession(useStore.getState()));
  const [pendingLayout, setPendingLayout] = useState(false);
  const [working, setWorking] = useState({ import: false, text: false, trace: false });
  const [error, setError] = useState('');
  const onCommit = useCallback(
    (project: Project) => setSession((current) => changeJigDraft(current, { project })),
    [],
  );
  const onSelect = useCallback(
    (ids: ReadonlySet<string>) => setSession((current) => selectJigObjects(current, ids)),
    [],
  );
  const onImport = useCallback(
    (object: SceneObject) => setSession((current) => importJigArtwork(current, object)),
    [],
  );
  const onUpsert = useCallback(
    (object: TextObject) => setSession((current) => upsertJigText(current, object)),
    [],
  );
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
  const captured = findRegistrationBoxes(session.baseProject.scene).some(
    (box) => box.provenance === 'captured-board',
  );
  const busy = working.import || working.text || working.trace;
  const save = (): void => {
    if (busy || pendingLayout || captured) return;
    const change = commitJigEditorSession(useStore.getState(), session);
    if (change === null) {
      setError(
        'The main project changed while this editor was open. Close without saving and reopen to use the current project.',
      );
      return;
    }
    useStore.setState(change);
    onClose();
  };
  return {
    session,
    setSession,
    pendingLayout,
    setPendingLayout,
    error,
    busy,
    captured,
    save,
    ids: selectedJigIds(session.draft),
    onCommit,
    onSelect,
    onImport,
    onUpsert,
    onImportBusy,
    onTextBusy,
    onTraceBusy,
  };
}

export type JigEditorController = ReturnType<typeof useJigEditor>;

function isTextInput(target: EventTarget): boolean {
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
  if (isTextInput(event.target)) return;
  const key = event.key.toLowerCase();
  if ((event.ctrlKey || event.metaKey) && (key === 'z' || key === 'y')) {
    event.preventDefault();
    setSession((current) => undoJigDraft(current, event.shiftKey || key === 'y'));
  } else if (key === 'delete' || key === 'backspace') {
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
