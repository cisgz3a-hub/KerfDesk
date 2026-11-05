import type { Project } from '../../core/scene';
import type { SaveTarget } from '../../platform/types';
import type { AppState } from '../state/store';
import type { ToastVariant } from '../state/toast-store';
import { clearAutosaveAfterFileHandoff } from './autosave-file-cleanup';

export type SaveProjectOutcome =
  | 'saved'
  | 'saved-with-newer-edits'
  | 'stale-document'
  | 'stale-request'
  | 'cancelled'
  | 'error';

export const SAVE_COMPLETED_WITH_NEWER_EDITS_MESSAGE =
  'Saved the captured version; newer edits remain unsaved and recovery is preserved.';

export type ProjectSaveOwner = {
  readonly expectedProject: Project;
  readonly projectDocumentEpoch: number;
  readonly getProjectDocumentEpoch: () => number;
  readonly projectSaveRequestEpoch: number;
  readonly getProjectSaveRequestEpoch: () => number;
  readonly markSaved: AppState['markSaved'];
  readonly markProjectSaveUncertain: AppState['markProjectSaveUncertain'];
  readonly pushToast: (message: string, variant?: ToastVariant) => void;
};

export function completeProjectSave(
  owner: ProjectSaveOwner,
  target: SaveTarget,
  reusedTarget: boolean,
): SaveProjectOutcome {
  const stale = staleProjectSaveOutcome(owner);
  if (stale !== null) return stale;
  if (
    !owner.markSaved(
      target,
      owner.expectedProject,
      owner.projectDocumentEpoch,
      owner.projectSaveRequestEpoch,
    )
  ) {
    owner.pushToast(SAVE_COMPLETED_WITH_NEWER_EDITS_MESSAGE, 'warning');
    return 'saved-with-newer-edits';
  }
  clearAutosaveAfterFileHandoff(owner.pushToast);
  owner.pushToast(reusedTarget ? 'Saved' : `Saved project to ${target.displayName}`, 'success');
  return 'saved';
}

export function failProjectSave(owner: ProjectSaveOwner, message: string): SaveProjectOutcome {
  const stale = staleProjectSaveOutcome(owner);
  if (stale !== null) return stale;
  owner.pushToast(`Could not save project: ${message}`, 'error');
  return 'error';
}

const SAVE_KEPT = 'Your design is still open and nothing was lost.';

/** A failed write in a beginner's words: the browser's exception text ("An
 *  attempt was made to modify an object where modifications are not
 *  allowed.") names no next step (UX audit U5-P3-11). */
export function projectWriteFailureMessage(error: unknown): string {
  const name = error instanceof Error || error instanceof DOMException ? error.name : '';
  const message = error instanceof Error ? error.message : String(error);
  if (
    /^(NoModificationAllowed|NotAllowed|Security|InvalidModification)Error$/.test(name) ||
    /\b(EACCES|EPERM|EROFS)\b/.test(message)
  ) {
    return `KerfDesk couldn't write to that file or folder. Choose another place, such as Documents, with File > Save As. ${SAVE_KEPT}`;
  }
  if (name === 'QuotaExceededError' || /\bENOSPC\b/.test(message)) {
    return `There isn't enough free space to save there. Free some space, or choose another drive with File > Save As. ${SAVE_KEPT}`;
  }
  return `Could not save project: ${message}. ${SAVE_KEPT} Try File > Save As to choose another place.`;
}

export function failProjectWrite(owner: ProjectSaveOwner, error: unknown): SaveProjectOutcome {
  const stale = staleProjectSaveOutcome(owner);
  if (stale !== null) return stale;
  owner.pushToast(projectWriteFailureMessage(error), 'error');
  return 'error';
}

export function staleProjectSaveOutcome(
  owner: ProjectSaveOwner,
): Extract<SaveProjectOutcome, 'stale-document' | 'stale-request'> | null {
  if (owner.getProjectDocumentEpoch() !== owner.projectDocumentEpoch) return 'stale-document';
  return owner.getProjectSaveRequestEpoch() === owner.projectSaveRequestEpoch
    ? null
    : 'stale-request';
}
