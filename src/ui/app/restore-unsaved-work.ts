// File > Recover unsaved work (ADR-688): restore an earlier session's autosave
// over whatever is open. The open document goes through the ordinary Save /
// Don't Save / Cancel question first, as File > Open does, and the restore
// keeps a durable copy exactly as startup recovery does.

import type { PlatformAdapter } from '../../platform/types';
import { useStore } from '../state';
import type { AutosaveDurableSnapshot } from '../state/autosave-durable';
import { useLaserStore } from '../state/laser-store';
import { isActiveJob } from '../state/laser-store-helpers';
import type { ToastVariant } from '../state/toast-store';
import { confirmDiscardAsync } from './confirm-discard';
import { claimProjectOpenRequest } from './project-open-request-owner';
import { restoreAutosaveSnapshot } from './use-autosave';

type PushToast = (message: string, variant?: ToastVariant) => void;

export async function restoreUnsavedWork(
  platform: PlatformAdapter,
  snapshot: AutosaveDurableSnapshot,
  pushToast: PushToast,
): Promise<boolean> {
  if (jobActive()) {
    pushToast('Wait for the active job to settle before restoring unsaved work.', 'info');
    return false;
  }
  const initial = useStore.getState();
  const owner = claimProjectOpenRequest(
    pushToast,
    initial.claimProjectOpenRequest,
    () => useStore.getState().projectOpenRequestEpoch,
    () => useStore.getState().projectDocumentEpoch,
  );
  if (!(await confirmDiscardAsync(platform, 'restore unsaved work'))) return false;
  if (!owner.isCurrent() || jobActive()) return false;
  const restored = await restoreAutosaveSnapshot(snapshot);
  if (restored) pushToast('Restored unsaved work. Save it to keep it as a file.', 'success');
  return restored;
}

function jobActive(): boolean {
  return isActiveJob(useLaserStore.getState().streamer);
}
