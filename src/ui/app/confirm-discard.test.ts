// Pins the LU18 confirm-discard semantics: clean passes through, an
// active job fails closed (H13), Cancel aborts, Don't Save proceeds, and
// Save proceeds ONLY when the save actually lands — a cancelled picker
// aborts the destructive action.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStreamer, step } from '../../core/controllers/grbl';
import type { PlatformAdapter, SaveTarget } from '../../platform/types';
import { useStore } from '../state';
import { useConfirmSaveStore } from '../state/confirm-save-store';
import { useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import { confirmDiscardAsync } from './confirm-discard';

function mockPlatform(save: () => Promise<SaveTarget | null>): PlatformAdapter {
  return {
    id: 'mock',
    pickFilesForOpen: async () => [],
    pickFileForSave: save,
    serial: {
      isSupported: () => false,
      requestPort: async () => null,
    },
  };
}

const neverPick = mockPlatform(async () => {
  throw new Error('picker should not open');
});

afterEach(() => {
  useConfirmSaveStore.getState().choose('cancel'); // resolve any dangling request
  useStore.getState().newProject();
  useLaserStore.setState({ streamer: null } as Partial<ReturnType<typeof useLaserStore.getState>>);
  useToastStore.setState({ toasts: [] });
  vi.restoreAllMocks();
});

describe('confirmDiscardAsync (LU18)', () => {
  it('resolves true without a dialog when the project is clean', async () => {
    useStore.setState({ dirty: false });

    await expect(confirmDiscardAsync(neverPick, 'start a new project')).resolves.toBe(true);
    expect(useConfirmSaveStore.getState().request).toBeNull();
  });

  it('fails closed with a toast while a job is active (H13)', async () => {
    useStore.setState({ dirty: true });
    useLaserStore.setState({
      streamer: step(createStreamer('G1 X1 S100')).state,
    } as Partial<ReturnType<typeof useLaserStore.getState>>);

    await expect(confirmDiscardAsync(neverPick, 'start a new project')).resolves.toBe(false);
    expect(useConfirmSaveStore.getState().request).toBeNull();
    expect(useToastStore.getState().toasts.some((t) => t.message.includes('job is running'))).toBe(
      true,
    );
  });

  it('opens a request naming the project and action; Cancel resolves false', async () => {
    useStore.setState({ dirty: true, savedName: 'badge.lf2' });

    const result = confirmDiscardAsync(neverPick, 'open another project');
    const request = useConfirmSaveStore.getState().request;
    expect(request?.projectName).toBe('badge.lf2');
    expect(request?.action).toBe('open another project');

    useConfirmSaveStore.getState().choose('cancel');
    await expect(result).resolves.toBe(false);
  });

  it("Don't Save resolves true without saving", async () => {
    useStore.setState({ dirty: true });

    const result = confirmDiscardAsync(neverPick, 'start a new project');
    useConfirmSaveStore.getState().choose('discard');

    await expect(result).resolves.toBe(true);
  });

  it('Save resolves false when the save picker is cancelled', async () => {
    useStore.setState({ dirty: true, lastSaveTarget: null });
    const platform = mockPlatform(async () => null);

    const result = confirmDiscardAsync(platform, 'start a new project');
    useConfirmSaveStore.getState().choose('save');

    await expect(result).resolves.toBe(false);
  });

  it('Save resolves true after writing to the existing save target', async () => {
    const write = vi.fn(async () => undefined);
    useStore.setState({
      dirty: true,
      lastSaveTarget: { displayName: 'badge.lf2', write },
    });

    const result = confirmDiscardAsync(neverPick, 'start a new project');
    useConfirmSaveStore.getState().choose('save');

    await expect(result).resolves.toBe(true);
    expect(write).toHaveBeenCalledTimes(1);
    // handleSaveProject ran markSaved — the project is clean again.
    expect(useStore.getState().dirty).toBe(false);
  });
});
