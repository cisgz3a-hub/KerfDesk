import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { serializeProject } from '../../io/project';
import type {
  ExternalFileOpenRequest,
  ExternalFileOpenSource,
  FileHandle,
} from '../../platform/types';
import { mockPlatform, projectWithLine, toasts } from '../../__fixtures__/file-actions';
import { useStore } from '../state';
import { clearAutosave } from '../state/autosave';
import { useConfirmSaveStore } from '../state/confirm-save-store';
import {
  handleExternalProjectOpen,
  subscribeExternalProjectOpens,
  usePendingProjectOpenStore,
  type ExternalProjectOpenDeps,
} from './external-project-open';
import { createMemoryRecentProjectStorage } from './recent-project-storage';
import { configureRecentProjectsForTests } from './recent-projects-store';

function projectFile(name: string): FileHandle {
  const text = serializeProject({ ...projectWithLine(), notes: `opened ${name}` });
  return { name, text: async () => text };
}

function fileRequest(name: string): ExternalFileOpenRequest {
  return { kind: 'file', file: projectFile(name) };
}

function deps(jobActive: () => boolean = () => false, dialogOpen: () => boolean = () => false) {
  const toast = toasts();
  const value: ExternalProjectOpenDeps = {
    platform: mockPlatform(),
    pushToast: toast.pushToast,
    jobActive,
    dialogOpen,
  };
  return { ...value, messages: toast.messages };
}

/** Answers the unsaved-changes dialog with `choice`, after running `during`. */
function answerGuard(choice: 'discard' | 'cancel', during: () => void = () => undefined) {
  return useConfirmSaveStore.subscribe((state) => {
    if (state.request === null) return;
    during();
    state.choose(choice);
  });
}

beforeEach(() => {
  configureRecentProjectsForTests(createMemoryRecentProjectStorage());
  usePendingProjectOpenStore.setState({ file: null });
  useStore.getState().newProject();
  useStore.setState({ dirty: false, projectOpenRequestEpoch: 0 });
});

afterEach(() => {
  clearAutosave();
  configureRecentProjectsForTests(null);
  usePendingProjectOpenStore.setState({ file: null });
  useConfirmSaveStore.setState({ request: null });
  useStore.getState().newProject();
  useStore.setState({ dirty: false });
});

describe('a project file handed over by the operating system', () => {
  it('opens right away when nothing would be lost', async () => {
    const context = deps();
    await handleExternalProjectOpen(fileRequest('from-explorer.lf2'), context);

    expect(useStore.getState().project.notes).toBe('opened from-explorer.lf2');
    expect(useStore.getState().savedName).toBe('from-explorer.lf2');
    expect(context.messages).toContainEqual({
      message: 'Opened from-explorer.lf2',
      variant: 'success',
    });
  });

  it('asks about unsaved changes first, and Cancel keeps the current project', async () => {
    useStore.setState({ dirty: true });
    const before = useStore.getState().project;
    const unsubscribe = answerGuard('cancel');
    await handleExternalProjectOpen(fileRequest('from-explorer.lf2'), deps());
    unsubscribe();

    expect(useStore.getState().project).toBe(before);
    expect(usePendingProjectOpenStore.getState().file).toBeNull();
  });

  it('never replaces the project during a job: the file waits for the operator', async () => {
    const before = useStore.getState().project;
    const request = fileRequest('next-job.lf2');
    await handleExternalProjectOpen(
      request,
      deps(() => true),
    );

    expect(useStore.getState().project).toBe(before);
    expect(useConfirmSaveStore.getState().request).toBeNull();
    expect(usePendingProjectOpenStore.getState().file).toBe(
      request.kind === 'file' ? request.file : null,
    );
  });

  it('does not change the project under an open dialog: the file waits', async () => {
    const before = useStore.getState().project;
    await handleExternalProjectOpen(
      fileRequest('while-reviewing.lf2'),
      deps(
        () => false,
        () => true,
      ),
    );

    expect(useStore.getState().project).toBe(before);
    expect(useConfirmSaveStore.getState().request).toBeNull();
    expect(usePendingProjectOpenStore.getState().file?.name).toBe('while-reviewing.lf2');
  });

  it('holds the file when a job starts while the unsaved-changes question is open', async () => {
    useStore.setState({ dirty: true });
    const before = useStore.getState().project;
    let running = false;
    const unsubscribe = answerGuard('discard', () => {
      running = true;
    });
    await handleExternalProjectOpen(
      fileRequest('late.lf2'),
      deps(() => running),
    );
    unsubscribe();

    expect(useStore.getState().project).toBe(before);
    expect(usePendingProjectOpenStore.getState().file?.name).toBe('late.lf2');
  });

  it('keeps only the newest file that arrived during a job', async () => {
    const context = deps(() => true);
    await handleExternalProjectOpen(fileRequest('first.lf2'), context);
    await handleExternalProjectOpen(fileRequest('second.lf2'), context);
    expect(usePendingProjectOpenStore.getState().file?.name).toBe('second.lf2');

    const taken = usePendingProjectOpenStore.getState().take();
    expect(taken?.name).toBe('second.lf2');
    expect(usePendingProjectOpenStore.getState().file).toBeNull();
  });

  it.each([
    ['missing', 'Could not open gone.lf2: the file is no longer there.'],
    ['invalid', 'Could not open gone.lf2: it is not a KerfDesk or LightBurn project file.'],
    ['unreadable', 'Could not open gone.lf2: KerfDesk could not read it.'],
  ] as const)('explains a %s file instead of opening it', async (reason, message) => {
    const context = deps();
    const before = useStore.getState().project;
    await handleExternalProjectOpen({ kind: 'unavailable', name: 'gone.lf2', reason }, context);

    expect(context.messages).toEqual([{ message, variant: 'error' }]);
    expect(useStore.getState().project).toBe(before);
  });

  it('reports a file that cannot be read when it is opened', async () => {
    const context = deps();
    const unreadable: FileHandle = {
      name: 'locked.lf2',
      text: async () => {
        throw new Error('the file is no longer there.');
      },
    };
    await handleExternalProjectOpen({ kind: 'file', file: unreadable }, context);

    expect(context.messages.some((entry) => entry.variant === 'error')).toBe(true);
    expect(useStore.getState().savedName).toBeNull();
  });

  it('opens several handed-over files one at a time, in the order they arrived', async () => {
    let emit: (request: ExternalFileOpenRequest) => void = () => undefined;
    const unsubscribe = vi.fn();
    const source: ExternalFileOpenSource = {
      subscribe: (listener) => {
        emit = listener;
        return unsubscribe;
      },
    };
    const opened: string[] = [];
    const stop = useStore.subscribe((state, previous) => {
      if (state.savedName !== previous.savedName && state.savedName !== null) {
        opened.push(state.savedName);
      }
    });
    const context = deps();
    const cleanup = subscribeExternalProjectOpens(source, context);
    emit(fileRequest('one.lf2'));
    emit(fileRequest('two.lf2'));
    await vi.waitFor(() => expect(opened).toEqual(['one.lf2', 'two.lf2']));
    stop();
    cleanup();

    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
