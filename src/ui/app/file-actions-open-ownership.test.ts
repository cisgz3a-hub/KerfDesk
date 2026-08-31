import { describe, expect, it, vi } from 'vitest';
import { projectOpenRequestEpochCallbacks, projectWithLine } from '../../__fixtures__/file-actions';
import type { Project } from '../../core/scene';
import { serializeProject } from '../../io/project';
import type { PlatformAdapter } from '../../platform/types';
import { projectAutosaveService } from '../state/autosave-durable';
import { AUTOSAVE_FILE_CLEANUP_WARNING } from './autosave-file-cleanup';
import { handleOpenProject } from './file-actions';

type Deferred<T> = {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function project(name: string): Project {
  return { ...projectWithLine(), notes: name };
}

function platformFor(name: string, text: () => Promise<string>): PlatformAdapter {
  return {
    id: 'mock',
    pickFilesForOpen: async () => [{ name, text }],
    pickFileForSave: async () => null,
    serial: { isSupported: () => false, requestPort: async () => null },
  };
}

describe('project Open request ownership', () => {
  it('ignores an older picker completion after a newer Open claims ownership', async () => {
    const olderPick =
      deferred<ReadonlyArray<{ readonly name: string; readonly text: () => Promise<string> }>>();
    const olderRead = vi.fn(async () => serializeProject(project('older picker document')));
    const setProject = vi.fn(() => ({ kind: 'loaded' as const }));
    const markLoaded = vi.fn();
    const pushToast = vi.fn();
    const context = {
      setProject,
      markLoaded,
      pushToast,
      ...projectOpenRequestEpochCallbacks(),
      getProjectDocumentEpoch: () => 0,
    };
    const olderPlatform: PlatformAdapter = {
      id: 'mock',
      pickFilesForOpen: () => olderPick.promise,
      pickFileForSave: async () => null,
      serial: { isSupported: () => false, requestPort: async () => null },
    };

    const olderPending = handleOpenProject({ ...context, platform: olderPlatform });
    await handleOpenProject({
      ...context,
      platform: platformFor('newer.lf2', async () =>
        serializeProject(project('newer picker document')),
      ),
    });
    olderPick.resolve([{ name: 'older.lf2', text: olderRead }]);
    await olderPending;

    expect(olderRead).not.toHaveBeenCalled();
    expect(setProject).toHaveBeenCalledOnce();
    expect(setProject).toHaveBeenCalledWith(
      expect.objectContaining({ notes: 'newer picker document' }),
    );
    expect(markLoaded).toHaveBeenCalledWith('newer.lf2');
    expect(pushToast).not.toHaveBeenCalledWith(
      expect.stringContaining('older.lf2'),
      expect.anything(),
    );
  });

  it('keeps the newer same-id document when the older successful read completes last', async () => {
    const olderText = deferred<string>();
    const olderStarted = deferred<undefined>();
    const older = project('older document');
    const newer = project('newer document');
    const setProject = vi.fn(() => ({ kind: 'loaded' as const }));
    const markLoaded = vi.fn();
    const pushToast = vi.fn();
    const context = {
      setProject,
      markLoaded,
      pushToast,
      ...projectOpenRequestEpochCallbacks(),
      getProjectDocumentEpoch: () => 0,
    };

    const olderPending = handleOpenProject({
      ...context,
      platform: platformFor('older.lf2', () => {
        olderStarted.resolve(undefined);
        return olderText.promise;
      }),
    });
    await olderStarted.promise;
    await handleOpenProject({
      ...context,
      platform: platformFor('newer.lf2', async () => serializeProject(newer)),
    });
    olderText.resolve(serializeProject(older));
    await olderPending;

    expect(older.scene.objects[0]?.id).toBe(newer.scene.objects[0]?.id);
    expect(setProject).toHaveBeenCalledOnce();
    expect(setProject).toHaveBeenCalledWith(expect.objectContaining({ notes: 'newer document' }));
    expect(markLoaded).toHaveBeenCalledOnce();
    expect(markLoaded).toHaveBeenCalledWith('newer.lf2');
    expect(pushToast).toHaveBeenCalledWith('Opened newer.lf2', 'success');
    expect(pushToast).not.toHaveBeenCalledWith(
      expect.stringContaining('older.lf2'),
      expect.anything(),
    );
  });

  it('keeps a late older read failure silent after the newer document opens', async () => {
    const olderText = deferred<string>();
    const olderStarted = deferred<undefined>();
    const setProject = vi.fn(() => ({ kind: 'loaded' as const }));
    const markLoaded = vi.fn();
    const pushToast = vi.fn();
    const context = {
      setProject,
      markLoaded,
      pushToast,
      ...projectOpenRequestEpochCallbacks(),
      getProjectDocumentEpoch: () => 0,
    };

    const olderPending = handleOpenProject({
      ...context,
      platform: platformFor('older-broken.lf2', () => {
        olderStarted.resolve(undefined);
        return olderText.promise;
      }),
    });
    await olderStarted.promise;
    await handleOpenProject({
      ...context,
      platform: platformFor('newer.lf2', async () => serializeProject(project('newer document'))),
    });
    olderText.reject(new Error('late read failure'));
    await olderPending;

    expect(setProject).toHaveBeenCalledOnce();
    expect(markLoaded).toHaveBeenCalledWith('newer.lf2');
    expect(pushToast).not.toHaveBeenCalledWith(
      expect.stringContaining('late read failure'),
      expect.anything(),
    );
  });

  it('keeps a New document when an earlier Open read completes afterward', async () => {
    const pendingText = deferred<string>();
    const readStarted = deferred<undefined>();
    let projectDocumentEpoch = 9;
    const setProject = vi.fn(() => ({ kind: 'loaded' as const }));
    const markLoaded = vi.fn();
    const pushToast = vi.fn();

    const pending = handleOpenProject({
      platform: platformFor('old-request.lf2', () => {
        readStarted.resolve(undefined);
        return pendingText.promise;
      }),
      setProject,
      markLoaded,
      pushToast,
      ...projectOpenRequestEpochCallbacks(),
      getProjectDocumentEpoch: () => projectDocumentEpoch,
    });
    await readStarted.promise;
    projectDocumentEpoch += 1;
    pendingText.resolve(serializeProject(project('stale opened document')));
    await pending;

    expect(setProject).not.toHaveBeenCalled();
    expect(markLoaded).not.toHaveBeenCalled();
    expect(pushToast).not.toHaveBeenCalled();
  });

  it('retains its own success feedback when committing the Open advances the epoch', async () => {
    let projectDocumentEpoch = 12;
    const markLoaded = vi.fn();
    const pushToast = vi.fn();

    await handleOpenProject({
      platform: platformFor('current.lf2', async () => serializeProject(project('current'))),
      setProject: vi.fn(() => {
        projectDocumentEpoch += 1;
        return { kind: 'loaded' as const };
      }),
      markLoaded,
      pushToast,
      ...projectOpenRequestEpochCallbacks(),
      getProjectDocumentEpoch: () => projectDocumentEpoch,
    });

    expect(markLoaded).toHaveBeenCalledWith('current.lf2');
    expect(pushToast).toHaveBeenCalledWith('Opened current.lf2', 'success');
  });

  it('silences a deferred autosave cleanup warning after a later New document', async () => {
    const cleanup = deferred<{ readonly kind: 'failed'; readonly error: Error }>();
    const clearCurrent = vi
      .spyOn(projectAutosaveService, 'clearCurrent')
      .mockReturnValue(cleanup.promise);
    let projectDocumentEpoch = 20;
    const pushToast = vi.fn();

    try {
      await handleOpenProject({
        platform: platformFor('current.lf2', async () => serializeProject(project('current'))),
        setProject: vi.fn(() => {
          projectDocumentEpoch += 1;
          return { kind: 'loaded' as const };
        }),
        markLoaded: vi.fn(),
        pushToast,
        ...projectOpenRequestEpochCallbacks(),
        getProjectDocumentEpoch: () => projectDocumentEpoch,
      });
      await vi.waitFor(() => expect(clearCurrent).toHaveBeenCalledOnce());

      projectDocumentEpoch += 1;
      cleanup.resolve({ kind: 'failed', error: new Error('storage failed') });
      await cleanup.promise;
      await Promise.resolve();

      expect(pushToast).toHaveBeenCalledWith('Opened current.lf2', 'success');
      expect(pushToast).not.toHaveBeenCalledWith(AUTOSAVE_FILE_CLEANUP_WARNING, 'warning');
    } finally {
      clearCurrent.mockRestore();
    }
  });
});
