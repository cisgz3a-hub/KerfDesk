import { useEffect, useState } from 'react';
import type { Project } from '../../core/scene';
import { useStore } from '../state';
import { useToastStore } from '../state/toast-store';
import { AUTOSAVE_RECOVERY_STORAGE_MESSAGE, runAutosaveRecovery } from './use-autosave';
import { rememberStartFresh, startedFreshFrom } from './autosave-recovery-summary';

type RecoveryOffer = {
  readonly ageLabel: string;
  readonly project: Project;
  readonly restore: () => void;
  /** Keep the autosave, reachable from File > Recover unsaved work (ADR-688). */
  readonly startFresh: () => void;
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
    // A fresh document (even an empty one) or any edit retires the offer. The
    // autosave itself stays listed in File > Recover unsaved work.
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
    void runAutosaveRecovery((ageLabel, snapshot) => {
      if (cancelled || startedFreshFrom(snapshot)) return null;
      return new Promise<boolean | null>((resolve) => {
        settle = resolve;
        setOffer({
          ageLabel,
          project: snapshot.project,
          restore: () => finish(true),
          startFresh: () => {
            rememberStartFresh(snapshot);
            finish(null);
          },
        });
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
