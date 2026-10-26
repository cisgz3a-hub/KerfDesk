// The setters store.ts hands its action slices, built here so the store's
// create call stays within ADR-015's size rule.

import { freeProArtworkSetter } from '../licensing/pro-operation-mutation';
import { jobMachineGuardSetter } from './job-machine-lock';
import { numberingEditGuardSetter } from './numbering-edit-guard';
import { reliefLinkMutationSetter } from './relief-link-mutation';
import type { AppState } from './store';

type Patch = AppState | Partial<AppState>;
type Setter = (patch: Patch | ((state: AppState) => Patch)) => void;

export type StoreSetters = {
  /** Document replacement, history and save tracking. */
  readonly documentSet: Setter;
  /** Interactions (drags, numbering) and, through `set`, every other edit. */
  readonly interactionSet: Setter;
  readonly set: Setter;
};

export function storeSetters(unguardedSet: Setter): StoreSetters {
  // A running or held job keeps its machine, whatever writes it (ADR-416 Amendment 2).
  const rawSet = jobMachineGuardSetter(unguardedSet);
  const documentSet = reliefLinkMutationSetter(rawSet);
  // Free edits existing Pro work's settings, not its artwork (ADR-592). Document
  // replacement, history and save tracking keep the setter without that guard.
  // Refresh linked relief data before checking the resulting artwork, so a
  // Free edit to a linked vector cannot silently author a different relief.
  const interactionSet = reliefLinkMutationSetter(freeProArtworkSetter(rawSet));
  // Canvas numbering holds one interaction open; edits that Cancel would revert
  // stand down until it closes. Only the interaction itself skips this guard.
  const set = numberingEditGuardSetter(interactionSet);
  return { documentSet, interactionSet, set };
}
