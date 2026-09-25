// Which saved machine a live connection looks like (ADR-374). The notice built
// on this only ever offers a switch: a machine is suggested when its recorded
// controller agrees with the connection and no other saved machine does.

import { fingerprintMatchBasis, type ControllerFingerprint } from './controller-fingerprint';
import type { SavedMachine, SavedMachineList } from './saved-machine-list';

export type SavedMachineMatch = {
  readonly machine: SavedMachine;
  /** Why it matched, for the notice: "12 controller settings", "USB 303A:1001". */
  readonly basis: ReadonlyArray<string>;
};

/** Every saved machine whose recorded controller agrees with the connection. */
export function matchingSavedMachines(
  observed: ControllerFingerprint,
  machines: ReadonlyArray<SavedMachine>,
): ReadonlyArray<SavedMachineMatch> {
  const matches: SavedMachineMatch[] = [];
  for (const machine of machines) {
    const recorded = machine.controllerFingerprint;
    if (recorded === undefined) continue;
    const basis = fingerprintMatchBasis(recorded, observed);
    if (basis !== null) matches.push({ machine, basis });
  }
  return matches;
}

/** The single saved machine this connection looks like, unless it is already
 * the open one. Two or more candidates mean the evidence cannot tell them
 * apart, so nothing is suggested. */
export function savedMachineSuggestion(
  observed: ControllerFingerprint,
  list: SavedMachineList,
  activeSavedMachineId: string | undefined,
): SavedMachineMatch | null {
  const matches = matchingSavedMachines(observed, list.machines);
  const only = matches.length === 1 ? matches[0] : undefined;
  if (only === undefined || only.machine.id === activeSavedMachineId) return null;
  return only;
}
