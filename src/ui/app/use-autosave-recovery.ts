import { useEffect, useState } from 'react';
import { useStore } from '../state';
import { useToastStore } from '../state/toast-store';
import { AUTOSAVE_RECOVERY_STORAGE_MESSAGE, runAutosaveRecovery } from './use-autosave';

type RecoveryOffer = {
  readonly ageLabel: string;
  readonly restore: () => void;
  readonly hide: () => void;
};

export function useAutosaveRecovery(): RecoveryOffer | null {
  const [offer, setOffer] = useState<RecoveryOffer | null>(null);
  useEffect(() => {
    let cancelled = false;
    let settle: ((choice: boolean | null) => void) | undefined;
    const entry = useStore.getState();
    const finish = (choice: boolean | null): void => {
      setOffer(null);
      settle?.(choice);
      settle = undefined;
    };
    // A fresh document (even an empty one) or any edit retires the offer.
    const unsubscribe = useStore.subscribe((state) => {
      if (cancelled) return;
      if (
        state.project !== entry.project ||
        state.projectDocumentEpoch !== entry.projectDocumentEpoch ||
        state.dirty
      ) {
        cancelled = true;
        finish(null);
      }
    });
    void runAutosaveRecovery((ageLabel) => {
      if (cancelled) return null;
      return new Promise<boolean | null>((resolve) => {
        settle = resolve;
        setOffer({ ageLabel, restore: () => finish(true), hide: () => finish(null) });
      });
    }).catch(() => {
      if (!cancelled) {
        finish(null);
        useToastStore.getState().pushToast(AUTOSAVE_RECOVERY_STORAGE_MESSAGE, 'warning');
      }
    });
    return () => {
      cancelled = true;
      unsubscribe();
      settle?.(null);
    };
  }, []);
  return offer;
}
