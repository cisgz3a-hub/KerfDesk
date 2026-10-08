import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../../core/scene';
import { deserializeProject } from '../../io/project';
import type { PlatformAdapter, SaveTarget } from '../../platform/types';
import { createDesktopProjectFiles } from '../../platform/electron/desktop-project-files';
import { webAdapter } from '../../platform/web/web-adapter';
import { handleSaveProject, type SaveProjectCtx } from '../app/project-save-action';
import { useStore } from './index';
import { resetStore } from './test-helpers';
import { createProjectSaveWriteCoordinator } from './project-save-write-coordinator';
import { compareSaveDestinations } from './project-save-write-coordinator-identity';

function deferred() {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function adapter(pickFileForSave: PlatformAdapter['pickFileForSave']): PlatformAdapter {
  return {
    id: 'mock',
    pickFilesForOpen: async () => [],
    pickFileForSave,
    serial: { isSupported: () => false, requestPort: async () => null },
  };
}

function context(platform: PlatformAdapter, pushToast = vi.fn()): SaveProjectCtx {
  const state = useStore.getState();
  return {
    platform,
    project: state.project,
    expectedProject: state.project,
    projectDocumentEpoch: state.projectDocumentEpoch,
    getProjectDocumentEpoch: () => useStore.getState().projectDocumentEpoch,
    claimProjectSaveRequest: state.claimProjectSaveRequest,
    getProjectSaveRequestEpoch: () => useStore.getState().projectSaveRequestEpoch,
    projectSaveWriteCoordinator: state.projectSaveWriteCoordinator,
    markSaved: state.markSaved,
    markProjectSaveUncertain: state.markProjectSaveUncertain,
    savedName: state.savedName,
    lastSaveTarget: state.lastSaveTarget,
    pushToast,
  };
}

function note(data: string | Blob): string {
  if (typeof data !== 'string') throw new Error('Expected captured project text');
  const result = deserializeProject(data);
  if (result.kind !== 'ok') throw new Error(`Invalid saved fixture: ${result.kind}`);
  return result.project.notes;
}

const originalPicker = Object.getOwnPropertyDescriptor(window, 'showSaveFilePicker');
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetStore();
});
afterEach(() => {
  if (originalPicker) Object.defineProperty(window, 'showSaveFilePicker', originalPicker);
  else Reflect.deleteProperty(window, 'showSaveFilePicker');
  vi.restoreAllMocks();
  resetStore();
});

describe('project Save unknown destination ordering', () => {
  it('keeps legacy false and unsupported carriers unknown, while native entry identity can prove distinct', async () => {
    const firstHandle = {
      kind: 'file',
      name: 'same.lf2',
      isSameEntry: vi.fn(async () => false),
    } as unknown as FileSystemFileHandle;
    const secondHandle = { kind: 'file', name: 'same.lf2' } as FileSystemFileHandle;
    const handles = [firstHandle, secondHandle];
    Object.defineProperty(window, 'showSaveFilePicker', {
      configurable: true,
      value: vi.fn(async () => handles.shift()),
    });
    const req = { suggestedName: 'same.lf2', extensions: ['.lf2'] };
    const first = await webAdapter.pickFileForSave(req);
    const second = await webAdapter.pickFileForSave(req);
    if (!first || !second) throw new Error('Expected picked targets');
    await expect(compareSaveDestinations(first, second)).resolves.toBe('different');
    expect(firstHandle.isSameEntry).toHaveBeenCalledWith(secondHandle);
    vi.mocked(firstHandle.isSameEntry).mockResolvedValueOnce('different' as unknown as boolean);
    await expect(compareSaveDestinations(first, second)).resolves.toBe('unknown');
    const files = createDesktopProjectFiles(undefined, { events: new EventTarget() });
    const path = files.openedProjectSaveTarget({
      kind: 'desktop-path',
      path: 'D:\\Jobs\\same.lf2',
      token: 'a'.repeat(43),
    });
    const alias = files.openedProjectSaveTarget({
      kind: 'desktop-path',
      path: 'D:\\Alias\\same.lf2',
      token: 'a'.repeat(43),
    });
    if (!path || !alias) throw new Error('Expected path targets');
    await expect(compareSaveDestinations(path, alias)).resolves.toBe('unknown');
    await expect(compareSaveDestinations(path, first)).resolves.toBe('unknown');
    const legacy = {
      displayName: 'same.lf2',
      isSameDestination: async () => false,
      write: vi.fn(),
    };
    await expect(compareSaveDestinations(legacy, second)).resolves.toBe('unknown');
    const malformed = {
      ...legacy,
      isSameDestination: async () => 'not an identity' as unknown as boolean,
    };
    await expect(compareSaveDestinations(malformed, second)).resolves.toBe('unknown');
    const failed = {
      ...legacy,
      compareDestination: async () => {
        throw new Error('Lookup failed');
      },
    };
    await expect(compareSaveDestinations(failed, second)).resolves.toBe('unknown');
  });

  it.each([false, true])(
    'orders three destinations with a proven-same first pair=%s',
    async (knownPair) => {
      const coordinator = createProjectSaveWriteCoordinator();
      const sharedDestination = {};
      const gates = [deferred(), deferred(), deferred()];
      const disk = { alias: '', distinct: '' };
      const targets = gates.map((gate, index): SaveTarget => {
        let writes = 0;
        return {
          displayName: 'same.lf2',
          ...(knownPair && index < 2 ? { destinationIdentity: sharedDestination } : {}),
          write: vi.fn(async (data) => {
            if (typeof data !== 'string') throw new Error('Expected snapshot');
            writes += 1;
            if (writes === 1) await gate.promise;
            disk[index === 2 ? 'distinct' : 'alias'] = data;
          }),
        };
      });
      const owners = [coordinator.begin(1), coordinator.begin(2), coordinator.begin(3)];
      const writes = owners.map((owner, index) =>
        owner.write(targets[index]!, ['old alias', 'chosen alias', 'chosen distinct'][index]!),
      );
      expect(targets.every((target) => vi.mocked(target.write).mock.calls.length === 1)).toBe(true);
      gates[2]!.resolve();
      await writes[2];
      owners[2]!.release();
      gates[1]!.resolve();
      await writes[1];
      owners[1]!.release();
      gates[0]!.resolve();
      await writes[0];
      owners[0]!.release();
      await vi.waitFor(() => {
        expect(targets[1]!.write).toHaveBeenCalledTimes(2);
        expect(targets[2]!.write).toHaveBeenCalledTimes(2);
        expect(disk).toEqual({ alias: 'chosen alias', distinct: 'chosen distinct' });
      });
      expect(targets[0]!.write).toHaveBeenCalledOnce();
    },
  );

  it('retires a stalled identity lookup after repairing, without revisiting completed writes', async () => {
    const gate = deferred();
    let completeIdentity = (_result: 'same'): void => undefined;
    const identity = new Promise<'same'>((resolve) => {
      completeIdentity = resolve;
    });
    const coordinator = createProjectSaveWriteCoordinator();
    let disk = '';
    let firstWrites = 0;
    const first: SaveTarget = {
      displayName: 'old-path.lf2',
      compareDestination: vi.fn(() => identity),
      write: async (data) => {
        if (typeof data !== 'string') throw new Error('Expected snapshot');
        firstWrites += 1;
        if (firstWrites === 1) await gate.promise;
        disk = data;
      },
    };
    const second: SaveTarget = {
      displayName: 'picked.lf2',
      write: vi.fn(async (data) => {
        if (typeof data === 'string') disk = data;
      }),
    };
    const old = coordinator.begin(1);
    const latest = coordinator.begin(2);
    const pending = old.write(first, 'older');
    await latest.write(second, 'newest');
    latest.release();
    expect(second.write).toHaveBeenCalledOnce();
    gate.resolve();
    await pending;
    old.release();
    await vi.waitFor(() => {
      expect(second.write).toHaveBeenCalledTimes(2);
      expect(disk).toBe('newest');
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const later: SaveTarget = {
      displayName: 'unrelated.lf2',
      compareDestination: vi.fn(async () => 'different' as const),
      write: vi.fn(async () => undefined),
    };
    const unrelated = coordinator.begin(3);
    await unrelated.write(later, 'unrelated snapshot');
    unrelated.release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(first.compareDestination).toHaveBeenCalledOnce();
    expect(later.compareDestination).not.toHaveBeenCalled();
    expect(later.write).toHaveBeenCalledOnce();
    completeIdentity('same');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(second.write).toHaveBeenCalledTimes(2);
    const subsequent = coordinator.begin(4);
    await subsequent.write(later, 'another unrelated snapshot');
    subsequent.release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(first.compareDestination).toHaveBeenCalledOnce();
    expect(later.compareDestination).not.toHaveBeenCalled();
    expect(later.write).toHaveBeenCalledTimes(2);
  });

  it('preserves a newer snapshot while an earlier request still has an unresolved picker', async () => {
    const coordinator = createProjectSaveWriteCoordinator();
    const earlierPicker = coordinator.begin(1);
    const newer = coordinator.begin(2);
    let disk = '';
    const chosen: SaveTarget = {
      displayName: 'chosen.lf2',
      write: vi.fn(async (data) => {
        if (typeof data === 'string') disk = data;
      }),
    };
    await newer.write(chosen, 'newer chosen snapshot');
    newer.release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await earlierPicker.write(
      {
        displayName: 'older-picker-carrier.lf2',
        write: async (data) => {
          if (typeof data === 'string') disk = data;
        },
      },
      'earlier picker snapshot',
    );
    earlierPicker.release();
    await vi.waitFor(() => {
      expect(chosen.write).toHaveBeenCalledTimes(2);
      expect(disk).toBe('newer chosen snapshot');
    });
  });

  it('does not replay destinations proven distinct or block their selected writes', async () => {
    const gate = deferred();
    const coordinator = createProjectSaveWriteCoordinator();
    const first: SaveTarget = {
      displayName: 'one.lf2',
      compareDestination: async () => 'different',
      write: vi.fn(async () => gate.promise),
    };
    const second: SaveTarget = { displayName: 'two.lf2', write: vi.fn(async () => undefined) };
    const old = coordinator.begin(1);
    const latest = coordinator.begin(2);
    const pending = old.write(first, 'old');
    await latest.write(second, 'new');
    latest.release();
    expect(second.write).toHaveBeenCalledOnce();
    gate.resolve();
    await pending;
    old.release();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(first.write).toHaveBeenCalledOnce();
    expect(second.write).toHaveBeenCalledOnce();
  });

  it.each([false, true])(
    'keeps snapshot/dirty ownership when a picker cancels during replay (failure=%s)',
    async (failure) => {
      const race = await beginSaveRace();
      race.oldGate.resolve();
      await expect(race.older).resolves.toBe('stale-request');
      await race.replayStarted.promise;
      if (!failure) useStore.getState().setProjectNotes('edited after the chosen snapshot');
      const pickerStarted = deferred();
      const pickerCancelled = deferred();
      const pending = handleSaveProject(
        context(
          adapter(async () => {
            pickerStarted.resolve();
            await pickerCancelled.promise;
            return null;
          }),
        ),
        true,
      );
      await pickerStarted.promise;
      pickerCancelled.resolve();
      await expect(pending).resolves.toBe('cancelled');
      race.failReplay = failure;
      race.replayGate.resolve();
      await vi.waitFor(() => {
        expect(race.latest.write).toHaveBeenCalledTimes(2);
        expect(useStore.getState().dirty).toBe(true);
        if (failure)
          expect(race.toast).toHaveBeenCalledWith(
            expect.stringContaining('The project is unsaved; save it again.'),
            'error',
          );
        else expect(race.disk).toBe('chosen snapshot');
      });
      expect(useStore.getState().lastSaveTarget).toBe(race.latest);
      if (!failure)
        expect(useStore.getState().project.notes).toBe('edited after the chosen snapshot');
    },
  );

  it('keeps a replacement document untouched when the old replay fails', async () => {
    const race = await beginSaveRace();
    race.oldGate.resolve();
    await race.older;
    await race.replayStarted.promise;
    useStore.getState().newProject();
    const replacement = useStore.getState().project;
    race.failReplay = true;
    race.replayGate.resolve();
    await vi.waitFor(() => expect(race.latest.write).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(useStore.getState()).toMatchObject({
      project: replacement,
      dirty: false,
      savedName: null,
      lastSaveTarget: null,
    });
    expect(race.toast).not.toHaveBeenCalledWith(expect.any(String), 'error');
  });

  it('finishes a newer replacement Save after an already-running old replay', async () => {
    const race = await beginSaveRace();
    race.oldGate.resolve();
    await race.older;
    await race.replayStarted.promise;
    useStore.getState().newProject();
    useStore.getState().setProjectNotes('replacement snapshot');
    const replacement: SaveTarget = {
      displayName: 'new-carrier.lf2',
      write: vi.fn(async (data) => {
        race.disk = note(data);
      }),
    };
    await expect(handleSaveProject(context(adapter(async () => replacement)), true)).resolves.toBe(
      'saved',
    );
    expect(race.disk).toBe('replacement snapshot');
    race.replayGate.resolve();
    await vi.waitFor(() => {
      expect(replacement.write).toHaveBeenCalledTimes(2);
      expect(race.disk).toBe('replacement snapshot');
      expect(useStore.getState()).toMatchObject({ dirty: false, lastSaveTarget: replacement });
    });
  });
});

async function beginSaveRace() {
  const oldGate = deferred();
  const oldStarted = deferred();
  const replayGate = deferred();
  const replayStarted = deferred();
  const race = { disk: '', failReplay: false };
  const retained: SaveTarget = {
    displayName: 'opened.lf2',
    write: async (data) => {
      oldStarted.resolve();
      await oldGate.promise;
      race.disk = note(data);
    },
  };
  let writes = 0;
  const latest: SaveTarget = {
    displayName: 'picked.lf2',
    write: vi.fn(async (data) => {
      writes += 1;
      if (writes === 2) {
        replayStarted.resolve();
        await replayGate.promise;
        if (race.failReplay) throw new Error('Replay disk failure');
      }
      race.disk = note(data);
    }),
  };
  const platform = adapter(async () => latest);
  useStore.setState({
    project: { ...createProject(), notes: 'older snapshot' },
    dirty: true,
    savedName: 'opened.lf2',
    lastSaveTarget: retained,
  });
  const older = handleSaveProject(context(platform));
  await oldStarted.promise;
  useStore.getState().setProjectNotes('chosen snapshot');
  const toast = vi.fn();
  await expect(handleSaveProject(context(platform, toast), true)).resolves.toBe('saved');
  expect(race.disk).toBe('chosen snapshot');
  expect(useStore.getState().dirty).toBe(false);
  return Object.assign(race, { oldGate, replayGate, replayStarted, older, latest, toast });
}
