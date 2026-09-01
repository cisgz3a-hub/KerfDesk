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

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetStore();
});

describe('project Save pending-owner recovery', () => {
  it('keeps a pending then cancelled request from hiding destination uncertainty', async () => {
    const firstPicker = deferred<SaveTarget | null>();
    const thirdPicker = deferred<SaveTarget | null>();
    const writtenNotes: string[] = [];
    const target: SaveTarget = {
      displayName: 'shared.lf2',
      write: vi.fn(async (value) => {
        writtenNotes.push(noteFromWrite(value));
        if (writtenNotes.length === 3) throw new Error('restore disk failure');
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
    const savedProject = { ...firstProject, notes: 'saved request' };
    useStore.setState({ project: savedProject, dirty: true });
    const savedToast = vi.fn();
    await expect(
      handleSaveProject(
        context(
          savedProject,
          platform(async () => target),
          savedToast,
        ),
      ),
    ).resolves.toBe('saved');
    expect(useStore.getState().dirty).toBe(false);

    const thirdPickerFn = vi.fn(async () => thirdPicker.promise);
    const pending = handleSaveProject(context(savedProject, platform(thirdPickerFn)), true);
    await vi.waitFor(() => expect(thirdPickerFn).toHaveBeenCalledOnce());
    firstPicker.resolve(target);
    await expect(first).resolves.toBe('stale-request');

    await vi.waitFor(() => {
      expect(writtenNotes).toEqual(['saved request', 'first request', 'saved request']);
      expect(useStore.getState()).toMatchObject({
        project: savedProject,
        dirty: true,
        savedName: 'shared.lf2',
        lastSaveTarget: target,
      });
    });
    expect(savedToast).toHaveBeenCalledWith(
      expect.stringContaining('The project is unsaved; save it again.'),
      'error',
    );

    thirdPicker.resolve(null);
    await expect(pending).resolves.toBe('cancelled');
    expect(useStore.getState().dirty).toBe(true);
  });
});
