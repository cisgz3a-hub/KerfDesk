import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject, type Project } from '../../core/scene';
import { deserializeProject } from '../../io/project';
import type { PlatformAdapter, SaveTarget } from '../../platform/types';
import { useStore } from '../state';
import { readAutosave, writeAutosave } from '../state/autosave';
import { resetStore } from '../state/test-helpers';
import { handleSaveProject, type SaveProjectCtx } from './file-actions';

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
} {
  let resolve = (_value: T): void => undefined;
  let reject = (_reason: unknown): void => undefined;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function platform(pickFileForSave: PlatformAdapter['pickFileForSave']): PlatformAdapter {
  return {
    id: 'mock',
    pickFilesForOpen: async () => [],
    pickFileForSave,
    serial: { isSupported: () => false, requestPort: async () => null },
  };
}

function context(project: Project, adapter: PlatformAdapter, pushToast = vi.fn()): SaveProjectCtx {
  const state = useStore.getState();
  return {
    platform: adapter,
    project,
    expectedProject: project,
    projectDocumentEpoch: state.projectDocumentEpoch,
    getProjectDocumentEpoch: () => useStore.getState().projectDocumentEpoch,
    claimProjectSaveRequest: state.claimProjectSaveRequest,
    getProjectSaveRequestEpoch: () => useStore.getState().projectSaveRequestEpoch,
    projectSaveWriteCoordinator: state.projectSaveWriteCoordinator,
    savedName: state.savedName,
    lastSaveTarget: state.lastSaveTarget,
    markSaved: state.markSaved,
    markProjectSaveUncertain: state.markProjectSaveUncertain,
    pushToast,
  };
}

function noteFromWrite(value: string | Blob): string {
  if (typeof value !== 'string') throw new Error('Expected project JSON text.');
  const decoded = deserializeProject(value);
  if (decoded.kind !== 'ok') throw new Error(`Could not decode saved project: ${decoded.kind}`);
  return decoded.project.notes;
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetStore();
});

describe('project Save physical write ordering', () => {
  it('does not delay a selected destination behind an unrelated unresolved picker', async () => {
    const firstPicker = deferred<SaveTarget | null>();
    const firstNotes: string[] = [];
    const secondNotes: string[] = [];
    const firstTarget: SaveTarget = {
      displayName: 'first.lf2',
      write: vi.fn(async (value) => {
        firstNotes.push(noteFromWrite(value));
      }),
    };
    const secondTarget: SaveTarget = {
      displayName: 'second.lf2',
      write: vi.fn(async (value) => {
        secondNotes.push(noteFromWrite(value));
      }),
    };
    const firstToast = vi.fn();
    const secondToast = vi.fn();
    const firstProject = { ...createProject(), notes: 'first request' };
    useStore.setState({ project: firstProject, dirty: true });
    const first = handleSaveProject(
      context(
        firstProject,
        platform(async () => firstPicker.promise),
        firstToast,
      ),
    );

    const secondProject = { ...firstProject, notes: 'second request' };
    useStore.setState({ project: secondProject, dirty: true });
    expect(writeAutosave(secondProject, 200).kind).toBe('ok');
    const second = handleSaveProject(
      context(
        secondProject,
        platform(async () => secondTarget),
        secondToast,
      ),
    );
    await expect(second).resolves.toBe('saved');
    expect(secondNotes).toEqual(['second request']);
    expect(firstTarget.write).not.toHaveBeenCalled();
    expect(readAutosave()).toBeNull();
    expect(secondToast).toHaveBeenCalledWith('Saved project to second.lf2', 'success');

    firstPicker.resolve(firstTarget);
    await expect(first).resolves.toBe('stale-request');
    expect(firstNotes).toEqual(['first request']);
    expect(firstToast).not.toHaveBeenCalled();
  });

  it('runs a distinct selected write while destination equality is stalled', async () => {
    const firstWrite = deferred<undefined>();
    const identityComparison = deferred<boolean>();
    const firstTarget: SaveTarget = {
      displayName: 'first.lf2',
      isSameDestination: async () => identityComparison.promise,
      write: vi.fn(async () => firstWrite.promise),
    };
    const secondTarget: SaveTarget = {
      displayName: 'second.lf2',
      write: vi.fn(async () => undefined),
    };
    const firstProject = { ...createProject(), notes: 'first request' };
    useStore.setState({ project: firstProject, dirty: true });
    const first = handleSaveProject(
      context(
        firstProject,
        platform(async () => firstTarget),
      ),
    );
    await vi.waitFor(() => expect(firstTarget.write).toHaveBeenCalledOnce());
    const secondProject = { ...firstProject, notes: 'second request' };
    useStore.setState({ project: secondProject, dirty: true });

    await expect(
      handleSaveProject(
        context(
          secondProject,
          platform(async () => secondTarget),
        ),
      ),
    ).resolves.toBe('saved');
    expect(secondTarget.write).toHaveBeenCalledOnce();

    identityComparison.resolve(false);
    firstWrite.resolve(undefined);
    await expect(first).resolves.toBe('stale-request');
  });

  it('replays the newest bytes after an older picker selects the same target late', async () => {
    const firstPicker = deferred<SaveTarget | null>();
    const writtenNotes: string[] = [];
    const target: SaveTarget = {
      displayName: 'shared.lf2',
      write: vi.fn(async (value) => {
        writtenNotes.push(noteFromWrite(value));
      }),
    };
    const firstProject = { ...createProject(), notes: 'first request' };
    useStore.setState({ project: firstProject, dirty: true });
    const first = handleSaveProject(
      context(
        firstProject,
        platform(async () => firstPicker.promise),
      ),
    );
    const secondProject = { ...firstProject, notes: 'second request' };
    useStore.setState({ project: secondProject, dirty: true });

    await expect(
      handleSaveProject(
        context(
          secondProject,
          platform(async () => target),
        ),
      ),
    ).resolves.toBe('saved');
    expect(writtenNotes).toEqual(['second request']);

    firstPicker.resolve(target);
    await expect(first).resolves.toBe('stale-request');
    await vi.waitFor(() =>
      expect(writtenNotes).toEqual(['second request', 'first request', 'second request']),
    );
    expect(useStore.getState()).toMatchObject({
      project: secondProject,
      dirty: false,
      savedName: 'shared.lf2',
      lastSaveTarget: target,
    });
  });

  it('marks the newest owner unsaved when its late restore write fails', async () => {
    const firstPicker = deferred<SaveTarget | null>();
    const writtenNotes: string[] = [];
    const target: SaveTarget = {
      displayName: 'shared.lf2',
      write: vi.fn(async (value) => {
        writtenNotes.push(noteFromWrite(value));
        if (writtenNotes.length === 3) throw new Error('restore disk failure');
      }),
    };
    const firstToast = vi.fn();
    const secondToast = vi.fn();
    const firstProject = { ...createProject(), notes: 'first request' };
    useStore.setState({ project: firstProject, dirty: true });
    const first = handleSaveProject(
      context(
        firstProject,
        platform(async () => firstPicker.promise),
        firstToast,
      ),
    );
    const secondProject = { ...firstProject, notes: 'second request' };
    useStore.setState({ project: secondProject, dirty: true });

    await expect(
      handleSaveProject(
        context(
          secondProject,
          platform(async () => target),
          secondToast,
        ),
      ),
    ).resolves.toBe('saved');
    expect(useStore.getState().dirty).toBe(false);

    firstPicker.resolve(target);
    await expect(first).resolves.toBe('stale-request');
    await vi.waitFor(() => {
      expect(writtenNotes).toEqual(['second request', 'first request', 'second request']);
      expect(useStore.getState()).toMatchObject({
        project: secondProject,
        dirty: true,
        savedName: 'shared.lf2',
        lastSaveTarget: target,
      });
    });
    expect(firstToast).not.toHaveBeenCalled();
    expect(secondToast).toHaveBeenCalledWith(
      expect.stringContaining('The project is unsaved; save it again.'),
      'error',
    );
  });

  it('starts a later same-target write before the unresolved earlier write and recovers its rejection', async () => {
    const firstWrite = deferred<undefined>();
    const writtenNotes: string[] = [];
    const target: SaveTarget = {
      displayName: 'shared.lf2',
      write: vi.fn(async (value) => {
        writtenNotes.push(noteFromWrite(value));
        if (writtenNotes.length === 1) await firstWrite.promise;
      }),
    };
    const firstProject = { ...createProject(), notes: 'failed request' };
    useStore.setState({ project: firstProject, dirty: true });
    const first = handleSaveProject(
      context(
        firstProject,
        platform(async () => target),
      ),
    );
    await vi.waitFor(() => expect(target.write).toHaveBeenCalledOnce());

    const secondProject = { ...firstProject, notes: 'surviving request' };
    useStore.setState({ project: secondProject, dirty: true });
    const second = handleSaveProject(
      context(
        secondProject,
        platform(async () => target),
      ),
    );
    await vi.waitFor(() => expect(target.write).toHaveBeenCalledTimes(2));
    await expect(second).resolves.toBe('saved');
    expect(writtenNotes).toEqual(['failed request', 'surviving request']);

    firstWrite.reject(new Error('first disk failure'));

    await expect(first).resolves.toBe('stale-request');
    await vi.waitFor(() =>
      expect(writtenNotes).toEqual(['failed request', 'surviving request', 'surviving request']),
    );
  });
});
