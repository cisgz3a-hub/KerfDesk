import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileHandle } from '../../platform/types';
import {
  CHROMIUM_ACTIVATION_LIFESPAN_MS,
  installTransientActivation,
  lapseUserActivation,
} from '../../platform/web/chromium-save-picker.test-support';
import { useStore } from '../state';
import { useSaveReadyDialogStore } from '../state/save-ready-dialog-store';
import { resetStore } from '../state/test-helpers';
import { pickFilesToOpen } from './pick-files-to-open';

const openRequest = { accept: ['.lf2'], multiple: false };
const file: FileHandle = { name: 'next.lf2', text: async () => '{}' };
const wait = { title: 'Open project', choice: 'the project to open', stillWanted: () => true };

let restoreActivation: (() => void) | null = null;
beforeEach(() => resetStore());
afterEach(() => {
  restoreActivation?.();
  restoreActivation = null;
  useSaveReadyDialogStore.setState({ request: null });
  vi.useRealTimers();
});

const dialog = () => useSaveReadyDialogStore.getState().request;

describe('pickFilesToOpen', () => {
  it('opens the picker at once, with no dialog, while the click is still active', async () => {
    const pickFilesForOpen = vi.fn(async () => [file]);

    await expect(pickFilesToOpen({ pickFilesForOpen }, openRequest, wait)).resolves.toEqual([file]);

    expect(pickFilesForOpen).toHaveBeenCalledWith(openRequest);
    expect(dialog()).toBeNull();
  });

  it('keeps the click for 4,999 ms and asks for a fresh one at 5,000 ms', async () => {
    vi.useFakeTimers();
    const activation = installTransientActivation();
    restoreActivation = activation.restore;
    const pickFilesForOpen = vi.fn(async () => [file]);

    vi.advanceTimersByTime(CHROMIUM_ACTIVATION_LIFESPAN_MS - 1);
    await pickFilesToOpen({ pickFilesForOpen }, openRequest, wait);
    expect(pickFilesForOpen).toHaveBeenCalledOnce();
    expect(dialog()).toBeNull();

    vi.advanceTimersByTime(1);
    const picked = pickFilesToOpen({ pickFilesForOpen }, openRequest, wait);
    expect(pickFilesForOpen).toHaveBeenCalledOnce();
    expect(dialog()).toMatchObject({ title: 'Open project', phase: 'ready', picks: 'open' });

    activation.gesture();
    dialog()?.choose();
    await expect(picked).resolves.toEqual([file]);
    expect(pickFilesForOpen).toHaveBeenCalledTimes(2);
  });

  it('says the project is saved and opens the picker inside the Choose file click', async () => {
    restoreActivation = lapseUserActivation();
    useStore.setState({ dirty: false, savedName: 'coaster.lf2' });
    const pickFilesForOpen = vi.fn(async () => [file]);

    const picked = pickFilesToOpen({ pickFilesForOpen }, openRequest, wait);

    expect(dialog()).toMatchObject({
      title: 'Open project',
      message: 'coaster.lf2 is saved. Choose the project to open.',
      phase: 'ready',
    });
    expect(pickFilesForOpen).not.toHaveBeenCalled();
    dialog()?.choose();
    // Synchronously: the picker must open inside the click itself.
    expect(pickFilesForOpen).toHaveBeenCalledWith(openRequest);
    expect(dialog()).toMatchObject({ phase: 'choosing' });
    await expect(picked).resolves.toEqual([file]);
    expect(dialog()).toBeNull();
  });

  it('does not call discarded or unnamed work saved', async () => {
    restoreActivation = lapseUserActivation();
    useStore.setState({ dirty: true, savedName: 'coaster.lf2' });
    const pickFilesForOpen = vi.fn(async () => [file]);

    const discarded = pickFilesToOpen({ pickFilesForOpen }, openRequest, wait);
    expect(dialog()?.message).toBe('Choose the project to open.');
    dialog()?.cancel();
    await discarded;

    useStore.setState({ dirty: false, savedName: null });
    const unnamed = pickFilesToOpen({ pickFilesForOpen }, openRequest, wait);
    expect(dialog()?.message).toBe('Choose the project to open.');
    dialog()?.cancel();
    await unnamed;
  });

  it('Cancel opens no picker and resolves no files', async () => {
    restoreActivation = lapseUserActivation();
    const pickFilesForOpen = vi.fn(async () => [file]);

    const picked = pickFilesToOpen({ pickFilesForOpen }, openRequest, wait);
    dialog()?.cancel();

    await expect(picked).resolves.toEqual([]);
    expect(pickFilesForOpen).not.toHaveBeenCalled();
    expect(dialog()).toBeNull();
  });

  it('asks again at the fresh click, and opens no picker for an Open no longer wanted', async () => {
    restoreActivation = lapseUserActivation();
    let wanted = true;
    const stillWanted = vi.fn(() => wanted);
    const pickFilesForOpen = vi.fn(async () => [file]);

    const picked = pickFilesToOpen({ pickFilesForOpen }, openRequest, { ...wait, stillWanted });
    const waiting = dialog();
    wanted = false;
    waiting?.choose();

    await expect(picked).resolves.toEqual([]);
    expect(pickFilesForOpen).not.toHaveBeenCalled();
    expect(dialog()).toBeNull();
  });

  it('closes by itself when the document is taken while it waits', async () => {
    restoreActivation = lapseUserActivation();
    const epoch = useStore.getState().projectDocumentEpoch;
    const stillWanted = (): boolean => useStore.getState().projectDocumentEpoch === epoch;
    const pickFilesForOpen = vi.fn(async () => [file]);

    const picked = pickFilesToOpen({ pickFilesForOpen }, openRequest, { ...wait, stillWanted });
    expect(dialog()).not.toBeNull();
    useStore.getState().newProject();

    await expect(picked).resolves.toEqual([]);
    expect(pickFilesForOpen).not.toHaveBeenCalled();
    expect(dialog()).toBeNull();
  });

  it('shows no dialog for an Open that is already unwanted', async () => {
    restoreActivation = lapseUserActivation();
    const pickFilesForOpen = vi.fn(async () => [file]);

    await expect(
      pickFilesToOpen({ pickFilesForOpen }, openRequest, { ...wait, stillWanted: () => false }),
    ).resolves.toEqual([]);

    expect(pickFilesForOpen).not.toHaveBeenCalled();
    expect(dialog()).toBeNull();
  });

  it('lets a browser with no file pickers fail at once, with no dialog', async () => {
    restoreActivation = lapseUserActivation();
    const pickFilesForOpen = vi.fn(async () => {
      throw new Error("This browser can't open files.");
    });

    await expect(
      pickFilesToOpen({ pickFilesForOpen, filePickersAvailable: () => false }, openRequest, wait),
    ).rejects.toThrow("This browser can't open files.");

    expect(dialog()).toBeNull();
  });

  it('reports a picker failure from the fresh click', async () => {
    restoreActivation = lapseUserActivation();
    const pickFilesForOpen = vi.fn(async () => {
      throw new Error('picker unavailable');
    });

    const picked = pickFilesToOpen({ pickFilesForOpen }, openRequest, wait);
    dialog()?.choose();

    await expect(picked).rejects.toThrow('picker unavailable');
    expect(dialog()).toBeNull();
  });
});
