// A project save the operator makes is when KerfDesk asks the browser to keep
// its local storage (autosave, Recent Projects), and the save never waits for
// the browser's answer.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../../core/scene';
import type { PlatformAdapter, SaveTarget } from '../../platform/types';
import { mockPlatform, toasts } from '../../__fixtures__/file-actions';
import { useStore } from '../state';
import { clearAutosave } from '../state/autosave';
import { handleSaveProject } from './project-save-action';
import type { SaveProjectOutcome } from './project-save-completion';

function target(displayName: string, write: SaveTarget['write'] = async () => undefined) {
  return { displayName, write };
}

function saveWith(platform: PlatformAdapter): Promise<SaveProjectOutcome> {
  const project = { ...createProject(), notes: 'keep me' };
  useStore.setState({ project, dirty: true });
  return handleSaveProject({
    platform,
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
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  useStore.getState().newProject();
  useStore.setState({ dirty: false });
});

afterEach(() => {
  Reflect.deleteProperty(navigator, 'storage');
  clearAutosave();
  useStore.getState().newProject();
  useStore.setState({ dirty: false });
});

describe('handleSaveProject and persistent storage', () => {
  it('asks once, after the first save that reaches the file, without waiting for the answer', async () => {
    const storage = {
      persisted: vi.fn(async () => false),
      // Firefox's permission prompt, left unanswered.
      persist: vi.fn(() => new Promise<boolean>(() => undefined)),
    };
    Object.defineProperty(navigator, 'storage', { configurable: true, value: storage });
    const fullDisk = async (): Promise<void> => {
      throw new Error('The disk is full.');
    };

    // A cancelled picker and a failed write saved nothing, so they do not ask.
    expect(await saveWith(mockPlatform({ save: async () => null }))).toBe('cancelled');
    expect(await saveWith(mockPlatform({ save: async () => target('full.lf2', fullDisk) }))).toBe(
      'error',
    );
    await settle();
    expect(storage.persisted).not.toHaveBeenCalled();

    expect(await saveWith(mockPlatform({ save: async () => target('coaster.lf2') }))).toBe('saved');
    await settle();
    expect(storage.persist).toHaveBeenCalledTimes(1);

    // The prompt is still open, yet the next save completes and does not ask again.
    expect(await saveWith(mockPlatform({ save: async () => target('coaster-2.lf2') }))).toBe(
      'saved',
    );
    await settle();
    expect(storage.persisted).toHaveBeenCalledTimes(1);
    expect(storage.persist).toHaveBeenCalledTimes(1);
  });
});
