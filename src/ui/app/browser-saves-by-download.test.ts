// Rolling audit v11 W9-P2-2 (ADR-688 Amendment 2): in Firefox and Safari a
// Save downloads the project, keeps the autosave (a download reports nothing
// back), and the first autosave asks the browser to keep this site's storage.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '../../core/scene';
import type { SaveTarget } from '../../platform/types';
import type * as AutosaveFileCleanup from './autosave-file-cleanup';

const clearAutosaveAfterFileHandoff = vi.hoisted(() => vi.fn());
vi.mock('./autosave-file-cleanup', async (importOriginal) => ({
  ...(await importOriginal<typeof AutosaveFileCleanup>()),
  clearAutosaveAfterFileHandoff,
}));

const requestPersistentStorageOnce = vi.hoisted(() => vi.fn());
vi.mock('./persistent-storage-request', () => ({ requestPersistentStorageOnce }));

import {
  completeProjectSave,
  projectDownloadedMessage,
  type ProjectSaveOwner,
} from './project-save-completion';
import { autosaveWriter } from './use-autosave';

afterEach(() => vi.clearAllMocks());

function owner(pushToast: ProjectSaveOwner['pushToast']): ProjectSaveOwner {
  return {
    expectedProject: {} as Project,
    projectDocumentEpoch: 1,
    getProjectDocumentEpoch: () => 1,
    projectSaveRequestEpoch: 1,
    getProjectSaveRequestEpoch: () => 1,
    markSaved: () => true,
    markProjectSaveUncertain: async () => true,
    pushToast,
  };
}

function target(delivery?: 'download'): SaveTarget {
  return {
    displayName: 'job.lf2',
    write: async () => undefined,
    ...(delivery ? { delivery } : {}),
  };
}

describe('a Save that downloads', () => {
  it('says where the file went and keeps the autosave', () => {
    const pushToast = vi.fn();

    expect(completeProjectSave(owner(pushToast), target('download'), false)).toBe('saved');

    expect(pushToast).toHaveBeenCalledWith(projectDownloadedMessage('job.lf2'), 'success');
    expect(projectDownloadedMessage('job.lf2')).toContain('Downloads folder');
    expect(clearAutosaveAfterFileHandoff).not.toHaveBeenCalled();
  });

  it('still hands the autosave over after a save written in place', () => {
    const pushToast = vi.fn();

    completeProjectSave(owner(pushToast), target(), false);

    expect(pushToast).toHaveBeenCalledWith('Saved project to job.lf2', 'success');
    expect(clearAutosaveAfterFileHandoff).toHaveBeenCalledTimes(1);
  });
});

describe('autosaveWriter', () => {
  const ok = { kind: 'ok', savedAt: 1, storageKey: 'k', backend: 'indexeddb' } as const;

  it('asks the browser to keep its storage after a successful autosave where saves cannot be picked', async () => {
    const write = vi.fn(async () => ok);
    const writer = autosaveWriter(true, write);

    await expect(writer({} as Project)).resolves.toBe(ok);
    expect(requestPersistentStorageOnce).toHaveBeenCalledTimes(1);
  });

  it('does not ask after a failed autosave, nor where file pickers exist', async () => {
    const failed = { kind: 'failed', reason: 'quota' } as const;
    await autosaveWriter(
      true,
      vi.fn(async () => failed as never),
    )({} as Project);
    await autosaveWriter(
      false,
      vi.fn(async () => ok),
    )({} as Project);

    expect(requestPersistentStorageOnce).not.toHaveBeenCalled();
  });
});
