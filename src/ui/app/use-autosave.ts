// useAutosave + useAutosaveRecovery — wires the autosave module to the
// React lifecycle. Two effects, mounted once each in App.
//
// useAutosave:
//   * 30s interval that snapshots project + dirty + streaming from
//     both stores into atomic IndexedDB, with localStorage fallback.
//   * beforeunload listener that preserves the existing synchronous
//     localStorage best effort. Large projects recover the last completed
//     interval snapshot because unload cannot await IndexedDB.
//   Stops scheduling on unmount; the browser releases session ownership.
//
// useAutosaveRecovery:
//   Runs once on mount. If durable storage has an autosave AND the
//   current project is empty (no objects), asks the user (job-aware
//   confirm) whether to restore. Restoring keeps the slot armed until
//   the first manual save (M15); declining discards it so the user
//   isn't re-prompted next session.

import { useEffect } from 'react';
import { useStore } from '../state';
import { AUTOSAVE_INTERVAL_MS, writeAutosave } from '../state/autosave';
import {
  projectAutosaveService,
  type AutosaveDurableClearResult,
  type AutosaveDurableReadResult,
  type AutosaveDurableSnapshot,
  type AutosaveDurableWriteResult,
} from '../state/autosave-durable';
import { startAutosaveLoop } from '../state/autosave-loop';
import { jobAwareConfirm } from '../state/job-aware-dialogs';
import { useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import { loadedMachineCapabilityWarningMessage } from '../machine/machine-capability-messages';
import { projectWithCurrentJobSetup } from '../state/project-job-setup';

export const AUTOSAVE_FAILURE_MESSAGE =
  'Autosave could not preserve the newest project. Save the .lf2 file manually; image-heavy projects can exceed browser storage.';
export const AUTOSAVE_RECOVERY_DEGRADED_MESSAGE =
  'The newest autosave was unavailable; CurveDesk recovered the previous complete snapshot.';
export const AUTOSAVE_RECOVERY_STORAGE_MESSAGE =
  'Autosave recovery storage could not be fully read. Any available local recovery was still checked.';
export const AUTOSAVE_RECOVERY_RETAINED_MESSAGE =
  'The source autosave belongs to another or unverified window, so CurveDesk retained it instead of deleting it.';

type PushToast = ReturnType<typeof useToastStore.getState>['pushToast'];

export function createAutosaveFailureReporter(pushToast: PushToast): () => void {
  let hasWarned = false;
  return () => {
    if (hasWarned) return;
    hasWarned = true;
    pushToast(AUTOSAVE_FAILURE_MESSAGE, 'warning');
  };
}

function snapshotForAutosave(): {
  readonly project: ReturnType<typeof useStore.getState>['project'];
  readonly dirty: boolean;
  readonly isStreaming: boolean;
} {
  const s = useStore.getState();
  const ls = useLaserStore.getState();
  const streamer = ls.streamer;
  const isStreaming =
    streamer !== null && (streamer.status === 'streaming' || streamer.status === 'paused');
  return { project: projectWithCurrentJobSetup(s), dirty: s.dirty, isStreaming };
}

export function useAutosave(): void {
  const pushToast = useToastStore((s) => s.pushToast);
  useEffect(() => {
    const reportAutosaveFailure = createAutosaveFailureReporter(pushToast);
    const stopInterval = startAutosaveLoop(
      snapshotForAutosave,
      AUTOSAVE_INTERVAL_MS,
      reportAutosaveFailure,
      (project) => projectAutosaveService.write(project),
    );
    void projectAutosaveService.session();
    const onBeforeUnload = (): void => {
      const snap = snapshotForAutosave();
      // Even mid-stream: if the user closed the window, persisting
      // their scene is more important than respecting "don't write
      // during streaming." The streaming guard exists so the 30s
      // interval doesn't perturb the render loop — that no longer
      // applies once the page is unloading.
      if (snap.dirty) {
        const result = writeAutosave(snap.project);
        if (result.kind !== 'ok') reportAutosaveFailure();
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      stopInterval();
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [pushToast]);
}

type AutosaveRecoveryService = {
  readLatest(): Promise<AutosaveDurableReadResult>;
  write(
    project: ReturnType<typeof snapshotForAutosave>['project'],
  ): Promise<AutosaveDurableWriteResult>;
  clearRecovered(
    snapshot: AutosaveDurableSnapshot,
    retainedStorageKey?: string,
  ): Promise<AutosaveDurableClearResult>;
};

export async function runAutosaveRecovery(
  // jobAwareConfirm is a pass-through native confirm here (recovery runs at
  // app start, before any connection), but keeps the raw-dialog lint ban
  // (H13) airtight with a single exempt module.
  confirmRestore: (message: string) => boolean = jobAwareConfirm,
  service: AutosaveRecoveryService = projectAutosaveService,
): Promise<void> {
  const entryDocumentEpoch = useStore.getState().projectDocumentEpoch;
  const read = await service.readLatest();
  reportRecoveryWarnings(read);
  const record = read.snapshot;
  if (record === null) return;
  // Only prompt if the in-memory project is still the empty default.
  // If something already loaded (URL drop, deep-link, etc.), the user
  // is mid-workflow and recovery would clobber it. Leave the slot alone
  // (M15: clearing here silently destroyed the only backup).
  const s = useStore.getState();
  if (
    s.projectDocumentEpoch !== entryDocumentEpoch ||
    s.dirty ||
    s.project.scene.objects.length > 0
  ) {
    return;
  }
  const ageMin = Math.max(0, Math.round((Date.now() - record.savedAt) / 60_000));
  const ageLabel = ageMin === 0 ? 'less than a minute ago' : `${ageMin} minute(s) ago`;
  const ok = confirmRestore(
    `CurveDesk found an auto-saved project from ${ageLabel}. Restore it?\n\n` +
      '(Click Cancel to discard the auto-save and start fresh.)',
  );
  if (ok) {
    const loadResult = s.setProject(record.project);
    if (loadResult.kind === 'capability-warning') {
      useToastStore
        .getState()
        .pushToast(loadedMachineCapabilityWarningMessage(loadResult.activeKind), 'warning');
    }
    // M15 (AUDIT-2026-06-10): the restored project's ONLY durable copy is
    // the autosave slot. Mark it dirty so the 30 s loop, the beforeunload
    // write, and the discard confirms all stay armed — and KEEP a slot;
    // handleSaveProject clears it after the first successful manual save.
    useStore.setState({ dirty: true });
    // PST-01: the restore may have come from a *dead* window session's slot
    // (or the legacy key). Re-home the copy into THIS session's slot so the
    // first manual save's no-arg clearAutosave() actually clears it — the dead
    // slot would otherwise linger and re-prompt on every later empty launch.
    // Re-write BEFORE clearing so a durable copy always exists (M15); on a
    // write failure keep the source slot rather than lose the only backup.
    // When the source already IS this session's slot (same-tab reload), the
    // re-home targets the same key, so skip the clear and leave it in place.
    const rehome = await service.write(record.project);
    if (rehome.kind === 'ok') {
      reportCleanupResult(await service.clearRecovered(record, rehome.storageKey));
    } else {
      useToastStore.getState().pushToast(AUTOSAVE_FAILURE_MESSAGE, 'warning');
    }
    return;
  }
  // Declining is an explicit discard — clearing stops the re-prompt loop.
  reportCleanupResult(await service.clearRecovered(record));
}

export function useAutosaveRecovery(): void {
  useEffect(() => {
    void runAutosaveRecovery();
  }, []);
}

function reportRecoveryWarnings(result: AutosaveDurableReadResult): void {
  if (result.warnings.includes('recovered-previous')) {
    useToastStore.getState().pushToast(AUTOSAVE_RECOVERY_DEGRADED_MESSAGE, 'warning');
  }
  if (
    result.warnings.includes('indexeddb-read-failed') ||
    result.warnings.includes('local-read-failed') ||
    result.warnings.includes('corrupt-slot')
  ) {
    useToastStore.getState().pushToast(AUTOSAVE_RECOVERY_STORAGE_MESSAGE, 'warning');
  }
  if (result.warnings.includes('ownership-probe-failed')) {
    useToastStore.getState().pushToast(AUTOSAVE_RECOVERY_RETAINED_MESSAGE, 'warning');
  }
}

function reportCleanupResult(result: AutosaveDurableClearResult): void {
  if (result.kind === 'ok') return;
  useToastStore
    .getState()
    .pushToast(
      result.kind === 'retained'
        ? AUTOSAVE_RECOVERY_RETAINED_MESSAGE
        : 'Autosave cleanup did not complete; an older recovery prompt may appear again.',
      'warning',
    );
}
