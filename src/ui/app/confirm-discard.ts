// confirmDiscardAsync — the dirty-project guard in front of destructive
// actions (New / Open / test-grid generation), LU18 (AUDIT-2026-06-10) /
// WORKFLOW F-A13. Replaces the two-button window.confirm with LightBurn's
// three-way Save / Don't Save / Cancel dialog: resolves true when the
// caller may proceed (changes saved, or explicitly discarded), false when
// the user cancelled — including cancelling the save picker, which must
// abort the destructive action rather than fall through to a discard.

import type { PlatformAdapter } from '../../platform/types';
import { useStore } from '../state';
import { useConfirmSaveStore, type ConfirmSaveChoice } from '../state/confirm-save-store';
import { JOB_ACTIVE_CONFIRM_BLOCKED } from '../state/job-aware-dialogs';
import { isActiveJob } from '../state/laser-store-helpers';
import { useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import { handleSaveProject, type SaveProjectOutcome } from './file-actions';

export async function confirmDiscardAsync(
  platform: PlatformAdapter,
  action: string,
): Promise<boolean> {
  const state = useStore.getState();
  if (!state.dirty) return true;
  // Fail closed while a job is active (H13 / non-negotiable #9): the
  // dialog backdrop would cover Pause/Abort with the beam live. Same
  // policy as jobAwareConfirm; Ctrl+. still stops without confirmation.
  if (isActiveJob(useLaserStore.getState().streamer)) {
    useToastStore.getState().pushToast(JOB_ACTIVE_CONFIRM_BLOCKED, 'warning');
    return false;
  }
  const choice = await requestChoice(state.savedName ?? 'this project', action);
  if (choice === 'cancel') return false;
  if (choice === 'discard') return true;
  return (await saveNow(platform)) === 'saved';
}

function requestChoice(projectName: string, action: string): Promise<ConfirmSaveChoice> {
  return new Promise((resolve) => {
    useConfirmSaveStore.getState().open({ projectName, action, resolve });
  });
}

// Re-read the store after the dialog resolves: the project must be
// serialized as it exists at Save-click time, not as captured when the
// guard was invoked.
async function saveNow(platform: PlatformAdapter): Promise<SaveProjectOutcome> {
  const state = useStore.getState();
  return handleSaveProject({
    platform,
    project: state.project,
    savedName: state.savedName,
    lastSaveTarget: state.lastSaveTarget,
    markSaved: state.markSaved,
    pushToast: useToastStore.getState().pushToast,
  });
}
