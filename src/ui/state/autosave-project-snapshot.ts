import { shallow } from 'zustand/shallow';
import type { Project } from '../../core/scene';
import { projectWithCurrentJobSetup } from './project-job-setup';

type AutosaveProjectState = Parameters<typeof projectWithCurrentJobSetup>[0] & {
  readonly projectDocumentEpoch: number;
};
type SnapshotMemo = Pick<
  AutosaveProjectState,
  'project' | 'projectDocumentEpoch' | 'jobPlacement' | 'outputScopeSettings'
> & { readonly snapshot: Project };

// The store replaces Project on edits, but adding the current job setup also
// makes a fresh wrapper. Retain that wrapper between unchanged autosave ticks
// so the interval's successful-write/quota memo can skip serialization.
// Keep this cache local to one mounted loop and to the active document epoch.
export function createAutosaveProjectSnapshot(): (state: AutosaveProjectState) => Project {
  let memo: SnapshotMemo | null = null;
  return (state) => {
    if (
      memo !== null &&
      memo.project === state.project &&
      memo.projectDocumentEpoch === state.projectDocumentEpoch &&
      shallow(memo.jobPlacement, state.jobPlacement) &&
      shallow(memo.outputScopeSettings, state.outputScopeSettings) &&
      selectionMatches(state, memo.snapshot.jobSetup.outputScope.selectedObjectIds)
    ) {
      return memo.snapshot;
    }
    const snapshot = projectWithCurrentJobSetup(state);
    memo = {
      project: state.project,
      projectDocumentEpoch: state.projectDocumentEpoch,
      jobPlacement: state.jobPlacement,
      outputScopeSettings: state.outputScopeSettings,
      snapshot,
    };
    return snapshot;
  };
}

function selectionMatches(state: AutosaveProjectState, savedIds: ReadonlyArray<string>): boolean {
  let index = state.selectedObjectId === null ? 0 : 1;
  if (savedIds.length !== index + state.additionalSelectedIds.size) return false;
  if (index === 1 && savedIds[0] !== state.selectedObjectId) return false;
  // Selection order is persisted even when selected-only output is disabled.
  // Comparing it directly also avoids treating an equal replacement Set as an edit.
  for (const id of state.additionalSelectedIds) {
    if (savedIds[index++] !== id) return false;
  }
  return true;
}
