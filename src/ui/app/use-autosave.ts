// useAutosave wires the autosave module to the React lifecycle.
//
// useAutosave:
//   * 30s interval that snapshots project + dirty + streaming from
//     both stores into atomic IndexedDB, with localStorage fallback.
//     It keeps running while a job streams when the job gate lets the
//     project through (ADR-305 Amendment 1).
//   * beforeunload listener that preserves the existing synchronous
//     localStorage best effort. Large projects recover the last completed
//     interval snapshot because unload cannot await IndexedDB.
//   Stops scheduling on unmount; the browser releases session ownership.
//
// Recovery is offered by AutosaveRecoveryCard without blocking startup, and
// File > Recover unsaved work lists earlier sessions' slots (ADR-688).
// Restoring keeps a durable copy until the first manual save (M15).

import { useEffect } from 'react';
import { useStore } from '../state';
import { AUTOSAVE_INTERVAL_MS, writeAutosave, type AutosaveWriteFailure } from '../state/autosave';
import { AutosavePreparationTimeoutError } from '../state/autosave-preparation-client';
import {
  projectAutosaveService,
  type AutosaveDurableClearResult,
  type AutosaveDurableReadResult,
  type AutosaveDurableSnapshot,
  type AutosaveDurableWriteResult,
} from '../state/autosave-durable';
import { createAutosaveJobGate, type AutosaveJobGate } from '../state/autosave-job-gate';
import { startAutosaveLoop, type AutosaveSnapshotFn } from '../state/autosave-loop';
import { createAutosaveProjectSnapshot } from '../state/autosave-project-snapshot';
import { useBackgroundSaveHealth } from '../state/background-save-health';
import { noteProjectCopyOnDisk } from '../state/design-document-copies';
import { useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import {
  projectLoadRefused,
  type ProjectMachineCapabilityLoadResult,
} from '../state/project-machine-capability';
import { pushProjectLoadNotices } from '../state/project-load-notices';
import { loadedMachineCapabilityWarningMessage } from '../machine/machine-capability-messages';
import { preserveUnadmittedProProject } from '../state/pending-pro-project';
import { initialLicenceStatus } from '../licensing/edition';
import { isAutosaveDiscardPending } from './autosave-file-cleanup';
import { rememberStartFresh } from './autosave-recovery-summary';
import { desktopCloseController } from './desktop-close-runtime';
import { platformCanPickFiles } from './browser-file-access';
import { usePlatformOptional } from './platform-context';
import { requestPersistentStorageOnce } from './persistent-storage-request';

export const AUTOSAVE_FAILURE_MESSAGE =
  'Autosave could not preserve the newest project. Save the .lf2 file manually; image-heavy projects can exceed browser storage.';
// A deadline, not storage: the recovery copy was not ready within 60 seconds
// (performance audit S3-P2-2 found the storage wording sent users the wrong way).
export const AUTOSAVE_TIMEOUT_MESSAGE =
  'Autosave could not prepare a recovery copy of the newest project within 60 seconds. Save the .lf2 file manually.';
// The status bar's tooltip while a job holds an autosave back (ADR-305 Amendment 1).
export const AUTOSAVE_WAITING_FOR_JOB_MESSAGE =
  'Autosave is waiting for the job to end: copying this project now could disturb the job. Changes made during the job have no recovery copy yet. Save the project to keep them now.';
export const AUTOSAVE_RECOVERY_DEGRADED_MESSAGE =
  'The newest autosave was unavailable; KerfDesk recovered the previous complete snapshot.';
export const AUTOSAVE_RECOVERY_STORAGE_MESSAGE =
  'Autosave recovery storage could not be fully read. Any available local recovery was still checked.';
export const AUTOSAVE_RECOVERY_RETAINED_MESSAGE =
  'The source autosave belongs to another or unverified window, so KerfDesk retained it instead of deleting it.';
export const AUTOSAVE_RECOVERY_VERSION_MESSAGE =
  'An autosave needs a different app version. It has been kept unchanged; reopen it using the version that saved it.';

type PushToast = ReturnType<typeof useToastStore.getState>['pushToast'];

// A project the loader refuses is not a storage problem: quote the refusal,
// which names the object (ADR-307 Amendment 5, audit W5-P2-1), instead of
// blaming image size and sending the operator to a Save that fails too.
export function autosaveInvalidProjectMessage(reason: string): string {
  return `Autosave cannot keep a recovery copy, and Save will refuse it too: ${reason.replace(/\.$/, '')}.`;
}

function autosaveFailureMessage(failure: AutosaveWriteFailure | undefined): string {
  if (failure?.kind !== 'failed') return AUTOSAVE_FAILURE_MESSAGE;
  if (failure.error instanceof AutosavePreparationTimeoutError) return AUTOSAVE_TIMEOUT_MESSAGE;
  if (failure.reason === 'invalid-project' && failure.error instanceof Error) {
    return autosaveInvalidProjectMessage(failure.error.message);
  }
  return AUTOSAVE_FAILURE_MESSAGE;
}

/**
 * Warns once per session for each cause, naming the cause the failure carries.
 * Every failure also sets the status bar's lasting sign, which stays until a
 * write succeeds (annoyance audit A5-P2-1).
 */
export function createAutosaveFailureReporter(
  pushToast: PushToast,
): (failure?: AutosaveWriteFailure) => void {
  const warned = new Set<string>();
  return (failure) => {
    const message = autosaveFailureMessage(failure);
    useBackgroundSaveHealth.getState().noteFailed('autosave', message);
    if (warned.has(message)) return;
    warned.add(message);
    pushToast(message, 'warning');
  };
}

function createSnapshotForAutosave(noteJob: (active: boolean) => void): AutosaveSnapshotFn {
  const snapshotProject = createAutosaveProjectSnapshot();
  return () => {
    const s = useStore.getState();
    const ls = useLaserStore.getState();
    const streamer = ls.streamer;
    const isStreaming =
      streamer !== null && (streamer.status === 'streaming' || streamer.status === 'paused');
    noteJob(isStreaming);
    return {
      project: snapshotProject(s),
      dirty: s.dirty && !isAutosaveDiscardPending(s.project),
      isStreaming,
    };
  };
}

/**
 * The autosave writer. In a browser without file pickers (Firefox, Safari) the
 * autosave holds the work until the operator downloads it, so its first
 * successful write also asks the browser to keep this site's storage
 * (ADR-688 Amendment 2). Elsewhere the first manual save asks instead.
 */
export function autosaveWriter(
  askToPersist: boolean,
  write: (
    project: ReturnType<AutosaveSnapshotFn>['project'],
  ) => Promise<AutosaveDurableWriteResult> = (project) => projectAutosaveService.write(project),
): (project: ReturnType<AutosaveSnapshotFn>['project']) => Promise<AutosaveDurableWriteResult> {
  if (!askToPersist) return write;
  return async (project) => {
    const result = await write(project);
    if (result.kind === 'ok') requestPersistentStorageOnce();
    return result;
  };
}

type AutosaveProject = ReturnType<AutosaveSnapshotFn>['project'];

/**
 * The interval's writer with its results reported: to the job gate, which
 * decides whether the next write may run during a job, and to the status
 * bar's sign, which a good write clears.
 */
export function reportingAutosaveWriter(
  write: (project: AutosaveProject) => Promise<AutosaveDurableWriteResult>,
  gate: Pick<AutosaveJobGate, 'noteWrite'>,
  jobActive: () => boolean,
): (project: AutosaveProject) => Promise<AutosaveDurableWriteResult> {
  return async (project) => {
    const duringJob = jobActive();
    let result: AutosaveDurableWriteResult;
    try {
      result = await write(project);
    } catch (error) {
      gate.noteWrite({ kind: 'failed', reason: 'storage-error', error }, duringJob);
      throw error;
    }
    gate.noteWrite(result, duringJob);
    if (result.kind === 'ok') useBackgroundSaveHealth.getState().noteSaved('autosave');
    return result;
  };
}

export function useAutosave(): void {
  const pushToast = useToastStore((s) => s.pushToast);
  const platform = usePlatformOptional();
  const askToPersist = platform !== null && !platformCanPickFiles(platform);
  useEffect(() => {
    const reportAutosaveFailure = createAutosaveFailureReporter(pushToast);
    const health = useBackgroundSaveHealth.getState();
    const gate = createAutosaveJobGate();
    let jobActive = false;
    const snapshotForAutosave = createSnapshotForAutosave((active) => {
      jobActive = active;
      gate.noteJob(active);
    });
    const stopInterval = startAutosaveLoop(
      snapshotForAutosave,
      AUTOSAVE_INTERVAL_MS,
      reportAutosaveFailure,
      reportingAutosaveWriter(autosaveWriter(askToPersist), gate, () => jobActive),
      {
        // The writer works in a worker, so a job need not stop it (ADR-305
        // Amendment 1); the gate bounds what is left on this thread.
        writeDuringJob: gate.allows,
        onWaitingForJob: (waiting) =>
          health.noteWaiting('autosave', waiting ? AUTOSAVE_WAITING_FOR_JOB_MESSAGE : null),
      },
    );
    // A manual save, New or Open leaves nothing for the autosave to protect.
    const stopWatchingSaves = useStore.subscribe((state, previous) => {
      if (previous.dirty && !state.dirty) health.noteSaved('autosave');
    });
    void projectAutosaveService.session();
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      const snap = snapshotForAutosave();
      // Even mid-stream and whatever the job gate says: if the user closed
      // the window, persisting their scene matters more than the canvas
      // thread, which has nothing left to keep up with once the page unloads.
      if (snap.dirty) {
        const result = writeAutosave(snap.project);
        if (result.kind === 'ok') {
          // Before the Studio's own last write, which records that it is held.
          noteProjectCopyOnDisk(snap.project);
          // Don't Save at the desktop close question: this copy stays under
          // File > Recover unsaved work, and the next launch does not ask
          // about it (ADR-688 Amendment 3). Only this exact copy goes quiet.
          if (desktopCloseController.unloadDiscardsUnsavedWork(event)) rememberStartFresh(result);
        } else {
          reportAutosaveFailure();
        }
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      stopInterval();
      stopWatchingSaves();
      health.noteSaved('autosave');
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [pushToast, askToPersist]);
}

type AutosaveRecoveryService = {
  readLatest(): Promise<AutosaveDurableReadResult>;
  retainRecovered(snapshot: AutosaveDurableSnapshot): Promise<void>;
  write(project: ReturnType<AutosaveSnapshotFn>['project']): Promise<AutosaveDurableWriteResult>;
  clearRecovered(
    snapshot: AutosaveDurableSnapshot,
    retainedStorageKey?: string,
  ): Promise<AutosaveDurableClearResult>;
};

export async function runAutosaveRecovery(
  chooseRestore: (
    ageLabel: string,
    snapshot: AutosaveDurableSnapshot,
  ) => boolean | null | Promise<boolean | null>,
  service: AutosaveRecoveryService = projectAutosaveService,
): Promise<void> {
  const entryState = useStore.getState();
  const isUntouched = (): boolean => {
    const current = useStore.getState();
    return (
      current.projectDocumentEpoch === entryState.projectDocumentEpoch &&
      current.project === entryState.project &&
      !current.dirty &&
      current.project.scene.objects.length === 0
    );
  };
  const read = await service.readLatest();
  reportRecoveryWarnings(read);
  const record = read.snapshot;
  if (record === null) return;
  // Only offer recovery if the in-memory project is still the empty default.
  // If something already loaded (URL drop, deep-link, etc.), the user
  // is mid-workflow and recovery would clobber it. Leave the slot alone
  // (M15: clearing here silently destroyed the only backup).
  if (!isUntouched()) return;
  // Desktop starts with Pro locked until the licence status arrives; a paying
  // user's autosave must not be judged against that startup lock (ADR-592).
  await initialLicenceStatus();
  if (!isUntouched()) return;
  // A browser cannot admit Pro operations, and desktop Free admits only an
  // autosave sealed on this computer (ADR-592). Offer a portable copy before any
  // Restore/Discard choice; this source must not be rewritten or cleared here.
  if (preserveUnadmittedProProject(record.project, { source: 'autosave', name: null }) !== null) {
    await service.retainRecovered(record);
    return;
  }
  const ok = await chooseRestore(recoveryAgeLabel(record.savedAt), record);
  // The nonblocking choice may stay open while the user imports, edits, or
  // starts a new document. Neither restore nor cleanup may act on that work.
  // null means Start fresh/unmount: leave the only backup intact (ADR-688).
  if (ok === null || !isUntouched()) return;
  if (ok) {
    await restoreAutosaveSnapshot(record, service);
    return;
  }
  // Declining is an explicit discard — clearing stops the re-prompt loop.
  reportCleanupResult(await service.clearRecovered(record));
}

/**
 * Load an autosaved snapshot as the open document, keeping a durable copy.
 * Startup recovery and File > Recover unsaved work both restore through here;
 * the caller has already settled what happens to the document it replaces.
 */
export async function restoreAutosaveSnapshot(
  record: AutosaveDurableSnapshot,
  service: Pick<AutosaveRecoveryService, 'write' | 'clearRecovered'> = projectAutosaveService,
): Promise<boolean> {
  const loadResult = useStore.getState().setProject(record.project);
  if (projectLoadRefused(loadResult)) return false;
  reportRestoredProject(loadResult, record);
  // The autosave it came from holds it until the first manual save.
  noteProjectCopyOnDisk(useStore.getState().project);
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
  return true;
}

// What Restore changed, said as File > Open says it (ADR-673 Amendment 1).
function reportRestoredProject(
  loadResult: ProjectMachineCapabilityLoadResult,
  record: AutosaveDurableSnapshot,
): void {
  // One toast for what Restore changed (annoyance audit A5-P2-6, ADR-708).
  pushProjectLoadNotices(
    record.loadNotices ?? {},
    useToastStore.getState().pushToast,
    { migration: true, project: record.project },
    loadResult.kind === 'capability-warning'
      ? [
          {
            message: loadedMachineCapabilityWarningMessage(loadResult.activeKind),
            variant: 'warning',
          },
        ]
      : [],
  );
}

export function recoveryAgeLabel(savedAt: number): string {
  const ageMin = Math.max(0, Math.round((Date.now() - savedAt) / 60_000));
  return ageMin === 0 ? 'less than a minute ago' : `${ageMin} minute${ageMin === 1 ? '' : 's'} ago`;
}

function reportRecoveryWarnings(result: AutosaveDurableReadResult): void {
  if (result.warnings.includes('unsupported-version')) {
    useToastStore.getState().pushToast(AUTOSAVE_RECOVERY_VERSION_MESSAGE, 'warning');
  }
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
        ? result.reason === 'unsupported-version'
          ? AUTOSAVE_RECOVERY_VERSION_MESSAGE
          : AUTOSAVE_RECOVERY_RETAINED_MESSAGE
        : 'Autosave cleanup did not complete; an older recovery prompt may appear again.',
      'warning',
    );
}
