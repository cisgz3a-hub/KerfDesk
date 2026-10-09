import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SaveTarget } from '../../platform/types';
import { handleSaveProject } from '../app/project-save-action';
import { useStore } from './index';
import { resetStore } from './test-helpers';
import { beginRace, context, note } from '../../__fixtures__/project-save-restore-owner';
import { AUTOSAVE_INTERVAL_MS, readAutosave, writeAutosave } from './autosave';
import { projectAutosaveService } from './autosave-durable';
import { useAutosave } from '../app/use-autosave';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
function AutosaveProbe(): null {
  useAutosave();
  return null;
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetStore();
});
afterEach(() => {
  vi.restoreAllMocks();
  resetStore();
});

describe.each([false, true])(
  'saved handoff restore ownership (proven same=%s)',
  (knownDestination) => {
    it('marks the last successful handoff unsaved after a later selected Save fails', async () => {
      const race = await beginRace(knownDestination);
      race.replayGate.resolve();
      await vi.waitFor(() => {
        expect(race.disk.alias).toBe('older snapshot');
        expect(useStore.getState()).toMatchObject({
          dirty: true,
          lastSaveTarget: race.chosen,
          projectSavedRequestEpoch: 2,
          projectSaveRequestEpoch: 3,
        });
        expect(race.chosenToast).toHaveBeenCalledWith(
          expect.stringContaining('The project is unsaved; save it again.'),
          'error',
        );
      });
      expect(race.failedLater.write).toHaveBeenCalledTimes(2);
      expect(useStore.getState().project.notes).toBe('chosen snapshot');
    });

    it('does not dirty a genuinely newer successful handoff when the earlier restore fails', async () => {
      const race = await beginRace(knownDestination);
      const newer: SaveTarget = {
        displayName: 'newer-distinct.lf2',
        compareDestination: async () => 'different',
        write: vi.fn(async (data) => {
          race.disk.distinct = note(data);
        }),
      };
      useStore.getState().setProjectNotes('newer successful snapshot');
      await expect(
        handleSaveProject(context(race.platform(newer), race.markUncertain), true),
      ).resolves.toBe('saved');
      race.replayGate.resolve();
      await vi.waitFor(() =>
        expect(race.markUncertain).toHaveBeenCalledWith(race.documentEpoch, 2, race.chosen),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(useStore.getState()).toMatchObject({
        dirty: false,
        lastSaveTarget: newer,
        projectSavedRequestEpoch: 4,
      });
      expect(race.disk.distinct).toBe('newer successful snapshot');
      expect(newer.write).toHaveBeenCalled();
      for (const [data] of vi.mocked(newer.write).mock.calls) {
        expect(note(data)).toBe('newer successful snapshot');
      }
      expect(race.chosenToast).not.toHaveBeenCalledWith(expect.any(String), 'error');
    });

    it('keeps a replacement document untouched when the previous saved handoff restore fails', async () => {
      const race = await beginRace(knownDestination);
      useStore.getState().newProject();
      const replacement = useStore.getState().project;
      race.replayGate.resolve();
      await vi.waitFor(() =>
        expect(race.markUncertain).toHaveBeenCalledWith(race.documentEpoch, 2, race.chosen),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(useStore.getState()).toMatchObject({
        project: replacement,
        dirty: false,
        savedName: null,
        lastSaveTarget: null,
        projectSavedRequestEpoch: null,
      });
      expect(race.chosenToast).not.toHaveBeenCalledWith(expect.any(String), 'error');
    });
  },
);

it('marks a saved alias uncertain when a later failed selection truncates it during replay', async () => {
  const race = await beginRace(false, { chosenRestoreFails: false, laterMutates: true });
  race.replayGate.resolve();
  await vi.waitFor(() => {
    expect(race.disk.alias).toBe('truncated by failed replay');
    expect(useStore.getState()).toMatchObject({
      dirty: true,
      lastSaveTarget: race.chosen,
      projectSavedRequestEpoch: 2,
    });
    expect(race.chosenToast).toHaveBeenCalledWith(
      expect.stringContaining('The project is unsaved; save it again.'),
      'error',
    );
  });
});

it('keeps a saved file clean when authoritative identity proves the failed replay changes another file', async () => {
  const race = await beginRace(false, {
    chosenRestoreFails: false,
    laterMutates: true,
    laterDistinct: true,
  });
  race.replayGate.resolve();
  await vi.waitFor(() => expect(race.disk.distinct).toBe('truncated by failed replay'));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(race.disk.alias).toBe('chosen snapshot');
  expect(useStore.getState()).toMatchObject({
    dirty: false,
    lastSaveTarget: race.chosen,
    projectSavedRequestEpoch: 2,
  });
  expect(race.chosenToast).not.toHaveBeenCalledWith(expect.any(String), 'error');
});

it('keeps the newest owner clean when its later replay succeeds after unknown replay failures', async () => {
  const race = await beginRace(false);
  const newest: SaveTarget = {
    displayName: 'newest-unknown.lf2',
    write: vi.fn(async (data) => {
      race.disk.distinct = note(data);
    }),
  };
  useStore.getState().setProjectNotes('newest snapshot');
  await expect(
    handleSaveProject(context(race.platform(newest), race.markUncertain), true),
  ).resolves.toBe('saved');
  race.replayGate.resolve();
  await vi.waitFor(() => expect(newest.write).toHaveBeenCalledTimes(2));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(useStore.getState()).toMatchObject({
    dirty: false,
    lastSaveTarget: newest,
    projectSavedRequestEpoch: 4,
  });
  expect(race.disk.distinct).toBe('newest snapshot');
  expect(race.chosenToast).not.toHaveBeenCalledWith(expect.any(String), 'error');
});
it.each([false, true])(
  're-arms autosave with the newest live bytes after an uncertain saved handoff (proven same=%s)',
  async (knownDestination) => {
    const race = await beginRace(knownDestination);
    vi.useFakeTimers();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const write = vi.spyOn(projectAutosaveService, 'write').mockImplementation(async (project) => {
      const saved = writeAutosave(project);
      if (saved.kind !== 'ok') throw new Error('Expected usable local recovery storage');
      return { ...saved, backend: 'local' };
    });
    vi.spyOn(projectAutosaveService, 'session').mockResolvedValue({
      sessionId: 'save-owner-hook',
      ownership: 'owned',
    });
    try {
      await act(async () => root.render(createElement(AutosaveProbe)));
      await act(async () => vi.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL_MS));
      expect(write).not.toHaveBeenCalled();
      expect(readAutosave()).toBeNull();
      race.replayGate.resolve();
      await vi.waitFor(() => expect(useStore.getState().dirty).toBe(true));
      await act(async () => vi.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL_MS));
      expect(write).toHaveBeenCalledOnce();
      expect(readAutosave()?.project.notes).toBe('chosen snapshot');
      useStore.getState().setProjectNotes('newer edit after the failed restore');
      await act(async () => vi.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL_MS));
      expect(write).toHaveBeenCalledTimes(2);
      expect(readAutosave()?.project.notes).toBe('newer edit after the failed restore');
    } finally {
      await act(async () => root.unmount());
      host.remove();
      vi.useRealTimers();
    }
  },
);
it.each([false, true])(
  'still dirties the saved owner when an earlier affected owner rejects feedback (proven same=%s)',
  async (knownDestination) => {
    const race = await beginRace(knownDestination, { rejectOlderFeedback: true });
    race.replayGate.resolve();
    await vi.waitFor(() => {
      expect(race.markUncertain).toHaveBeenCalledWith(race.documentEpoch, 1, expect.any(Object));
      expect(useStore.getState()).toMatchObject({
        dirty: true,
        lastSaveTarget: race.chosen,
        projectSavedRequestEpoch: 2,
      });
      expect(race.chosenToast).toHaveBeenCalledWith(
        expect.stringContaining('The project is unsaved; save it again.'),
        'error',
      );
    });
    const retry: SaveTarget = {
      displayName: 'retried.lf2',
      write: vi.fn(async (data) => {
        race.disk.alias = note(data);
      }),
    };
    await expect(
      handleSaveProject(context(race.platform(retry), race.markUncertain), true),
    ).resolves.toBe('saved');
    expect(useStore.getState()).toMatchObject({
      dirty: false,
      lastSaveTarget: retry,
      projectSavedRequestEpoch: 4,
    });
    expect(race.disk.alias).toBe('chosen snapshot');
  },
);
it('marks the saved handoff uncertain before a later non-owner replay settles', async () => {
  const race = await beginRace(false, { stallLaterReplay: true });
  try {
    race.replayGate.resolve();
    await race.laterReplayStarted.promise;
    await vi.waitFor(() => {
      expect(race.disk.alias).toBe('older snapshot');
      expect(useStore.getState()).toMatchObject({
        dirty: true,
        lastSaveTarget: race.chosen,
        projectSavedRequestEpoch: 2,
      });
      expect(race.chosenToast).toHaveBeenCalledWith(
        expect.stringContaining('The project is unsaved; save it again.'),
        'error',
      );
    });
  } finally {
    race.laterReplayGate.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
});

it.each([false, true])(
  'notifies the current saved owner independently of an older stalled feedback handler (proven same=%s)',
  async (knownDestination) => {
    const race = await beginRace(knownDestination, { stallOlderFeedback: true });
    try {
      race.replayGate.resolve();
      await race.olderFeedbackStarted.promise;
      await vi.waitFor(() => {
        expect(useStore.getState()).toMatchObject({
          dirty: true,
          lastSaveTarget: race.chosen,
          projectSavedRequestEpoch: 2,
        });
        expect(race.chosenToast).toHaveBeenCalledWith(
          expect.stringContaining('The project is unsaved; save it again.'),
          'error',
        );
      });
      const retry: SaveTarget = {
        displayName: 'retry-after-stalled-feedback.lf2',
        write: vi.fn(async (data) => {
          race.disk.alias = note(data);
        }),
      };
      await expect(
        handleSaveProject(context(race.platform(retry), race.markUncertain), true),
      ).resolves.toBe('saved');
      expect(useStore.getState()).toMatchObject({
        dirty: false,
        lastSaveTarget: retry,
        projectSavedRequestEpoch: 4,
      });
      expect(race.disk.alias).toBe('chosen snapshot');
    } finally {
      race.olderFeedbackGate.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  },
);
