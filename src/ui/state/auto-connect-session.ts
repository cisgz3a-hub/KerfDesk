// What auto-connect (ADR-420) knows for this run of KerfDesk only (ADR-639).
// Never stored: the saved "Connect automatically" preference stays as the
// operator set it, and a restart starts with auto-connect free to run.
//
//   paused   the operator's Disconnect or Forget Controller (set by those
//            handlers, not by the store's disconnect), so a plug-in or power-cycle
//            must not take the port from another program; a connect someone
//            asked for lifts it once its port opens.
//   skipped  why the last automatic open failed (usually another program
//            holding the port), for the rail's quiet hint; any Connect clears it.

import { create } from 'zustand';

export type AutoConnectSessionState = {
  readonly paused: boolean;
  readonly skippedReason: string | null;
};

const INITIAL: AutoConnectSessionState = { paused: false, skippedReason: null };

export const useAutoConnectSession = create<AutoConnectSessionState>(() => INITIAL);

export function pauseAutoConnect(): void {
  useAutoConnectSession.setState({ paused: true, skippedReason: null });
}

/** A connect someone asked for opened its port: auto-connect may run again. */
export function resumeAutoConnect(): void {
  useAutoConnectSession.setState(INITIAL);
}

export function noteAutoConnectSkipped(reason: string): void {
  useAutoConnectSession.setState({ skippedReason: reason });
}

export function clearAutoConnectSkipped(): void {
  if (useAutoConnectSession.getState().skippedReason === null) return;
  useAutoConnectSession.setState({ skippedReason: null });
}

export function autoConnectPaused(): boolean {
  return useAutoConnectSession.getState().paused;
}

/** Test seam: the module store outlives each test's laser-store reset. */
export function resetAutoConnectSession(): void {
  useAutoConnectSession.setState(INITIAL);
}
