import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state';
import { usePlatformOptional } from '../app/platform-context';
import { saveProjectNow } from '../app/confirm-discard';
import { applyStudioSnapshot } from './apply-studio-snapshot';
import {
  bindStudioSession,
  checkpointStudioSessions,
  getStudioBinding,
  unbindStudioSession,
  serializeStudioOperation,
  acceptStudioDocument,
} from './studio-project-bridge';
import {
  getStudioSnapshot,
  getStudioStatus,
  openStudioEditor,
  restoreStudioDocument,
  resumeStudioEditor,
  hideStudioEditor,
  type StudioEditor,
  type StudioStatus,
  type StudioSession,
} from './artcraft-api';

export function useDesktopEditors() {
  const state = useEditorState();
  return { ...state, ...documentActions(state), ...projectActions(state) };
}
function useEditorState() {
  const platform = usePlatformOptional();
  const documents = useStore((state) => state.project.studioDocuments);
  const epoch = useStore((state) => state.projectDocumentEpoch);
  const [status, setStatus] = useState<StudioStatus | null>(null);
  const [editor, setEditor] = useState<StudioEditor>('vector');
  const [file, setFile] = useState<File | null>(null);
  const [width, setWidth] = useState('100');
  const [height, setHeight] = useState('100');
  const [session, setSession] = useState<StudioSession | null>(null);
  const { busy, message, error, mounted, inFlight, run, setMessage, setError } =
    useEditorOperation();
  useEffect(() => {
    setSession(null);
  }, [epoch]);
  useEffect(() => {
    mounted.current = true;
    void getStudioStatus()
      .then((next) => {
        if (mounted.current) setStatus(next);
      })
      .catch((reason: unknown) => {
        if (mounted.current) setMessage(String(reason));
      });
    return () => {
      mounted.current = false;
    };
  }, [mounted, setMessage]);
  const assertOwner = (owner: number) => {
    if (!mounted.current || useStore.getState().projectDocumentEpoch !== owner)
      throw new Error('The project changed while the editor operation was in progress.');
  };
  return {
    status,
    editor,
    file,
    width,
    height,
    busy,
    message,
    error,
    session,
    documents: documents ?? [],
    platform,
    mounted,
    run,
    assertOwner,
    setFile,
    setWidth,
    setHeight,
    setSession,
    setEditor,
    report: (text: string) => {
      setError(true);
      setMessage(text);
    },
    chooseEditor: (next: StudioEditor) => {
      if (!inFlight.current) {
        setEditor(next);
        setFile(null);
      }
    },
  };
}
type EditorState = ReturnType<typeof useEditorState>;
function documentActions(state: EditorState) {
  const { run, assertOwner, setSession, setEditor } = state;
  return {
    open: () =>
      run(async () => {
        const owner = useStore.getState().projectDocumentEpoch;
        const widthMm = Number(state.width),
          heightMm = Number(state.height);
        if (![widthMm, heightMm].every((value) => Number.isFinite(value) && value > 0))
          throw new Error('Enter positive dimensions in millimetres.');
        await checkpointStudioSessions();
        assertOwner(owner);
        const opened = await bindOpenedEditor(state, owner, () =>
          openStudioEditor(state.editor, state.file, { widthMm, heightMm }),
        );
        await checkpointStudioSessions();
        assertOwner(owner);
        setSession(opened);
        return 'Editable source is in this project. Save project to write it to your .lf2 file.';
      }),
    resume: (id: string) =>
      run(async () => {
        const owner = useStore.getState().projectDocumentEpoch;
        const document = useStore
          .getState()
          .project.studioDocuments?.find((entry) => entry.id === id);
        if (document === undefined) throw new Error('Document is no longer in this project.');
        const existing = getStudioBinding(id);
        if (existing === undefined) unbindStudioSession(id);
        const opened = await bindOpenedEditor(
          state,
          owner,
          () =>
            existing === undefined
              ? restoreStudioDocument(document)
              : resumeStudioEditor(existing.id),
          () => assertDocumentVersion(id, document.nativeSha256),
        );
        await checkpointStudioSessions();
        assertOwner(owner);
        setSession(opened);
        setEditor(opened.editor);
        return 'Full editor restored from this project.';
      }),
  };
}
function projectActions(state: EditorState) {
  const { run, assertOwner } = state;
  return {
    save: () =>
      run(async () => {
        const owner = useStore.getState().projectDocumentEpoch;
        if (state.platform === null || state.platform === undefined)
          throw new Error('Project saving is unavailable.');
        await checkpointStudioSessions();
        assertOwner(owner);
        const result = await saveProjectNow(state.platform);
        if (result !== 'saved' && result !== 'saved-with-newer-edits')
          throw new Error('Project was not saved.');
        return result === 'saved'
          ? 'Project saved with editable studio documents.'
          : 'Project saved; newer changes remain unsaved.';
      }),
    apply: (id: string) =>
      run(async () => {
        const owner = useStore.getState().projectDocumentEpoch;
        await checkpointStudioSessions();
        return serializeStudioOperation(async () => {
          assertOwner(owner);
          const snapshot = await getStudioSnapshot(id);
          if (snapshot.id !== id) throw new Error('The editor returned a different session.');
          assertOwner(owner);
          await applyStudioSnapshot(snapshot, owner, () => state.mounted.current);
          if (
            snapshot.nativeDocument !== undefined &&
            !acceptStudioDocument(id, snapshot.nativeDocument, owner)
          )
            throw new Error('The project changed before its editable source could be updated.');
          return 'Artwork updated in KerfDesk. Return to the old studio to review machining.';
        });
      }),
    close: (onClose: () => void) =>
      run(async () => {
        const owner = useStore.getState().projectDocumentEpoch;
        await checkpointStudioSessions();
        assertOwner(owner);
        if (state.session !== null) await hideStudioEditor(state.session.id);
        assertOwner(owner);
        onClose();
        return '';
      }),
  };
}

function assertDocumentVersion(id: string, hash: string): void {
  if (
    useStore.getState().project.studioDocuments?.find((document) => document.id === id)
      ?.nativeSha256 !== hash
  )
    throw new Error(
      'This project document changed while opening. Select it again to restore its current version.',
    );
}

function useEditorOperation() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Create artwork or reopen a document from this project.');
  const [error, setError] = useState(false);
  const mounted = useRef(true);
  const inFlight = useRef(false);
  const run = async (action: () => Promise<string>) => {
    if (inFlight.current) return false;
    inFlight.current = true;
    setBusy(true);
    setError(false);
    try {
      const result = await action();
      if (mounted.current) setMessage(result);
      return true;
    } catch (reason) {
      if (mounted.current) {
        setError(true);
        setMessage(reason instanceof Error ? reason.message : 'Editor request failed.');
      }
      return false;
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return { busy, message, error, mounted, inFlight, run, setMessage, setError };
}

async function bindOpenedEditor(
  state: EditorState,
  owner: number,
  open: () => Promise<StudioSession>,
  checkVersion?: () => void,
): Promise<StudioSession> {
  return serializeStudioOperation(async () => {
    state.assertOwner(owner);
    checkVersion?.();
    const opened = await open();
    state.assertOwner(owner);
    checkVersion?.();
    if (!bindStudioSession(opened, owner))
      throw new Error('The project changed while opening the editor.');
    return opened;
  });
}
