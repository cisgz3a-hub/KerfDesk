import { useEffect, useRef } from 'react';
import { useStore } from '../state';
import { useUiStore, type TraceImageDialogState } from '../state/ui-store';

/** Each submission belongs to this mounted dialog and the document it started
 * in. Ordinary project edits do not change the document epoch, so a trace can
 * still follow a moved source. Closing/reopening, Open/New, and unmount abandon
 * the old submission even if the source ID and pixels are retained. */
export function useTraceCommitLifetime(dialog: TraceImageDialogState): () => () => boolean {
  const unmountEpoch = useRef(0);
  useEffect(
    () => () => {
      unmountEpoch.current += 1;
    },
    [],
  );

  return () => {
    const mountedEpoch = unmountEpoch.current;
    const documentEpoch = useStore.getState().projectDocumentEpoch;
    return () =>
      unmountEpoch.current === mountedEpoch &&
      useUiStore.getState().imageDialog === dialog &&
      useStore.getState().projectDocumentEpoch === documentEpoch;
  };
}
