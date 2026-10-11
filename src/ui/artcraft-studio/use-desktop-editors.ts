import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state';
import { applyStudioSnapshot } from './apply-studio-snapshot';
import {
  getStudioSnapshot,
  getStudioStatus,
  openStudioEditor,
  resumeStudioEditor,
  type StudioEditor,
  type StudioStatus,
} from './artcraft-api';
export function useDesktopEditors() {
  const [status, setStatus] = useState<StudioStatus | null>(null);
  const [editor, setEditor] = useState<StudioEditor>('vector');
  const [file, setFile] = useState<File | null>(null);
  const [width, setWidth] = useState('100');
  const [height, setHeight] = useState('100');
  const { busy, message, error, mounted, inFlight, run } = useEditorOperation();
  const refresh = () =>
    run(async () => {
      const next = await getStudioStatus();
      if (mounted.current) setStatus(next);
      return 'Desktop editor status updated.';
    });
  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
    };
    // Initial status only; Refresh is an explicit action after editor changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return {
    status,
    editor,
    file,
    width,
    height,
    busy,
    message,
    error,
    setFile,
    setWidth,
    setHeight,
    refresh,
    chooseEditor: (next: StudioEditor) => {
      if (!inFlight.current) {
        setEditor(next);
        setFile(null);
      }
    },
    open: () =>
      run(async () => {
        const widthMm = Number(width),
          heightMm = Number(height);
        if (
          !Number.isFinite(widthMm) ||
          !Number.isFinite(heightMm) ||
          widthMm <= 0 ||
          heightMm <= 0
        )
          throw new Error('Enter a positive width and height in millimetres.');
        await openStudioEditor(editor, file, { widthMm, heightMm });
        const next = await getStudioStatus();
        if (mounted.current) setStatus(next);
        return 'Editor opened. Make your changes there, then Apply here.';
      }),
    resume: (id: string) =>
      run(async () => {
        await resumeStudioEditor(id);
        const next = await getStudioStatus();
        if (mounted.current) setStatus(next);
        return 'Editor reopened.';
      }),
    apply: (id: string) =>
      run(async () => {
        const ownerEpoch = useStore.getState().projectDocumentEpoch;
        const snapshot = await getStudioSnapshot(id);
        if (!mounted.current) return '';
        if (snapshot.id !== id)
          throw new Error('The editor returned a different session. Nothing was applied.');
        await applyStudioSnapshot(snapshot, ownerEpoch, () => mounted.current);
        return 'Artwork applied to KerfDesk. You can close this panel and Design Studio to review it in the project.';
      }),
  };
}

function useEditorOperation() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Checking desktop editors…');
  const [error, setError] = useState(false);
  const mounted = useRef(true);
  const inFlight = useRef(false);
  const run = async (action: () => Promise<string>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(false);
    setMessage('Working…');
    try {
      const result = await action();
      if (mounted.current) setMessage(result);
    } catch (reason) {
      if (mounted.current) {
        setError(true);
        setMessage(reason instanceof Error ? reason.message : 'Desktop editor request failed.');
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  return { busy, message, error, mounted, inFlight, run };
}
