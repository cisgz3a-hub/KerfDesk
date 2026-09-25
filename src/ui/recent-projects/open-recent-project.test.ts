import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { serializeProject } from '../../io/project';
import type {
  FileHandle,
  PlatformAdapter,
  RecentFileOpenResult,
  RecentFileRef,
} from '../../platform/types';
import { mockPlatform, projectWithLine, toasts } from '../../__fixtures__/file-actions';
import { useStore } from '../state';
import { clearAutosave } from '../state/autosave';
import { useConfirmSaveStore } from '../state/confirm-save-store';
import type { RecentProjectEntry } from './recent-project-model';
import { openRecentProject } from './open-recent-project';
import { createMemoryRecentProjectStorage } from './recent-project-storage';
import { configureRecentProjectsForTests, useRecentProjectsStore } from './recent-projects-store';

const REF: RecentFileRef = {
  kind: 'desktop-path',
  path: 'C:\\Jobs\\coaster.lf2',
  token: 'e'.repeat(43),
};

const ENTRY: RecentProjectEntry = {
  id: 'coaster',
  name: 'coaster.lf2',
  ref: REF,
  pinned: false,
  lastUsedAt: 1,
};

function projectFile(name = 'coaster.lf2'): FileHandle {
  const text = serializeProject({ ...projectWithLine(), notes: `opened ${name}` });
  return { name, text: async () => text, recentRef: REF };
}

function platformOpening(
  result: RecentFileOpenResult | (() => Promise<RecentFileOpenResult>),
  picked: ReadonlyArray<FileHandle> = [],
): PlatformAdapter {
  const open = typeof result === 'function' ? result : async () => result;
  return {
    ...mockPlatform({ open: async () => picked }),
    recentFiles: {
      open: vi.fn(open),
      probe: async () => ({ kind: 'unknown' }),
      isSameFile: async () => false,
    },
  };
}

beforeEach(() => {
  configureRecentProjectsForTests(createMemoryRecentProjectStorage([ENTRY]));
  useStore.getState().newProject();
  useStore.setState({ dirty: false, projectOpenRequestEpoch: 0 });
});

afterEach(() => {
  clearAutosave();
  configureRecentProjectsForTests(null);
  useConfirmSaveStore.setState({ request: null });
  useStore.getState().newProject();
  useStore.setState({ dirty: false });
});

describe('reopening a recent project', () => {
  it('opens the remembered file and moves it to the top of the list', async () => {
    const platform = platformOpening({ kind: 'opened', file: projectFile() });
    const toast = toasts();

    await openRecentProject(platform, ENTRY, toast.pushToast);

    expect(platform.recentFiles?.open).toHaveBeenCalledWith(REF);
    expect(useStore.getState().project.notes).toBe('opened coaster.lf2');
    expect(useStore.getState().savedName).toBe('coaster.lf2');
    expect(toast.messages).toContainEqual({ message: 'Opened coaster.lf2', variant: 'success' });
    expect(useRecentProjectsStore.getState().statuses['coaster']).toBe('present');
  });

  it('reads the file before asking about unsaved changes, and keeps the project on Cancel', async () => {
    useStore.setState({ dirty: true, savedName: 'current.lf2' });
    const before = useStore.getState().project;
    const platform = platformOpening({ kind: 'opened', file: projectFile() });
    const readFile = vi.mocked(platform.recentFiles?.open ?? vi.fn());
    const openedBeforeGuard = vi.fn();
    const unsubscribe = useConfirmSaveStore.subscribe((state) => {
      if (state.request === null) return;
      openedBeforeGuard(readFile.mock.calls.length);
      state.choose('cancel');
    });

    await openRecentProject(platform, ENTRY, toasts().pushToast);
    unsubscribe();

    expect(openedBeforeGuard).toHaveBeenCalledWith(1);
    expect(useStore.getState().project).toBe(before);
    expect(useStore.getState().savedName).toBe('current.lf2');
  });

  it('keeps a missing file listed, marks it and offers to choose it again', async () => {
    const platform = platformOpening({ kind: 'missing' });
    const before = useStore.getState().project;

    await openRecentProject(platform, ENTRY, toasts().pushToast);

    const state = useRecentProjectsStore.getState();
    expect(state.statuses['coaster']).toBe('missing');
    expect(state.dialogOpen).toBe(true);
    expect(state.notice?.offerPicker).toBe(true);
    expect(state.notice?.message).toContain('coaster.lf2 is no longer in C:\\Jobs');
    expect(useStore.getState().project).toBe(before);
  });

  it('explains a refused permission and offers the file picker', async () => {
    await openRecentProject(platformOpening({ kind: 'denied' }), ENTRY, toasts().pushToast);

    const state = useRecentProjectsStore.getState();
    expect(state.dialogOpen).toBe(true);
    expect(state.notice).toEqual({
      message:
        "KerfDesk isn't allowed to read coaster.lf2. Choose the file again to give permission.",
      offerPicker: true,
    });
  });

  it('reports a read failure, including one the platform throws', async () => {
    const toast = toasts();
    await openRecentProject(
      platformOpening({ kind: 'failed', message: 'the drive is busy.' }),
      ENTRY,
      toast.pushToast,
    );
    await openRecentProject(
      platformOpening(async () => {
        throw new Error('network share offline');
      }),
      ENTRY,
      toast.pushToast,
    );

    expect(toast.messages).toEqual([
      { message: 'Could not open coaster.lf2: the drive is busy.', variant: 'error' },
      { message: 'Could not open coaster.lf2: network share offline', variant: 'error' },
    ]);
    expect(useRecentProjectsStore.getState().dialogOpen).toBe(false);
  });

  it('falls back to the file picker for an entry known only by name', async () => {
    const platform = platformOpening({ kind: 'missing' }, [projectFile('picked.lf2')]);
    const toast = toasts();

    await openRecentProject(platform, { ...ENTRY, ref: null }, toast.pushToast);

    expect(platform.recentFiles?.open).not.toHaveBeenCalled();
    expect(toast.messages[0]).toEqual({
      message:
        "coaster.lf2 can't be reopened directly in this browser. Choose it in the file picker.",
      variant: 'info',
    });
    expect(useStore.getState().savedName).toBe('picked.lf2');
  });
});
