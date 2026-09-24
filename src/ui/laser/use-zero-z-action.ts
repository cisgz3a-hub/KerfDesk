// use-zero-z-action — the jog pad's Zero Z click handler. Runs the
// zero-z-guard confirmation against the live store state before writing
// G92 Z0: the guard is what stops a parked-height click (post-probe
// retract, post-frame safe-Z) from silently moving work Z0 into the air.

import { useCallback } from 'react';
import { currentWorkZMm } from '../state/infer-machine-position';
import { jobAwareConfirm } from '../state/job-aware-dialogs';
import { useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import { controllerActionFailureHandler } from './report-controller-action-failure';
import { zeroZOverwriteWarning } from './zero-z-guard';

export function useZeroZAction(): () => void {
  // The live state is read at the click. Subscribing to it re-rendered the
  // whole jog panel on every status poll of a running job, only to hold values
  // this handler reads once (ADR-352).
  return useCallback((): void => {
    const state = useLaserStore.getState();
    const warning = zeroZOverwriteWarning({
      evidence: state.workZZeroEvidence,
      referenceEpoch: state.workZReferenceEpoch,
      workZMm: currentWorkZMm(
        state.statusReport,
        state.wcoCache,
        state.controllerSettings?.reportInches === true,
      ),
    });
    if (warning !== null && !jobAwareConfirm(warning)) return;
    // Both outcomes are visible: the DRO does not show work Z, and a refusal
    // used to become an unhandled rejection with no message (audit ui-panel-5).
    void state
      .zeroZHere()
      .then(() =>
        useToastStore
          .getState()
          .pushToast('Work Z0 set at the current bit height (G92 Z0).', 'success'),
      )
      .catch(controllerActionFailureHandler('Zero Z'));
  }, []);
}
