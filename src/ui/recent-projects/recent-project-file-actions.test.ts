// Opening and saving a project are what put it on the Recent Projects list.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../../core/scene';
import { serializeProject } from '../../io/project';
import type { PlatformAdapter, RecentFileAdapter, RecentFileRef } from '../../platform/types';
import { mockPlatform, projectWithLine, toasts } from '../../__fixtures__/file-actions';
import { handleSaveProject } from '../app/file-actions';
import { openProjectCommand } from '../commands/open-project-command';
import { useStore } from '../state';
import { clearAutosave } from '../state/autosave';
import { createMemoryRecentProjectStorage } from './recent-project-storage';
import {
  configureRecentProjectsForTests,
  reloadRecentProjects,
  useRecentProjectsStore,
} from './recent-projects-store';

const REF: RecentFileRef = {
  kind: 'desktop-path',
  path: 'C:\\Jobs\\coaster.lf2',
  token: 'd'.repeat(43),
};

function recentFiles(): RecentFileAdapter {
  return {
    open: async () => ({ kind: 'missing' }),
    probe: async () => ({ kind: 'unknown' }),
    isSameFile: async () => false,
  };
}

function withRecentFiles(platform: PlatformAdapter): PlatformAdapter {
  return { ...platform, recentFiles: recentFiles() };
}

async function recentNames(): Promise<string[]> {
  await reloadRecentProjects(undefined);
  return useRecentProjectsStore.getState().entries.map((entry) => entry.name);
}

beforeEach(() => {
  configureRecentProjectsForTests(createMemoryRecentProjectStorage());
  useStore.getState().newProject();
  useStore.setState({ dirty: false, projectOpenRequestEpoch: 0 });
});

afterEach(() => {
  clearAutosave();
  configureRecentProjectsForTests(null);
  useStore.getState().newProject();
  useStore.setState({ dirty: false });
});

describe('Recent Projects recording', () => {
  it('records a project opened through File > Open with where it came from', async () => {
    const text = serializeProject(projectWithLine());
    const platform = withRecentFiles(
      mockPlatform({
        open: async () => [{ name: 'coaster.lf2', text: async () => text, recentRef: REF }],
      }),
    );

    await openProjectCommand(platform, toasts().pushToast);

    expect(useStore.getState().savedName).toBe('coaster.lf2');
    expect(await recentNames()).toEqual(['coaster.lf2']);
    expect(useRecentProjectsStore.getState().entries[0]?.ref).toEqual(REF);
  });

  it('does not record a file that failed to open, or a cancelled picker', async () => {
    const broken = withRecentFiles(
      mockPlatform({ open: async () => [{ name: 'broken.lf2', text: async () => '{ nope' }] }),
    );
    const toast = toasts();
    await openProjectCommand(broken, toast.pushToast);
    await openProjectCommand(withRecentFiles(mockPlatform()), toast.pushToast);

    expect(toast.messages.some((entry) => entry.variant === 'error')).toBe(true);
    expect(await recentNames()).toEqual([]);
  });

  it('records a saved project under the name it was saved as', async () => {
    const target = {
      displayName: 'saved-as.lf2',
      write: vi.fn(async () => undefined),
      recentRef: REF,
    };
    const project = { ...createProject(), notes: 'save me' };
    useStore.setState({ project, dirty: true });

    const outcome = await handleSaveProject({
      platform: withRecentFiles(mockPlatform({ save: async () => target })),
      project,
      expectedProject: project,
      projectDocumentEpoch: useStore.getState().projectDocumentEpoch,
      getProjectDocumentEpoch: () => useStore.getState().projectDocumentEpoch,
      claimProjectSaveRequest: useStore.getState().claimProjectSaveRequest,
      getProjectSaveRequestEpoch: () => useStore.getState().projectSaveRequestEpoch,
      projectSaveWriteCoordinator: useStore.getState().projectSaveWriteCoordinator,
      markProjectSaveUncertain: useStore.getState().markProjectSaveUncertain,
      savedName: null,
      lastSaveTarget: null,
      markSaved: useStore.getState().markSaved,
      pushToast: toasts().pushToast,
    });

    expect(outcome).toBe('saved');
    expect(await recentNames()).toEqual(['saved-as.lf2']);
  });

  it('does not record a save that never reached the file', async () => {
    const target = {
      displayName: 'full-disk.lf2',
      write: vi.fn(async () => {
        throw new Error('The disk is full.');
      }),
    };
    const project = createProject();
    const outcome = await handleSaveProject({
      platform: withRecentFiles(mockPlatform({ save: async () => target })),
      project,
      expectedProject: useStore.getState().project,
      projectDocumentEpoch: useStore.getState().projectDocumentEpoch,
      getProjectDocumentEpoch: () => useStore.getState().projectDocumentEpoch,
      claimProjectSaveRequest: useStore.getState().claimProjectSaveRequest,
      getProjectSaveRequestEpoch: () => useStore.getState().projectSaveRequestEpoch,
      projectSaveWriteCoordinator: useStore.getState().projectSaveWriteCoordinator,
      markProjectSaveUncertain: useStore.getState().markProjectSaveUncertain,
      savedName: null,
      lastSaveTarget: null,
      markSaved: useStore.getState().markSaved,
      pushToast: toasts().pushToast,
    });

    expect(outcome).not.toBe('saved');
    expect(await recentNames()).toEqual([]);
  });
});
