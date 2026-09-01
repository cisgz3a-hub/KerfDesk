import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject, type Project } from '../../core/scene';
import { deserializeProject } from '../../io/project';
import type { PlatformAdapter, SaveTarget } from '../../platform/types';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { handleSaveProject, type SaveProjectCtx } from './file-actions';

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  let resolve = (_value: T): void => undefined;
  const promise = new Promise<T>((onResolve) => {
    resolve = onResolve;
  });
  return { promise, resolve };
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

function samePhysicalDestinationTarget(
  destinationKey: object,
  write: SaveTarget['write'],
): SaveTarget {
  const destinationIdentity = { destinationKey };
  return {
    displayName: 'shared.lf2',
    destinationIdentity,
    isSameDestination: async (other) =>
      destinationKeyFrom(other.destinationIdentity) === destinationKey,
    write,
  };
}

function destinationKeyFrom(value: unknown): unknown {
  return typeof value === 'object' && value !== null && 'destinationKey' in value
    ? value.destinationKey
    : undefined;
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetStore();
});

describe('project Save destination ownership lifecycle', () => {
  it('retains one coordinator across New and Open document replacement', () => {
    const coordinator = useStore.getState().projectSaveWriteCoordinator;
    useStore.getState().newProject();
    expect(useStore.getState().projectSaveWriteCoordinator).toBe(coordinator);
    useStore.getState().setProject(createProject());
    expect(useStore.getState().projectSaveWriteCoordinator).toBe(coordinator);
  });

  it('reconciles distinct target wrappers for the same physical destination', async () => {
    const firstPicker = deferred<SaveTarget | null>();
    const writtenNotes: string[] = [];
    const destinationKey = {};
    const write = vi.fn<SaveTarget['write']>(async (value) => {
      writtenNotes.push(noteFromWrite(value));
    });
    const firstTarget = samePhysicalDestinationTarget(destinationKey, write);
    const secondTarget = samePhysicalDestinationTarget(destinationKey, write);
    const firstProject = { ...createProject(), notes: 'older wrapper' };
    useStore.setState({ project: firstProject, dirty: true });
    const first = handleSaveProject(
      context(
        firstProject,
        platform(async () => firstPicker.promise),
      ),
    );
    const secondProject = { ...firstProject, notes: 'newer wrapper' };
    useStore.setState({ project: secondProject, dirty: true });

    await expect(
      handleSaveProject(
        context(
          secondProject,
          platform(async () => secondTarget),
        ),
      ),
    ).resolves.toBe('saved');
    firstPicker.resolve(firstTarget);
    await expect(first).resolves.toBe('stale-request');

    expect(firstTarget).not.toBe(secondTarget);
    await vi.waitFor(() =>
      expect(writtenNotes).toEqual(['newer wrapper', 'older wrapper', 'newer wrapper']),
    );
    expect(write).toHaveBeenCalledTimes(3);
  });

  it('writes captured bytes after the selected target document owner becomes stale', async () => {
    const picker = deferred<SaveTarget | null>();
    const writtenNotes: string[] = [];
    const target: SaveTarget = {
      displayName: 'old-document.lf2',
      write: vi.fn(async (value) => {
        writtenNotes.push(noteFromWrite(value));
      }),
    };
    const toast = vi.fn();
    const captured = { ...createProject(), notes: 'captured document' };
    useStore.setState({ project: captured, dirty: true });
    const saving = handleSaveProject(
      context(
        captured,
        platform(async () => picker.promise),
        toast,
      ),
    );

    useStore.getState().newProject();
    const replacement = { ...useStore.getState().project, notes: 'replacement document' };
    useStore.setState({ project: replacement, dirty: true });
    picker.resolve(target);

    await expect(saving).resolves.toBe('stale-document');
    expect(writtenNotes).toEqual(['captured document']);
    expect(useStore.getState()).toMatchObject({
      project: replacement,
      dirty: true,
      savedName: null,
      lastSaveTarget: null,
    });
    expect(toast).not.toHaveBeenCalled();
  });

  it('does not dirty a newer Save owner when an older destination restore fails', async () => {
    const firstPicker = deferred<SaveTarget | null>();
    const sharedNotes: string[] = [];
    const sharedTarget: SaveTarget = {
      displayName: 'shared.lf2',
      write: vi.fn(async (value) => {
        sharedNotes.push(noteFromWrite(value));
        if (sharedNotes.length === 3) throw new Error('restore disk failure');
      }),
    };
    const newestTarget: SaveTarget = {
      displayName: 'newest.lf2',
      write: vi.fn(async () => undefined),
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
    const secondToast = vi.fn();
    await expect(
      handleSaveProject(
        context(
          secondProject,
          platform(async () => sharedTarget),
          secondToast,
        ),
      ),
    ).resolves.toBe('saved');
    const newestProject = { ...secondProject, notes: 'newest request' };
    useStore.setState({ project: newestProject, dirty: true });
    await expect(
      handleSaveProject(
        context(
          newestProject,
          platform(async () => newestTarget),
        ),
        true,
      ),
    ).resolves.toBe('saved');

    firstPicker.resolve(sharedTarget);
    await expect(first).resolves.toBe('stale-request');

    await vi.waitFor(() =>
      expect(sharedNotes).toEqual(['second request', 'first request', 'second request']),
    );
    expect(useStore.getState()).toMatchObject({
      project: newestProject,
      dirty: false,
      savedName: 'newest.lf2',
      lastSaveTarget: newestTarget,
    });
    expect(secondToast).not.toHaveBeenCalledWith(expect.any(String), 'error');
  });

  it('lets a later destination finish before an earlier picker is cancelled', async () => {
    const firstPicker = deferred<SaveTarget | null>();
    const target: SaveTarget = {
      displayName: 'second.lf2',
      write: vi.fn(async () => undefined),
    };
    const firstProject = { ...createProject(), notes: 'cancelled request' };
    useStore.setState({ project: firstProject, dirty: true });
    const first = handleSaveProject(
      context(
        firstProject,
        platform(async () => firstPicker.promise),
      ),
    );
    const secondProject = { ...firstProject, notes: 'saved request' };
    useStore.setState({ project: secondProject, dirty: true });

    await expect(
      handleSaveProject(
        context(
          secondProject,
          platform(async () => target),
        ),
      ),
    ).resolves.toBe('saved');
    expect(target.write).toHaveBeenCalledOnce();

    firstPicker.resolve(null);
    await expect(first).resolves.toBe('cancelled');
  });
});
