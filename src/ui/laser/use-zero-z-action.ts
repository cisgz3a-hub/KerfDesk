// use-zero-z-action — the jog pad's Zero Z click handler. Runs the
// zero-z-guard confirmation against the live store state before writing
// G92 Z0: the guard is what stops a parked-height click (post-probe
// retract, post-frame safe-Z) from silently moving work Z0 into the air.

import { useCallback } from 'react';
import { currentWorkZMm } from '../state/infer-machine-position';
import { jobAwareConfirm } from '../state/job-aware-dialogs';
import { useLaserStore } from '../state/laser-store';
import { zeroZOverwriteWarning } from './zero-z-guard';

export function useZeroZAction(): () => void {
  const zeroZHere = useLaserStore((s) => s.zeroZHere);
  const statusReport = useLaserStore((s) => s.statusReport);
  const wcoCache = useLaserStore((s) => s.wcoCache);
  const reportInches = useLaserStore((s) => s.controllerSettings?.reportInches === true);
  const evidence = useLaserStore((s) => s.workZZeroEvidence);
  const referenceEpoch = useLaserStore((s) => s.workZReferenceEpoch);
  return useCallback((): void => {
    const warning = zeroZOverwriteWarning({
      evidence,
      referenceEpoch,
      workZMm: currentWorkZMm(statusReport, wcoCache, reportInches),
    });
    if (warning !== null && !jobAwareConfirm(warning)) return;
    void zeroZHere();
  }, [evidence, referenceEpoch, reportInches, statusReport, wcoCache, zeroZHere]);
}
