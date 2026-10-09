import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../../core/scene';
import type { PlatformAdapter, SaveTarget } from '../../platform/types';
import { context, note } from '../../__fixtures__/project-save-restore-owner';
import { handleSaveProject } from '../app/project-save-action';
import { useStore } from './index';
import { resetStore } from './test-helpers';
import { AUTOSAVE_INTERVAL_MS, readAutosave } from './autosave';
import { startAutosaveLoop } from './autosave-loop';

function deferred() {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function platform(target: SaveTarget): PlatformAdapter {
  return {
    id: 'mock',
    pickFilesForOpen: async () => [],
    pickFileForSave: async () => target,
    serial: { isSupported: () => false, requestPort: async () => null },
  };
}
function save(target: SaveTarget, toast = vi.fn()) {
  return handleSaveProject(
    context(platform(target), useStore.getState().markProjectSaveUncertain, toast),
    true,
  );
}

async function beginBlockedRepair(
  options: { ownReplayFails?: boolean; laterFailure?: boolean } = {},
) {
  const oldGate = deferred(),
    oldStarted = deferred();
  const separateGate = deferred(),
    separateStarted = deferred();
  const destinationIdentity = {};
  const disk = { alias: '' };
  const currentToast = vi.fn();
  const old: SaveTarget = {
    displayName: 'opened-path.lf2',
    write: async (data) => {
      oldStarted.resolve();
      await oldGate.promise;
      disk.alias = note(data);
    },
  };
  let earlierWrites = 0,
    separateWrites = 0,
    ownWrites = 0,
    laterWrites = 0;
  const earlier: SaveTarget = {
    displayName: 'earlier-alias.lf2',
    destinationIdentity,
    write: vi.fn(async (data) => {
      earlierWrites += 1;
      if (earlierWrites === 2) throw new Error('Earlier alias restoration failed');
      disk.alias = note(data);
    }),
  };
  const separate: SaveTarget = {
    displayName: 'separate.lf2',
    compareDestination: async (other) => (other === old ? 'unknown' : 'different'),
    write: vi.fn(async () => {
      separateWrites += 1;
      if (separateWrites === 2) {
        separateStarted.resolve();
        await separateGate.promise;
      }
    }),
  };
  const current: SaveTarget = {
    displayName: 'saved-current.lf2',
    destinationIdentity,
    write: vi.fn(async (data) => {
      ownWrites += 1;
      // Native selected writes settle after asynchronous I/O, giving entry
      // comparisons time to establish that the intervening file is distinct.
      if (ownWrites === 1) await tick();
      if (ownWrites === 2 && options.ownReplayFails) throw new Error('Current own replay failed');
      disk.alias = note(data);
    }),
  };
  const later: SaveTarget = {
    displayName: 'later-failed-unknown.lf2',
    write: vi.fn(async () => {
      laterWrites += 1;
      if (laterWrites === 2) disk.alias = 'truncated by later failed replay';
      throw new Error('Later unknown destination failed');
    }),
  };
  useStore.setState({
    project: { ...createProject(), notes: 'older snapshot' },
    dirty: true,
    lastSaveTarget: old,
    savedName: old.displayName,
  });
  const older = handleSaveProject(
    context(platform(earlier), useStore.getState().markProjectSaveUncertain),
  );
  await oldStarted.promise;
  for (const [target, notes] of [
    [earlier, 'middle snapshot'],
    [separate, 'separate snapshot'],
    [current, 'current snapshot'],
  ] as const) {
    useStore.getState().setProjectNotes(notes);
    await expect(save(target, target === current ? currentToast : vi.fn())).resolves.toBe('saved');
  }
  if (options.laterFailure) await expect(save(later)).resolves.toBe('error');
  oldGate.resolve();
  await expect(older).resolves.toBe('stale-request');
  await separateStarted.promise;
  return {
    disk,
    current,
    currentToast,
    finish: async () => {
      separateGate.resolve();
      await tick();
      await tick();
    },
  };
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetStore();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  resetStore();
});

describe('saved owner queued behind an unrelated replay', () => {
  it('arms recovery while blocked and clears only the unchanged owner after its own successful replay', async () => {
    const race = await beginBlockedRepair();
    try {
      await vi.waitFor(() => expect(useStore.getState().dirty).toBe(true));
      expect(race.disk.alias).toBe('older snapshot');
      expect(race.current.write).toHaveBeenCalledOnce();
      expect(useStore.getState()).toMatchObject({
        lastSaveTarget: race.current,
        projectSavedRequestEpoch: 4,
      });
      expect(race.currentToast).not.toHaveBeenCalledWith(expect.any(String), 'error');
      vi.useFakeTimers();
      const stop = startAutosaveLoop(() => {
        const state = useStore.getState();
        return { project: state.project, dirty: state.dirty, isStreaming: false };
      });
      try {
        await vi.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL_MS);
        expect(readAutosave()?.project.notes).toBe('current snapshot');
      } finally {
        stop();
        vi.useRealTimers();
      }
      await race.finish();
      await vi.waitFor(() => expect(useStore.getState().dirty).toBe(false));
      expect(race.disk.alias).toBe('current snapshot');
      expect(race.current.write).toHaveBeenCalledTimes(2);
      expect(useStore.getState().projectSavedRequestEpoch).toBe(4);
      await vi.waitFor(() => expect(readAutosave()).toBeNull());
      expect(race.currentToast).not.toHaveBeenCalledWith(expect.any(String), 'error');
    } finally {
      await race.finish();
    }
  });

  it('retains edits made while the own replay is queued', async () => {
    const race = await beginBlockedRepair();
    try {
      await vi.waitFor(() => expect(useStore.getState().dirty).toBe(true));
      useStore.getState().setProjectNotes('newer edits');
      await race.finish();
      expect(race.disk.alias).toBe('current snapshot');
      expect(useStore.getState()).toMatchObject({ dirty: true, lastSaveTarget: race.current });
      expect(useStore.getState().project.notes).toBe('newer edits');
    } finally {
      await race.finish();
    }
  });

  it('keeps a final own-replay failure dirty and permits an explicit Save retry', async () => {
    const race = await beginBlockedRepair({ ownReplayFails: true });
    try {
      await vi.waitFor(() => expect(useStore.getState().dirty).toBe(true));
      await race.finish();
      await vi.waitFor(() =>
        expect(race.currentToast).toHaveBeenCalledWith(
          expect.stringContaining(
            'Current own replay failed. The project is unsaved; save it again.',
          ),
          'error',
        ),
      );
      expect(useStore.getState().dirty).toBe(true);
      expect(race.disk.alias).toBe('older snapshot');
      await expect(save(race.current)).resolves.toBe('saved');
      expect(useStore.getState()).toMatchObject({ dirty: false, projectSavedRequestEpoch: 5 });
      expect(race.disk.alias).toBe('current snapshot');
    } finally {
      await race.finish();
    }
  });

  it('does not clear newer handoff edits when the old own replay completes', async () => {
    const race = await beginBlockedRepair();
    try {
      await vi.waitFor(() => expect(useStore.getState().dirty).toBe(true));
      const newer: SaveTarget = {
        displayName: 'newer-distinct.lf2',
        compareDestination: async () => 'different',
        write: async () => undefined,
      };
      useStore.getState().setProjectNotes('newer handoff');
      await expect(save(newer)).resolves.toBe('saved');
      useStore.getState().setProjectNotes('newer handoff edits');
      await race.finish();
      expect(useStore.getState()).toMatchObject({
        dirty: true,
        lastSaveTarget: newer,
        projectSavedRequestEpoch: 5,
      });
      expect(useStore.getState().project.notes).toBe('newer handoff edits');
      expect(race.currentToast).not.toHaveBeenCalledWith(expect.any(String), 'error');
    } finally {
      await race.finish();
    }
  });

  it('keeps a replacement document clean when the old own replay fails', async () => {
    const race = await beginBlockedRepair({ ownReplayFails: true });
    try {
      await vi.waitFor(() => expect(useStore.getState().dirty).toBe(true));
      useStore.getState().newProject();
      const replacement = useStore.getState().project;
      await race.finish();
      expect(useStore.getState()).toMatchObject({
        project: replacement,
        dirty: false,
        lastSaveTarget: null,
      });
      expect(race.currentToast).not.toHaveBeenCalledWith(expect.any(String), 'error');
    } finally {
      await race.finish();
    }
  });

  it('reports a later failed alias after the own replay has already restored temporary uncertainty', async () => {
    const race = await beginBlockedRepair({ laterFailure: true });
    try {
      await vi.waitFor(() => expect(useStore.getState().dirty).toBe(true));
      await race.finish();
      await vi.waitFor(() =>
        expect(race.currentToast).toHaveBeenCalledWith(
          expect.stringContaining('The project is unsaved; save it again.'),
          'error',
        ),
      );
      expect(race.disk.alias).toBe('truncated by later failed replay');
      expect(useStore.getState()).toMatchObject({
        dirty: true,
        lastSaveTarget: race.current,
        projectSavedRequestEpoch: 4,
        projectSaveRequestEpoch: 5,
      });
    } finally {
      await race.finish();
    }
  });
});
