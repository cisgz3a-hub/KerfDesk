import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  addLayer,
  addObject,
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { useStore } from '../state';
import { clearAutosave, readAutosave, writeAutosave } from '../state/autosave';
import { AutosaveDurableService } from '../state/autosave-durable';
import { AutosavePreparationTimeoutError } from '../state/autosave-preparation-client';
import { IndexedDbAutosaveRepository } from '../state/autosave-indexeddb';
import { AutosaveSessionLocks } from '../state/autosave-session-lock';
import { useToastStore } from '../state/toast-store';
import { keptTracePhotosMessage } from '../state/project-load-notices';
import { legacyTraceDocument } from '../../__fixtures__/legacy-trace-source-project';
import {
  AUTOSAVE_FAILURE_MESSAGE,
  AUTOSAVE_TIMEOUT_MESSAGE,
  AUTOSAVE_RECOVERY_RETAINED_MESSAGE,
  AUTOSAVE_RECOVERY_STORAGE_MESSAGE,
  AUTOSAVE_RECOVERY_VERSION_MESSAGE,
  createAutosaveFailureReporter,
  runAutosaveRecovery,
} from './use-autosave';

describe('createAutosaveFailureReporter', () => {
  it('shows one manual-save warning when autosave writes fail', () => {
    const pushToast = vi.fn();
    const reportFailure = createAutosaveFailureReporter(pushToast);

    reportFailure();
    reportFailure();

    expect(pushToast).toHaveBeenCalledTimes(1);
    expect(pushToast).toHaveBeenCalledWith(AUTOSAVE_FAILURE_MESSAGE, 'warning');
    expect(AUTOSAVE_FAILURE_MESSAGE).toContain('Save the .lf2 file manually');
  });

  it('names a preparation timeout as a deadline, not browser storage (S3-P2-2)', () => {
    const pushToast = vi.fn();
    const reportFailure = createAutosaveFailureReporter(pushToast);
    const timedOut = {
      kind: 'failed',
      reason: 'storage-error',
      error: new AutosavePreparationTimeoutError(),
    } as const;

    reportFailure(timedOut);
    reportFailure(timedOut);
    reportFailure({ kind: 'failed', reason: 'quota', error: new Error('full') });

    expect(pushToast.mock.calls).toEqual([
      [AUTOSAVE_TIMEOUT_MESSAGE, 'warning'],
      [AUTOSAVE_FAILURE_MESSAGE, 'warning'],
    ]);
    expect(AUTOSAVE_TIMEOUT_MESSAGE).not.toContain('storage');
    expect(AUTOSAVE_TIMEOUT_MESSAGE).toContain('Save the .lf2 file manually');
  });
});

describe('runAutosaveRecovery warnings', () => {
  it('explains that an unsupported autosave was retained without offering to discard it', async () => {
    const originalPushToast = useToastStore.getState().pushToast;
    const pushToast = vi.fn();
    const chooseRestore = vi.fn(() => false);
    useToastStore.setState({ pushToast });
    try {
      await runAutosaveRecovery(chooseRestore, {
        readLatest: async () => ({
          snapshot: null,
          warnings: ['unsupported-version'],
          unreadable: [],
        }),
        write: async () => ({ kind: 'superseded' }),
        clearRecovered: async () => ({ kind: 'ok' }),
        retainRecovered: async () => undefined,
      });
    } finally {
      useToastStore.setState({ pushToast: originalPushToast });
    }
    expect(chooseRestore).not.toHaveBeenCalled();
    expect(pushToast).toHaveBeenCalledExactlyOnceWith(AUTOSAVE_RECOVERY_VERSION_MESSAGE, 'warning');
  });

  it('discloses corrupt storage and an ownership probe failure', async () => {
    const originalPushToast = useToastStore.getState().pushToast;
    const pushToast = vi.fn();
    useToastStore.setState({ pushToast });
    try {
      await runAutosaveRecovery(() => false, {
        readLatest: async () => ({
          snapshot: null,
          warnings: ['corrupt-slot', 'ownership-probe-failed'],
          unreadable: [],
        }),
        write: async () => ({ kind: 'superseded' }),
        clearRecovered: async () => ({ kind: 'ok' }),
        retainRecovered: async () => undefined,
      });
    } finally {
      useToastStore.setState({ pushToast: originalPushToast });
    }

    expect(pushToast).toHaveBeenCalledWith(AUTOSAVE_RECOVERY_STORAGE_MESSAGE, 'warning');
    expect(pushToast).toHaveBeenCalledWith(AUTOSAVE_RECOVERY_RETAINED_MESSAGE, 'warning');
  });
});

function savedProject(): Project {
  const obj: SceneObject = {
    kind: 'imported-svg',
    id: 'O1',
    source: 'a.svg',
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#000000',
        polylines: [
          {
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 0 },
            ],
            closed: false,
          },
        ],
      },
    ],
  };
  const base = createProject();
  return {
    ...base,
    scene: addLayer(addObject(base.scene, obj), createLayer({ id: '#000000', color: '#000000' })),
  };
}

afterEach(() => {
  clearAutosave();
  // A test can leave work in an inherited slot on purpose (D-1); clear it too.
  localStorage.clear();
  useStore.getState().newProject();
  useStore.setState({ dirty: false });
});

// M15 (AUDIT-2026-06-10): recovery used to mark the restored project CLEAN
// and immediately clear the slot — so a crash/close right after "Restore"
// silently lost everything the feature exists to protect.
describe('runAutosaveRecovery (M15)', () => {
  it('marks a restored project dirty and keeps the autosave slot', async () => {
    const service = recoveryService();
    expect(writeAutosave(savedProject()).kind).toBe('ok');

    await runAutosaveRecovery(() => true, service);

    const state = useStore.getState();
    expect(state.project.scene.objects).toHaveLength(1);
    expect(state.dirty).toBe(true);
    expect(readAutosave()).not.toBeNull();
    await service.stop();
  });

  it('clears the slot only on an explicit decline', async () => {
    const service = recoveryService();
    expect(writeAutosave(savedProject()).kind).toBe('ok');

    await runAutosaveRecovery(() => false, service);

    expect(useStore.getState().project.scene.objects).toHaveLength(0);
    expect(readAutosave()).toBeNull();
    await service.stop();
  });

  it('leaves the slot alone when a scene is already loaded', async () => {
    const service = recoveryService();
    expect(writeAutosave(savedProject()).kind).toBe('ok');
    useStore.setState({ project: savedProject() });
    const confirm = vi.fn(() => true);

    await runAutosaveRecovery(confirm, service);

    expect(confirm).not.toHaveBeenCalled();
    expect(readAutosave()).not.toBeNull();
    await service.stop();
  });

  it('does not overwrite a clean empty project opened while durable recovery is reading', async () => {
    type DeferredRead = {
      snapshot: {
        project: Project;
        savedAt: number;
        storageKey: string;
        sessionId: string;
        backend: 'local';
        ownership: 'abandoned';
      };
      warnings: [];
      unreadable: [];
    };
    let resolveRead: (value: DeferredRead) => void = () => undefined;
    const readLatest = vi.fn(
      () =>
        new Promise<DeferredRead>((resolve) => {
          resolveRead = resolve;
        }),
    );
    const confirm = vi.fn(() => true);
    const write = vi.fn(async () => ({ kind: 'superseded' as const }));
    const clearRecovered = vi.fn(async () => ({ kind: 'ok' as const }));
    const recovery = runAutosaveRecovery(confirm, {
      readLatest,
      write,
      clearRecovered,
      retainRecovered: async () => undefined,
    });
    await vi.waitFor(() => expect(readLatest).toHaveBeenCalledOnce());

    const opened = { ...createProject(), notes: 'explicitly opened empty project' };
    useStore.getState().setProject(opened);
    useStore.setState({ dirty: false });
    resolveRead({
      snapshot: {
        project: savedProject(),
        savedAt: 100,
        storageKey: 'lf2:autosave:v1:dead',
        sessionId: 'dead',
        backend: 'local',
        ownership: 'abandoned',
      },
      warnings: [],
      unreadable: [],
    });

    await recovery;
    expect(useStore.getState()).toMatchObject({ project: opened, dirty: false });
    expect(confirm).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(clearRecovered).not.toHaveBeenCalled();
  });
});

// PST-01: on a fresh boot readAutosave surfaces a *dead* window-session's slot.
// Accepting the restore must re-home the project into THIS session's slot and
// drop the dead one — otherwise the dead slot lingers (no-arg clearAutosave on
// the first manual save only clears the current-session + legacy keys) and
// re-prompts "Restore?" on every later empty launch.
// ADR-673 Amendment 1: an autosave written before the kept-photo change
// restores with the photo off, and Restore says so as File > Open does.
describe('runAutosaveRecovery load notices', () => {
  it('says a photo an earlier build kept behind its trace is now off', async () => {
    const service = recoveryService();
    const written = writeAutosave(savedProject());
    if (written.kind !== 'ok') throw new Error('autosave write failed');
    const record = JSON.parse(localStorage.getItem(written.storageKey) ?? '{}') as Record<
      string,
      unknown
    >;
    localStorage.setItem(
      written.storageKey,
      JSON.stringify({ ...record, projectJson: legacyTraceDocument() }),
    );
    useToastStore.setState({ toasts: [] });

    await runAutosaveRecovery(() => true, service);

    expect(useStore.getState().project.scene.objects.map((object) => object.id)).toEqual([
      'photo',
      'trace',
    ]);
    expect(
      useToastStore.getState().toasts.map((toast) => [toast.message, toast.variant]),
    ).toContainEqual([keptTracePhotosMessage(1), 'warning']);
    await service.stop();
  });
});

const DEAD_SESSION = 'dead';
const DEAD_KEY = 'lf2:autosave:v1:dead';
// Year-2020 stamp: older than the re-home write (real Date.now()) so readAutosave
// deterministically prefers the re-homed current-session slot.
const OLD_TS = 1_600_000_000_000;

describe('runAutosaveRecovery re-homes a dead-session slot (PST-01)', () => {
  it('clears the source slot and moves the copy into the current session', async () => {
    const service = recoveryService();
    writeAutosave(savedProject(), OLD_TS, { sessionId: DEAD_SESSION });

    await runAutosaveRecovery(() => true, service);

    expect(localStorage.getItem(DEAD_KEY)).toBeNull();
    const restored = readAutosave();
    expect(restored).not.toBeNull();
    expect(restored?.storageKey).not.toBe(DEAD_KEY);
    expect(restored?.project.scene.objects).toHaveLength(1);
    await service.stop();
  });

  it('does not re-prompt on the next launch after the first manual save', async () => {
    const service = recoveryService();
    writeAutosave(savedProject(), OLD_TS, { sessionId: DEAD_SESSION });

    await runAutosaveRecovery(() => true, service);
    // First manual save clears the current-session slot (file-actions no-arg clear).
    clearAutosave();
    // New launch: empty project again.
    useStore.getState().newProject();
    useStore.setState({ dirty: false });

    const confirm = vi.fn(() => true);
    await runAutosaveRecovery(confirm, service);
    expect(confirm).not.toHaveBeenCalled();
    await service.stop();
  });
});

function recoveryService(): AutosaveDurableService {
  return new AutosaveDurableService({
    repository: new IndexedDbAutosaveRepository({ factory: undefined }),
    locks: new AutosaveSessionLocks(new TestLockManager().asLockManager()),
  });
}

class TestLockManager {
  private readonly heldNames = new Set<string>();

  asLockManager(): LockManager {
    return { request: this.request.bind(this) } as LockManager;
  }

  private async request<T>(
    name: string,
    options: LockOptions,
    callback: (lock: Lock | null) => Promise<T> | T,
  ): Promise<T> {
    if (options.ifAvailable === true && this.heldNames.has(name)) return callback(null);
    this.heldNames.add(name);
    try {
      return await callback({ name, mode: 'exclusive' } as Lock);
    } finally {
      this.heldNames.delete(name);
    }
  }
}
