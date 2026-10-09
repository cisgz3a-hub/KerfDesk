import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createProject } from '../../core/scene';
import { deserializeProject } from '../../io/project';
import type { SaveTarget } from '../../platform/types';
import { webAdapter } from '../../platform/web/web-adapter';
import { handleSaveProject, type SaveProjectCtx } from '../app/project-save-action';
import { useStore } from './index';
import { resetStore } from './test-helpers';

function deferred() {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function context(pushToast = vi.fn()): SaveProjectCtx {
  const state = useStore.getState();
  return {
    platform: webAdapter,
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

function notes(value: string | BufferSource | Blob): string {
  if (typeof value !== 'string') throw new Error('Expected captured project text');
  const parsed = deserializeProject(value);
  if (parsed.kind !== 'ok') throw new Error(`Invalid project fixture: ${parsed.kind}`);
  return parsed.project.notes;
}

function handle(
  name: string,
  close: (payload: string | BufferSource | Blob) => Promise<void>,
  compare: () => Promise<boolean> = async () => true,
) {
  const abort = vi.fn(async () => undefined);
  const createWritable = vi.fn(async () => {
    let payload: string | BufferSource | Blob = '';
    return {
      write: async (data: string | BufferSource | Blob) => {
        payload = data;
      },
      close: async () => close(payload),
      abort,
    };
  });
  return {
    entry: {
      name,
      kind: 'file',
      isSameEntry: compare,
      createWritable,
    } as unknown as FileSystemFileHandle,
    abort,
    createWritable,
  };
}

function retainedTarget(entry: FileSystemFileHandle): SaveTarget {
  const target = webAdapter.openedProjectSaveTarget?.({ kind: 'handle', handle: entry });
  if (!target) throw new Error('Expected a writable opened project');
  return target;
}

function seed(target: SaveTarget): void {
  useStore.setState({
    project: { ...createProject(), notes: 'older snapshot' },
    dirty: true,
    savedName: target.displayName,
    lastSaveTarget: target,
  });
}

type PendingFailureReceipt = {
  scenario: string;
  selectedPending: boolean;
  physicalBytes: string;
  currentProjectNotes: string;
  dirty: boolean;
  sameSavedTarget: boolean;
  savedRequestEpoch: number | null;
  latestRequestEpoch: number;
  failedRepairAborts: number;
  savedOwnerErrors: number;
};

function receipt(
  scenario: string,
  physicalBytes: string,
  savedTarget: SaveTarget | null,
  selectedSettled: boolean,
  failedRepairAborts: number,
  toast: ReturnType<typeof vi.fn>,
): PendingFailureReceipt {
  const state = useStore.getState();
  return {
    scenario,
    selectedPending: !selectedSettled,
    physicalBytes,
    currentProjectNotes: state.project.notes,
    dirty: state.dirty,
    sameSavedTarget: state.lastSaveTarget === savedTarget,
    savedRequestEpoch: state.projectSavedRequestEpoch,
    latestRequestEpoch: state.projectSaveRequestEpoch,
    failedRepairAborts,
    savedOwnerErrors: toast.mock.calls.filter((call) => call[1] === 'error').length,
  };
}

async function assertPendingFailure(observed: PendingFailureReceipt): Promise<void> {
  expect(observed).toMatchObject({
    selectedPending: true,
    physicalBytes: 'older snapshot',
    currentProjectNotes: 'chosen snapshot',
    dirty: true,
    sameSavedTarget: true,
    failedRepairAborts: 1,
    savedOwnerErrors: 1,
  });
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetStore();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetStore();
});

it('reports a saved owner whose running repair fails after a pending selection supersedes its group', async () => {
  const oldGate = deferred();
  const oldStarted = deferred();
  const repairGate = deferred();
  const repairStarted = deferred();
  const pendingGate = deferred();
  const pendingStarted = deferred();
  let disk = '';
  let chosenWrites = 0;
  let pendingSettled = false;
  const old = handle('old.lf2', async (data) => {
    oldStarted.resolve();
    await oldGate.promise;
    disk = notes(data);
  });
  const chosen = handle('chosen.lf2', async (data) => {
    chosenWrites += 1;
    if (chosenWrites === 2) {
      repairStarted.resolve();
      await repairGate.promise;
      throw new Error('Saved owner repair close failed');
    }
    disk = notes(data);
  });
  const pending = handle('pending.lf2', async () => {
    pendingStarted.resolve();
    await pendingGate.promise;
    throw new Error('Pending selected stream failed');
  });
  vi.stubGlobal(
    'showSaveFilePicker',
    vi.fn().mockResolvedValueOnce(chosen.entry).mockResolvedValueOnce(pending.entry),
  );
  seed(retainedTarget(old.entry));
  const older = handleSaveProject(context());
  let newer: ReturnType<typeof handleSaveProject> | undefined;
  const chosenToast = vi.fn();
  try {
    await oldStarted.promise;
    useStore.getState().setProjectNotes('chosen snapshot');
    await expect(handleSaveProject(context(chosenToast), true)).resolves.toBe('saved');
    const savedTarget = useStore.getState().lastSaveTarget;
    oldGate.resolve();
    await expect(older).resolves.toBe('stale-request');
    await repairStarted.promise;
    newer = handleSaveProject(context(), true).finally(() => {
      pendingSettled = true;
    });
    await pendingStarted.promise;
    // Immediate identity calls merge the new selection while B's repair is held.
    await new Promise((done) => setTimeout(done, 0));
    repairGate.resolve();
    await vi.waitFor(() => expect(chosen.abort).toHaveBeenCalledOnce());
    await new Promise((done) => setTimeout(done, 0));
    const observed = receipt(
      'running-owner',
      disk,
      savedTarget,
      pendingSettled,
      chosen.abort.mock.calls.length,
      chosenToast,
    );
    expect(observed).toMatchObject({ savedRequestEpoch: 2, latestRequestEpoch: 3 });
    await assertPendingFailure(observed);
    expect(chosenToast).toHaveBeenCalledWith(
      expect.stringContaining('The project is unsaved; save it again.'),
      'error',
    );
  } finally {
    oldGate.resolve();
    repairGate.resolve();
    pendingGate.resolve();
    await older;
    if (newer) await newer;
    await new Promise((done) => setTimeout(done, 0));
  }
});

it('flushes an unknown failure for a deferred saved owner when supersession cancels its old own replay', async () => {
  const oldGate = deferred();
  const oldStarted = deferred();
  const failedReplayGate = deferred();
  const failedReplayStarted = deferred();
  const pendingGate = deferred();
  const pendingStarted = deferred();
  let disk = '';
  let middleWrites = 0;
  let pendingSettled = false;
  const unknown = async (): Promise<boolean> => {
    throw new Error('Entry identity is unavailable');
  };
  const old = handle(
    'old-unknown.lf2',
    async (data) => {
      oldStarted.resolve();
      await oldGate.promise;
      disk = notes(data);
    },
    unknown,
  );
  const middle = handle(
    'middle-unknown.lf2',
    async (data) => {
      middleWrites += 1;
      if (middleWrites === 2) {
        failedReplayStarted.resolve();
        await failedReplayGate.promise;
        throw new Error('Earlier unknown replay close failed');
      }
      disk = notes(data);
    },
    unknown,
  );
  const chosen = handle(
    'chosen-unknown.lf2',
    async (data) => {
      disk = notes(data);
    },
    unknown,
  );
  const pending = handle(
    'pending-unknown.lf2',
    async () => {
      pendingStarted.resolve();
      await pendingGate.promise;
      throw new Error('Pending selected stream failed');
    },
    unknown,
  );
  vi.stubGlobal(
    'showSaveFilePicker',
    vi
      .fn()
      .mockResolvedValueOnce(middle.entry)
      .mockResolvedValueOnce(chosen.entry)
      .mockResolvedValueOnce(pending.entry),
  );
  seed(retainedTarget(old.entry));
  const older = handleSaveProject(context());
  let newer: ReturnType<typeof handleSaveProject> | undefined;
  const chosenToast = vi.fn();
  try {
    await oldStarted.promise;
    useStore.getState().setProjectNotes('middle snapshot');
    await expect(handleSaveProject(context(), true)).resolves.toBe('saved');
    useStore.getState().setProjectNotes('chosen snapshot');
    await expect(handleSaveProject(context(chosenToast), true)).resolves.toBe('saved');
    const savedTarget = useStore.getState().lastSaveTarget;
    oldGate.resolve();
    await expect(older).resolves.toBe('stale-request');
    await failedReplayStarted.promise;
    newer = handleSaveProject(context(), true).finally(() => {
      pendingSettled = true;
    });
    await pendingStarted.promise;
    await new Promise((done) => setTimeout(done, 0));
    failedReplayGate.resolve();
    await vi.waitFor(() => expect(middle.abort).toHaveBeenCalledOnce());
    await new Promise((done) => setTimeout(done, 0));
    // The old group's deferred B replay is retired; the replacement group waits
    // for C's selected close, which still has not settled.
    expect(chosen.createWritable).toHaveBeenCalledOnce();
    const observed = receipt(
      'deferred-owner',
      disk,
      savedTarget,
      pendingSettled,
      middle.abort.mock.calls.length,
      chosenToast,
    );
    expect(observed).toMatchObject({ savedRequestEpoch: 3, latestRequestEpoch: 4 });
    await assertPendingFailure(observed);
    expect(chosenToast).toHaveBeenCalledWith(
      expect.stringContaining('The project is unsaved; save it again.'),
      'error',
    );
  } finally {
    oldGate.resolve();
    failedReplayGate.resolve();
    pendingGate.resolve();
    await older;
    if (newer) await newer;
    await new Promise((done) => setTimeout(done, 0));
  }
});
