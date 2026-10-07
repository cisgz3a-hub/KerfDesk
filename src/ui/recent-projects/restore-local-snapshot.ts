import type { PlatformAdapter } from '../../platform/types';
import { confirmDiscardAsync } from '../app/confirm-discard';
import { completeNativeProjectOpen } from '../app/project-open-completion';
import { parseOpenedProjectFile } from '../app/project-open-parser';
import { claimProjectOpenRequest } from '../app/project-open-request-owner';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { isActiveJob } from '../state/laser-store-helpers';
import type { ToastVariant } from '../state/toast-store';
import type { LocalSnapshotStorage } from './local-snapshot-storage';

type PushToast = (message: string, variant?: ToastVariant) => void;

/** Restore through normal document admission, owning no writable source file. */
export async function restoreLocalSnapshot(
  platform: PlatformAdapter,
  storage: LocalSnapshotStorage,
  id: string,
  pushToast: PushToast,
): Promise<boolean> {
  if (jobActive()) {
    pushToast('Wait for the active job to settle before opening a local snapshot.', 'info');
    return false;
  }
  const initial = useStore.getState();
  const owner = claimProjectOpenRequest(
    pushToast,
    initial.claimProjectOpenRequest,
    () => useStore.getState().projectOpenRequestEpoch,
    () => useStore.getState().projectDocumentEpoch,
  );
  try {
    if (!(await confirmDiscardAsync(platform, 'restore a local snapshot as a new project')))
      return false;
    if (!canRestore(owner.isCurrent)) return false;
    const unchanged = useStore.getState().project;
    const snapshot = await storage.read(id);
    if (!owner.isCurrent()) return false;
    if (snapshot === null) throw new Error('This local snapshot has been removed.');
    const fileName = `${snapshot.name.replace(/\.lf2$/i, '')} - restored.lf2`;
    const file = {
      name: fileName,
      size: snapshot.bytes,
      text: async () => snapshot.projectJson,
      blob: async () => new Blob([snapshot.projectJson], { type: 'application/json' }),
    };
    const parsed = await parseOpenedProjectFile(file, {}, owner.pushToast);
    if (!canRestore(owner.isCurrent)) return false;
    if (useStore.getState().project !== unchanged) {
      owner.pushToast(
        'The project changed while the snapshot was opening. Restore it again.',
        'warning',
      );
      return false;
    }
    if (parsed.kind !== 'native') throw new Error('This snapshot is not a KerfDesk project.');
    const state = useStore.getState();
    const opened = completeNativeProjectOpen({ ...state, pushToast }, fileName, parsed.result);
    if (!opened) return false;
    state.markLoaded(fileName, { dirty: true });
    pushToast(
      'Restored a new project from the local snapshot. Save will ask for a destination.',
      'success',
    );
    return true;
  } catch (error) {
    owner.pushToast(
      error instanceof Error ? error.message : 'Could not restore the local snapshot.',
      'error',
    );
    return false;
  }
}

function jobActive(): boolean {
  return isActiveJob(useLaserStore.getState().streamer);
}

function canRestore(isCurrent: () => boolean): boolean {
  return isCurrent() && !jobActive();
}
