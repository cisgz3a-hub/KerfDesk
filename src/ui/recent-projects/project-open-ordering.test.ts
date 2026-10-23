import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mockPlatform, projectWithLine } from '../../__fixtures__/file-actions';
import { serializeProject } from '../../io/project';
import type { FileHandle, RecentFileOpenResult } from '../../platform/types';
import { openProjectCommand } from '../commands/open-project-command';
import { openTemplateCommand } from '../commands/template-command-actions';
import { useStore } from '../state';
import { useConfirmSaveStore } from '../state/confirm-save-store';
import { projectAutosaveService } from '../state/autosave-durable';
import { resetStore } from '../state/test-helpers';
import { handleExternalProjectOpen, usePendingProjectOpenStore } from './external-project-open';
import { openRecentProject } from './open-recent-project';
import { createMemoryRecentProjectStorage } from './recent-project-storage';
import { configureRecentProjectsForTests, useRecentProjectsStore } from './recent-projects-store';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const file = (name: string): FileHandle => ({
  name: `${name}.lf2`,
  text: async () => serializeProject({ ...projectWithLine(), notes: name }),
});
const entry = {
  id: 'older',
  name: 'older.lf2',
  pinned: false,
  lastUsedAt: 1,
  ref: { kind: 'desktop-path' as const, path: 'C:/older.lf2', token: 'a'.repeat(43) },
};

beforeEach(() => {
  resetStore();
  configureRecentProjectsForTests(createMemoryRecentProjectStorage([entry]));
  usePendingProjectOpenStore.setState({ file: null });
  vi.spyOn(projectAutosaveService, 'clearCurrent').mockResolvedValue({ kind: 'ok' });
});
afterEach(() => {
  useConfirmSaveStore.getState().choose('cancel');
  configureRecentProjectsForTests(null);
  vi.restoreAllMocks();
});

it.each(['opened', 'missing', 'denied'] as const)(
  'retires a late Recent %s result after a newer Open',
  async (kind) => {
    const read = deferred<RecentFileOpenResult>();
    const pushToast = vi.fn();
    const platform = {
      ...mockPlatform(),
      recentFiles: {
        open: () => read.promise,
        probe: async () => ({ kind: 'unknown' as const }),
        isSameFile: async () => false,
      },
    };
    const pending = openRecentProject(platform, entry, pushToast);
    await openProjectCommand(mockPlatform(), pushToast, { file: file('newer') });
    read.resolve(kind === 'opened' ? { kind, file: file('older') } : { kind });
    await pending;
    expect(useStore.getState().project.notes).toBe('newer');
    expect(useRecentProjectsStore.getState().dialogOpen).toBe(false);
  },
);

it('holds an external file if a modal opens while its read waits', async () => {
  const read = deferred<string>();
  const started = deferred<undefined>();
  const before = useStore.getState().project;
  let modal = false;
  const external = {
    name: 'external.lf2',
    text: () => {
      started.resolve(undefined);
      return read.promise;
    },
  };
  const pending = handleExternalProjectOpen(
    { kind: 'file', file: external },
    {
      platform: mockPlatform(),
      pushToast: vi.fn(),
      jobActive: () => false,
      dialogOpen: () => modal,
    },
  );
  await started.promise;
  modal = true;
  read.resolve(serializeProject({ ...projectWithLine(), notes: 'external' }));
  await pending;
  expect(useStore.getState().project).toBe(before);
  expect(usePendingProjectOpenStore.getState().file).toBe(external);
});

it('claims a template request before its Save guard so a newer cancelled Open retires it', async () => {
  const write = deferred<undefined>();
  const writing = deferred<undefined>();
  const pickFilesForOpen = vi.fn(async () => []);
  const platform = { ...mockPlatform(), pickFilesForOpen };
  useStore.setState({
    dirty: true,
    savedName: 'current.lf2',
    lastSaveTarget: {
      displayName: 'current.lf2',
      write: async () => {
        writing.resolve(undefined);
        await write.promise;
      },
    },
  });
  const template = openTemplateCommand(platform, vi.fn());
  await vi.waitFor(() => expect(useConfirmSaveStore.getState().request).not.toBeNull());
  useConfirmSaveStore.getState().choose('save');
  await writing.promise;
  const newer = openProjectCommand(platform, vi.fn());
  await vi.waitFor(() => expect(useConfirmSaveStore.getState().request).not.toBeNull());
  useConfirmSaveStore.getState().choose('cancel');
  await newer;
  write.resolve(undefined);
  await template;
  expect(pickFilesForOpen).not.toHaveBeenCalled();
});
