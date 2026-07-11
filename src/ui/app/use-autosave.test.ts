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
import {
  AUTOSAVE_FAILURE_MESSAGE,
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
  it('marks a restored project dirty and keeps the autosave slot', () => {
    expect(writeAutosave(savedProject()).kind).toBe('ok');

    runAutosaveRecovery(() => true);

    const state = useStore.getState();
    expect(state.project.scene.objects).toHaveLength(1);
    expect(state.dirty).toBe(true);
    expect(readAutosave()).not.toBeNull();
  });

  it('clears the slot only on an explicit decline', () => {
    expect(writeAutosave(savedProject()).kind).toBe('ok');

    runAutosaveRecovery(() => false);

    expect(useStore.getState().project.scene.objects).toHaveLength(0);
    expect(readAutosave()).toBeNull();
  });

  it('leaves the slot alone when a scene is already loaded', () => {
    expect(writeAutosave(savedProject()).kind).toBe('ok');
    useStore.setState({ project: savedProject() });
    const confirm = vi.fn(() => true);

    runAutosaveRecovery(confirm);

    expect(confirm).not.toHaveBeenCalled();
    expect(readAutosave()).not.toBeNull();
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
  it('clears the source slot and moves the copy into the current session', () => {
    writeAutosave(savedProject(), OLD_TS, { sessionId: DEAD_SESSION });

    runAutosaveRecovery(() => true);

    expect(localStorage.getItem(DEAD_KEY)).toBeNull();
    const restored = readAutosave();
    expect(restored).not.toBeNull();
    expect(restored?.storageKey).not.toBe(DEAD_KEY);
    expect(restored?.project.scene.objects).toHaveLength(1);
  });

  it('does not re-prompt on the next launch after the first manual save', () => {
    writeAutosave(savedProject(), OLD_TS, { sessionId: DEAD_SESSION });

    runAutosaveRecovery(() => true);
    // First manual save clears the current-session slot (file-actions no-arg clear).
    clearAutosave();
    // New launch: empty project again.
    useStore.getState().newProject();
    useStore.setState({ dirty: false });

    const confirm = vi.fn(() => true);
    runAutosaveRecovery(confirm);
    expect(confirm).not.toHaveBeenCalled();
  });
});
