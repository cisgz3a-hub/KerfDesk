// Open and Open template over unsaved work with no file yet (annoyance audit
// A4-P3-2, ADR-656 Amendment 5). Save opens the save picker; the open picker
// that follows runs on the click that answered Save changes?, which a save
// picker left open for more than 5 s outlasts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { projectWithLine } from '../../__fixtures__/file-actions';
import { serializeProject } from '../../io/project';
import { serializeProjectTemplate } from '../../io/project/project-template';
import type { PlatformAdapter } from '../../platform/types';
import {
  installTransientActivation,
  lapseUserActivation,
} from '../../platform/web/chromium-save-picker.test-support';
import { useStore } from '../state';
import { projectAutosaveService } from '../state/autosave-durable';
import { useConfirmSaveStore } from '../state/confirm-save-store';
import { PROJECT_NOTICES_TOAST_KEY } from '../state/project-load-notices';
import { useSaveReadyDialogStore } from '../state/save-ready-dialog-store';
import { resetStore } from '../state/test-helpers';
import { openProjectCommand } from './open-project-command';
import { openTemplateCommand } from './template-command-actions';

let restoreActivation: (() => void) | null = null;

beforeEach(() => {
  resetStore();
  vi.spyOn(projectAutosaveService, 'clearCurrent').mockResolvedValue({ kind: 'ok' });
  useStore.getState().setProject({ ...projectWithLine(), notes: 'Unsaved work' });
  useStore.setState({ dirty: true, savedName: null, lastSaveTarget: null });
});
afterEach(() => {
  useConfirmSaveStore.getState().choose('cancel');
  useSaveReadyDialogStore.setState({ request: null });
  restoreActivation?.();
  restoreActivation = null;
  vi.restoreAllMocks();
});

const dialog = () => useSaveReadyDialogStore.getState().request;

/** A platform whose save picker stays open past the click when `slowSave`. */
function platformWith(file: { readonly name: string; readonly text: string }, slowSave: boolean) {
  const write = vi.fn(async (_contents: string | Blob) => undefined);
  const pickFilesForOpen = vi.fn(async () => [{ name: file.name, text: async () => file.text }]);
  const pickFileForSave = vi.fn(async () => {
    if (slowSave) restoreActivation = lapseUserActivation();
    return { displayName: 'work.lf2', write };
  });
  const platform: PlatformAdapter = {
    id: 'mock',
    pickFilesForOpen,
    pickFileForSave,
    serial: { isSupported: () => false, requestPort: async () => null },
  };
  return { platform, pickFilesForOpen, pickFileForSave, write };
}

async function answerSave(): Promise<void> {
  await vi.waitFor(() => expect(useConfirmSaveStore.getState().request).not.toBeNull());
  useConfirmSaveStore.getState().choose('save');
}

const nextProject = (): { readonly name: string; readonly text: string } => ({
  name: 'next.lf2',
  text: serializeProject({ ...projectWithLine(), notes: 'The next project' }),
});
const template = (): { readonly name: string; readonly text: string } => ({
  name: 'badge.lf2template',
  text: serializeProjectTemplate({ ...projectWithLine(), notes: 'From the template' }),
});

describe('Open over unsaved work with no file', () => {
  it('goes straight to the open picker when Save was quick', async () => {
    restoreActivation = installTransientActivation().restore;
    const { platform, pickFilesForOpen, write } = platformWith(nextProject(), false);
    const pushToast = vi.fn();

    const opening = openProjectCommand(platform, pushToast);
    await answerSave();
    await opening;

    expect(write).toHaveBeenCalledOnce();
    expect(pickFilesForOpen).toHaveBeenCalledOnce();
    expect(dialog()).toBeNull();
    expect(useStore.getState()).toMatchObject({ savedName: 'next.lf2', dirty: false });
    expect(useStore.getState().project.notes).toBe('The next project');
  });

  it('asks for a fresh click when the save picker outlasted the Save click', async () => {
    const { platform, pickFilesForOpen, write } = platformWith(nextProject(), true);
    const pushToast = vi.fn();

    const opening = openProjectCommand(platform, pushToast);
    await answerSave();
    await vi.waitFor(() => expect(dialog()).not.toBeNull());

    expect(dialog()).toMatchObject({
      title: 'Open project',
      message: 'work.lf2 is saved. Choose the project to open.',
      picks: 'open',
      phase: 'ready',
    });
    expect(write).toHaveBeenCalledOnce();
    // No picker without a click, and nothing reported as an error.
    expect(pickFilesForOpen).not.toHaveBeenCalled();
    expect(pushToast).not.toHaveBeenCalledWith(expect.anything(), 'error');

    dialog()?.choose();
    // The picker opens inside the Choose file click itself.
    expect(pickFilesForOpen).toHaveBeenCalledOnce();
    await opening;

    expect(dialog()).toBeNull();
    expect(useStore.getState()).toMatchObject({ savedName: 'next.lf2', dirty: false });
    expect(useStore.getState().project.notes).toBe('The next project');
    expect(pushToast).toHaveBeenCalledWith('Opened next.lf2', 'success', {
      key: PROJECT_NOTICES_TOAST_KEY,
    });
  });

  it('Cancel leaves the saved project open and untouched', async () => {
    const { platform, pickFilesForOpen } = platformWith(nextProject(), true);
    const pushToast = vi.fn();

    const opening = openProjectCommand(platform, pushToast);
    await answerSave();
    await vi.waitFor(() => expect(dialog()).not.toBeNull());
    const saved = useStore.getState().project;
    const epoch = useStore.getState().projectDocumentEpoch;
    dialog()?.cancel();
    await opening;

    expect(pickFilesForOpen).not.toHaveBeenCalled();
    expect(dialog()).toBeNull();
    expect(useStore.getState().project).toBe(saved);
    expect(useStore.getState()).toMatchObject({
      savedName: 'work.lf2',
      dirty: false,
      projectDocumentEpoch: epoch,
    });
    expect(pushToast).not.toHaveBeenCalledWith(expect.anything(), 'error');
  });

  it('closes the dialog without a picker when a newer Open takes the request', async () => {
    const { platform, pickFilesForOpen } = platformWith(nextProject(), true);

    const opening = openProjectCommand(platform, vi.fn());
    await answerSave();
    await vi.waitFor(() => expect(dialog()).not.toBeNull());
    useStore.getState().claimProjectOpenRequest();
    await opening;

    expect(dialog()).toBeNull();
    expect(pickFilesForOpen).not.toHaveBeenCalled();
    expect(useStore.getState().savedName).toBe('work.lf2');
  });

  it('closes the dialog without a picker when the document is replaced', async () => {
    const { platform, pickFilesForOpen } = platformWith(nextProject(), true);

    const opening = openProjectCommand(platform, vi.fn());
    await answerSave();
    await vi.waitFor(() => expect(dialog()).not.toBeNull());
    useStore.getState().newProject();
    const replacement = useStore.getState().project;
    await opening;

    expect(dialog()).toBeNull();
    expect(pickFilesForOpen).not.toHaveBeenCalled();
    expect(useStore.getState().project).toBe(replacement);
  });

  it('drops a file picked after the document was replaced under the open picker', async () => {
    const { platform, pickFilesForOpen } = platformWith(nextProject(), true);
    let answer: () => void = () => undefined;
    pickFilesForOpen.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = () => resolve([{ name: 'next.lf2', text: async () => nextProject().text }]);
        }),
    );

    const opening = openProjectCommand(platform, vi.fn());
    await answerSave();
    await vi.waitFor(() => expect(dialog()).not.toBeNull());
    dialog()?.choose();
    useStore.getState().newProject();
    const replacement = useStore.getState().project;
    answer();
    await opening;

    expect(useStore.getState().project).toBe(replacement);
    expect(dialog()).toBeNull();
  });

  it('skips the dialog for a file already chosen, such as a recent project', async () => {
    const { platform, pickFilesForOpen } = platformWith(nextProject(), true);

    const opening = openProjectCommand(platform, vi.fn(), {
      file: { name: 'recent.lf2', text: async () => nextProject().text },
    });
    await answerSave();
    await opening;

    expect(dialog()).toBeNull();
    expect(pickFilesForOpen).not.toHaveBeenCalled();
    expect(useStore.getState().savedName).toBe('recent.lf2');
  });
});

describe('Open template over unsaved work with no file', () => {
  it('goes straight to the open picker when Save was quick', async () => {
    restoreActivation = installTransientActivation().restore;
    const { platform, pickFilesForOpen } = platformWith(template(), false);

    const opening = openTemplateCommand(platform, vi.fn());
    await answerSave();
    await opening;

    expect(pickFilesForOpen).toHaveBeenCalledOnce();
    expect(dialog()).toBeNull();
    expect(useStore.getState()).toMatchObject({ savedName: 'badge.lf2', dirty: true });
  });

  it('asks for a fresh click when the save picker outlasted the Save click', async () => {
    const { platform, pickFilesForOpen } = platformWith(template(), true);
    const pushToast = vi.fn();

    const opening = openTemplateCommand(platform, pushToast);
    await answerSave();
    await vi.waitFor(() => expect(dialog()).not.toBeNull());

    expect(dialog()).toMatchObject({
      title: 'Open template',
      message: 'work.lf2 is saved. Choose the template to open.',
      picks: 'open',
    });
    expect(pickFilesForOpen).not.toHaveBeenCalled();

    dialog()?.choose();
    expect(pickFilesForOpen).toHaveBeenCalledOnce();
    await opening;

    expect(useStore.getState()).toMatchObject({ savedName: 'badge.lf2', dirty: true });
    expect(useStore.getState().project.notes).toBe('From the template');
    expect(pushToast).not.toHaveBeenCalledWith(expect.anything(), 'error');
  });

  it('Cancel leaves the saved project open and untouched', async () => {
    const { platform, pickFilesForOpen } = platformWith(template(), true);
    const pushToast = vi.fn();

    const opening = openTemplateCommand(platform, pushToast);
    await answerSave();
    await vi.waitFor(() => expect(dialog()).not.toBeNull());
    const saved = useStore.getState().project;
    dialog()?.cancel();
    await opening;

    expect(pickFilesForOpen).not.toHaveBeenCalled();
    expect(useStore.getState().project).toBe(saved);
    expect(useStore.getState()).toMatchObject({ savedName: 'work.lf2', dirty: false });
    expect(pushToast).not.toHaveBeenCalledWith(expect.anything(), 'error');
  });
});
