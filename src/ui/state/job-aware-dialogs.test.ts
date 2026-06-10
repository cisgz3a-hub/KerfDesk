import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStreamer, step } from '../../core/controllers/grbl';
import type { LaserState } from './laser-store';
import { useLaserStore } from './laser-store';
import { useToastStore } from './toast-store';
import {
  JOB_ACTIVE_CONFIRM_BLOCKED,
  jobAwareAlert,
  jobAwareConfirm,
  jobAwarePrompt,
} from './job-aware-dialogs';

function patchStreamer(streamer: LaserState['streamer']): void {
  useLaserStore.setState({ streamer } as Partial<ReturnType<typeof useLaserStore.getState>>);
}

function streamingState(): LaserState['streamer'] {
  return step(createStreamer('G1 X1 S100')).state;
}

function clearToasts(): void {
  for (const toast of useToastStore.getState().toasts) {
    useToastStore.getState().dismissToast(toast.id);
  }
}

afterEach(() => {
  patchStreamer(null);
  clearToasts();
  vi.restoreAllMocks();
});

describe('job-aware dialogs (H13: no native modal while a job runs)', () => {
  it('alert degrades to a warning toast while a job is streaming', () => {
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    patchStreamer(streamingState());

    jobAwareAlert('Cannot save G-code: reasons');

    expect(alert).not.toHaveBeenCalled();
    expect(useToastStore.getState().toasts.map((t) => t.message)).toContain(
      'Cannot save G-code: reasons',
    );
  });

  it('confirm fails closed with a toast while a job is streaming', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    patchStreamer(streamingState());

    expect(jobAwareConfirm('Discard unsaved changes?')).toBe(false);

    expect(confirm).not.toHaveBeenCalled();
    expect(useToastStore.getState().toasts.map((t) => t.message)).toContain(
      JOB_ACTIVE_CONFIRM_BLOCKED,
    );
  });

  it('prompt fails closed with a toast while a job is streaming', () => {
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue('typed');
    patchStreamer(streamingState());

    expect(jobAwarePrompt('Preset name')).toBeNull();

    expect(prompt).not.toHaveBeenCalled();
  });

  it('delegates to the native dialogs when no job is active', () => {
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue('typed');
    patchStreamer(null);

    jobAwareAlert('hello');
    expect(jobAwareConfirm('sure?')).toBe(true);
    expect(jobAwarePrompt('name?')).toBe('typed');

    expect(alert).toHaveBeenCalledWith('hello');
    expect(confirm).toHaveBeenCalledWith('sure?');
    expect(prompt).toHaveBeenCalledWith('name?');
  });

  it('treats a paused job as active (beam may still be parked hot)', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const streaming = streamingState();
    patchStreamer(streaming === null ? null : { ...streaming, status: 'paused' });

    expect(jobAwareConfirm('Discard?')).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
  });
});
