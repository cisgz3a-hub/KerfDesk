import { expect, vi } from 'vitest';
import { createProject } from '../core/scene';
import { deserializeProject } from '../io/project';
import type { PlatformAdapter, SaveTarget } from '../platform/types';
import { handleSaveProject, type SaveProjectCtx } from '../ui/app/project-save-action';
import { useStore } from '../ui/state/index';
function deferred() {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

export function context(
  platform: PlatformAdapter,
  markUncertain: SaveProjectCtx['markProjectSaveUncertain'],
  pushToast = vi.fn(),
): SaveProjectCtx {
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
    markProjectSaveUncertain: markUncertain,
    savedName: state.savedName,
    lastSaveTarget: state.lastSaveTarget,
    pushToast,
  };
}

export function note(data: string | Blob): string {
  if (typeof data !== 'string') throw new Error('Expected project text');
  const result = deserializeProject(data);
  if (result.kind !== 'ok') throw new Error(`Invalid saved fixture: ${result.kind}`);
  return result.project.notes;
}

export async function beginRace(
  knownDestination: boolean,
  options: {
    chosenRestoreFails?: boolean;
    laterMutates?: boolean;
    laterDistinct?: boolean;
    rejectOlderFeedback?: boolean;
    stallOlderFeedback?: boolean;
    stallLaterReplay?: boolean;
  } = {},
) {
  const {
    chosenRestoreFails = true,
    laterMutates = false,
    laterDistinct = false,
    rejectOlderFeedback = false,
    stallOlderFeedback = false,
    stallLaterReplay = false,
  } = options;
  const oldGate = deferred();
  const oldStarted = deferred();
  const replayGate = deferred();
  const replayStarted = deferred();
  const laterReplayStarted = deferred();
  const laterReplayGate = deferred();
  const olderFeedbackStarted = deferred();
  const olderFeedbackGate = deferred();
  const destinationIdentity = {};
  const disk = { alias: '', distinct: '' };
  const identity = knownDestination ? { destinationIdentity } : {};
  const retained: SaveTarget = {
    ...identity,
    displayName: 'opened-path.lf2',
    write: async (data) => {
      oldStarted.resolve();
      await oldGate.promise;
      disk.alias = note(data);
    },
  };
  let chosenWrites = 0;
  const chosen: SaveTarget = {
    ...identity,
    displayName: 'chosen-handle.lf2',
    write: vi.fn(async (data) => {
      chosenWrites += 1;
      if (chosenWrites === 2) {
        replayStarted.resolve();
        await replayGate.promise;
        if (chosenRestoreFails) throw new Error('Chosen destination restore failed');
      }
      disk.alias = note(data);
    }),
  };
  let laterWrites = 0;
  const failedLater: SaveTarget = {
    ...identity,
    displayName: 'failed-later.lf2',
    ...(laterDistinct
      ? {
          compareDestination: async (other: SaveTarget) =>
            other === chosen ? ('different' as const) : ('unknown' as const),
        }
      : {}),
    write: vi.fn(async () => {
      laterWrites += 1;
      if (laterWrites === 1 && laterDistinct)
        await new Promise((resolve) => setTimeout(resolve, 0));
      if (laterWrites === 2 && knownDestination) {
        replayStarted.resolve();
        await replayGate.promise;
      }
      if (laterWrites === 2 && stallLaterReplay) {
        laterReplayStarted.resolve();
        await laterReplayGate.promise;
      }
      if (laterWrites === 2 && laterMutates)
        disk[laterDistinct ? 'distinct' : 'alias'] = 'truncated by failed replay';
      throw new Error('Later selected destination failed');
    }),
  };
  const platform = (target: SaveTarget): PlatformAdapter => ({
    id: 'mock',
    pickFilesForOpen: async () => [],
    pickFileForSave: async () => target,
    serial: { isSupported: () => false, requestPort: async () => null },
  });
  useStore.setState({
    project: { ...createProject(), notes: 'older snapshot' },
    dirty: true,
    savedName: retained.displayName,
    lastSaveTarget: retained,
  });
  const markSavedUncertain = useStore.getState().markProjectSaveUncertain;
  const markUncertain = vi.fn(
    async (...args: Parameters<SaveProjectCtx['markProjectSaveUncertain']>) => {
      if (rejectOlderFeedback && args[1] === 1) throw new Error('Older owner feedback rejected');
      if (stallOlderFeedback && args[1] === 1) {
        olderFeedbackStarted.resolve();
        await olderFeedbackGate.promise;
      }
      return markSavedUncertain(...args);
    },
  );
  const documentEpoch = useStore.getState().projectDocumentEpoch;
  const older = handleSaveProject(context(platform(chosen), markUncertain));
  await oldStarted.promise;
  useStore.getState().setProjectNotes('chosen snapshot');
  const chosenToast = vi.fn();
  await expect(
    handleSaveProject(context(platform(chosen), markUncertain, chosenToast), true),
  ).resolves.toBe('saved');
  expect(useStore.getState()).toMatchObject({
    dirty: false,
    lastSaveTarget: chosen,
    projectSavedRequestEpoch: 2,
  });
  await expect(
    handleSaveProject(context(platform(failedLater), markUncertain), true),
  ).resolves.toBe('error');
  oldGate.resolve();
  await expect(older).resolves.toBe('stale-request');
  await replayStarted.promise;
  return {
    disk,
    chosen,
    failedLater,
    replayGate,
    chosenToast,
    markUncertain,
    documentEpoch,
    platform,
    laterReplayStarted,
    laterReplayGate,
    olderFeedbackStarted,
    olderFeedbackGate,
  };
}
