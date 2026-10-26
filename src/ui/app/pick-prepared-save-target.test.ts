import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SaveTarget } from '../../platform/types';
import { lapseUserActivation } from '../../platform/web/chromium-save-picker.test-support';
import { useSaveReadyDialogStore } from '../state/save-ready-dialog-store';
import { pickPreparedSaveTarget } from './pick-prepared-save-target';

const request = { suggestedName: 'out.svg', extensions: ['.svg'] };
const ready = { title: 'Export SVG', message: 'The SVG is ready.' };
const target: SaveTarget = { displayName: 'out.svg', write: async () => undefined };

let restoreActivation: (() => void) | null = null;
afterEach(() => {
  restoreActivation?.();
  restoreActivation = null;
  useSaveReadyDialogStore.setState({ request: null });
});

describe('pickPreparedSaveTarget', () => {
  it('opens the picker at once while the click is still active', async () => {
    const pickFileForSave = vi.fn(async () => target);

    await expect(pickPreparedSaveTarget({ pickFileForSave }, request, ready)).resolves.toBe(target);

    expect(pickFileForSave).toHaveBeenCalledWith(request);
    expect(useSaveReadyDialogStore.getState().request).toBeNull();
  });

  it('asks for a fresh Choose file click once the activation has lapsed', async () => {
    restoreActivation = lapseUserActivation();
    const pickFileForSave = vi.fn(async () => target);

    const picked = pickPreparedSaveTarget({ pickFileForSave }, request, ready);
    const dialog = useSaveReadyDialogStore.getState().request;
    expect(dialog).toMatchObject({ title: 'Export SVG', phase: 'ready' });
    expect(pickFileForSave).not.toHaveBeenCalled();

    dialog?.choose();
    // The picker opens inside the Choose file click itself.
    expect(pickFileForSave).toHaveBeenCalledWith(request);
    await expect(picked).resolves.toBe(target);
    expect(useSaveReadyDialogStore.getState().request).toBeNull();
  });

  it('resolves null without a picker when the ready dialog is cancelled', async () => {
    restoreActivation = lapseUserActivation();
    const pickFileForSave = vi.fn(async () => target);

    const picked = pickPreparedSaveTarget({ pickFileForSave }, request, ready);
    useSaveReadyDialogStore.getState().request?.cancel();

    await expect(picked).resolves.toBeNull();
    expect(pickFileForSave).not.toHaveBeenCalled();
    expect(useSaveReadyDialogStore.getState().request).toBeNull();
  });

  it('closes the ready dialog when the save is aborted', async () => {
    restoreActivation = lapseUserActivation();
    const controller = new AbortController();
    const pickFileForSave = vi.fn(async () => target);

    const picked = pickPreparedSaveTarget({ pickFileForSave }, request, ready, controller.signal);
    controller.abort();

    await expect(picked).resolves.toBeNull();
    expect(pickFileForSave).not.toHaveBeenCalled();
    expect(useSaveReadyDialogStore.getState().request).toBeNull();
  });

  it('keeps the picked destination when an abort arrives while the picker is open', async () => {
    restoreActivation = lapseUserActivation();
    const controller = new AbortController();
    let answer: (picked: SaveTarget) => void = () => undefined;
    const pickFileForSave = vi.fn(
      () =>
        new Promise<SaveTarget>((resolve) => {
          answer = resolve;
        }),
    );

    const picked = pickPreparedSaveTarget({ pickFileForSave }, request, ready, controller.signal);
    useSaveReadyDialogStore.getState().request?.choose();
    controller.abort();
    answer(target);

    // The picker has already emptied the chosen file; its answer stands.
    await expect(picked).resolves.toBe(target);
  });

  it('reports a picker failure from the fresh click', async () => {
    restoreActivation = lapseUserActivation();
    const pickFileForSave = vi.fn(async () => {
      throw new Error('picker unavailable');
    });

    const picked = pickPreparedSaveTarget({ pickFileForSave }, request, ready);
    useSaveReadyDialogStore.getState().request?.choose();

    await expect(picked).rejects.toThrow('picker unavailable');
    expect(useSaveReadyDialogStore.getState().request).toBeNull();
  });
});
