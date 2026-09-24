import { useEffect, useRef } from 'react';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';

export type TraceCommitLifetime = (() => boolean) & {
  readonly signal: AbortSignal;
  readonly dispose: () => void;
  readonly ownsDialog: () => boolean;
};

/** Own the actual computation as well as publication for one submission. */
export function useTraceCommitLifetime(
  dialogRequestToken: string,
): (ownerIsCurrent?: () => boolean) => TraceCommitLifetime | null {
  const unmountEpoch = useRef(0);
  const openingDocumentEpoch = useRef(useStore.getState().projectDocumentEpoch).current;
  const active = useRef<{ abort: () => void; dispose: () => void } | null>(null);
  const submission = useRef(0);
  useEffect(
    () => () => {
      unmountEpoch.current += 1;
      active.current?.abort();
      active.current?.dispose();
    },
    [],
  );
  return (ownerIsCurrent = () => true) => {
    if (active.current !== null) return null;
    const epoch = unmountEpoch.current;
    const generation = ++submission.current;
    const camera = useUiStore.getState().imageDialog?.sourceOrigin === 'camera-capture';
    const controller = new AbortController();
    const ownsDialog = (): boolean =>
      generation === submission.current &&
      epoch === unmountEpoch.current &&
      useUiStore.getState().imageDialog?.requestToken === dialogRequestToken;
    const isCurrent = (): boolean =>
      !controller.signal.aborted &&
      ownsDialog() &&
      (!camera || useStore.getState().projectDocumentEpoch === openingDocumentEpoch) &&
      ownerIsCurrent();
    const validate = (): void => {
      if (!isCurrent()) controller.abort();
    };
    const unsubscribeStore = useStore.subscribe(validate);
    const unsubscribeUi = useUiStore.subscribe(validate);
    const dispose = (): void => {
      unsubscribeStore();
      unsubscribeUi();
      controller.signal.removeEventListener('abort', dispose);
      if (active.current === owner) active.current = null;
    };
    const owner = { abort: () => controller.abort(), dispose };
    active.current = owner;
    controller.signal.addEventListener('abort', dispose, { once: true });
    validate();
    return Object.assign(isCurrent, { signal: controller.signal, dispose, ownsDialog });
  };
}
