import type { ProjectEditCommit } from './project-actions';
import { useStore } from './store';

/**
 * Commits an edit through the store's authoring guard now, or not at all. A
 * Pro prompt it raises never applies the edit later, so a dialog that stays
 * open can report the refusal and the operator applies again once Pro is
 * unlocked. Returns whether the edit was committed.
 */
export function commitProjectEditNow(update: Parameters<ProjectEditCommit>[0]): boolean {
  let calling = true;
  try {
    return useStore.getState().commitProjectEdit(update, undefined, () => calling);
  } finally {
    calling = false;
  }
}
