import { useEffect, useRef } from 'react';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';

/** Supplement the exact capture/claim owner with the mounted component lifetime.
 * A transient camera capture also belongs to the document in which it opened. */
export function useTraceCommitLifetime(dialogRequestToken: string): () => () => boolean {
  const unmountEpoch = useRef(0);
  const openingDocumentEpoch = useRef(useStore.getState().projectDocumentEpoch).current;
  useEffect(
    () => () => {
      unmountEpoch.current += 1;
    },
    [],
  );
  return () => {
    const epoch = unmountEpoch.current;
    const camera = useUiStore.getState().imageDialog?.sourceOrigin === 'camera-capture';
    return () =>
      epoch === unmountEpoch.current &&
      useUiStore.getState().imageDialog?.requestToken === dialogRequestToken &&
      (!camera || useStore.getState().projectDocumentEpoch === openingDocumentEpoch);
  };
}
