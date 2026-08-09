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
import { IndexedDbAutosaveRepository } from '../state/autosave-indexeddb';
import { AutosaveSessionLocks } from '../state/autosave-session-lock';
import { useToastStore } from '../state/toast-store';
import {
  AUTOSAVE_FAILURE_MESSAGE,
  AUTOSAVE_RECOVERY_RETAINED_MESSAGE,
  AUTOSAVE_RECOVERY_STORAGE_MESSAGE,
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
});

describe('runAutosaveRecovery warnings', () => {
  it('discloses corrupt storage and an ownership probe failure', async () => {
    const originalPushToast = useToastStore.getState().pushToast;
    const pushToast = vi.fn();
    useToastStore.setState({ pushToast });
    try {
      await runAutosaveRecovery(() => false, {
        readLatest: async () => ({
          snapshot: null,
          warnings: ['corrupt-slot', 'ownership-probe-failed'],
        }),
        write: async () => ({ kind: 'superseded' }),
        clearRecovered: async () => ({ kind: 'ok' }),
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
    const recovery = runAutosaveRecovery(confirm, { readLatest, write, clearRecovered });
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
