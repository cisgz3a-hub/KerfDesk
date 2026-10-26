import { useEffect, useState } from 'react';
import { controllerStoppedResponding } from '../state/controller-recovery-status';
import { useLaserStore, type LaserState } from '../state/laser-store';

/** How often the connection bar re-reads the silence rule on its own. */
export const SILENCE_RECHECK_MS = 1_000;

/**
 * "Not responding" for the connection bar (ADR-611 Amendment 1). The store
 * re-reads the rule on every write, and a timer re-reads it once a second: a
 * status write stuck in a wedged transport, the case this label exists for,
 * stops the poll from writing to the store, so the deadline would otherwise
 * pass unseen.
 */
export function useControllerWentSilent(connected: boolean): boolean {
  return useRecheckedSilence(connected, readWentSilent);
}

/** "Stopped responding" for the canvas recovery card (ADR-642), re-read the
 * same way so a wedged transport still opens it. */
export function useControllerStoppedResponding(connected: boolean): boolean {
  return useRecheckedSilence(connected, controllerStoppedResponding);
}

function readWentSilent(state: LaserState): boolean {
  return state.getControllerWentSilent();
}

function useRecheckedSilence(connected: boolean, read: (state: LaserState) => boolean): boolean {
  const [silent, setSilent] = useState(false);
  useEffect(() => {
    if (!connected) {
      setSilent(false);
      return undefined;
    }
    const check = (): void => setSilent(read(useLaserStore.getState()));
    check();
    const unsubscribe = useLaserStore.subscribe(check);
    const timer = window.setInterval(check, SILENCE_RECHECK_MS);
    return () => {
      unsubscribe();
      window.clearInterval(timer);
    };
  }, [connected, read]);
  return silent;
}
