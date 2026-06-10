import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStreamer, step } from '../../core/controllers/grbl';
import type { LaserState } from '../state/laser-store';
import { useLaserStore } from '../state/laser-store';
import { useUiStore } from '../state/ui-store';
import { installJobShortcuts } from './use-job-shortcuts';

function patchLaserStore(partial: Partial<LaserState>): void {
  useLaserStore.setState(partial as Partial<ReturnType<typeof useLaserStore.getState>>);
}

function streamingState(): LaserState['streamer'] {
  return step(createStreamer('G1 X1 S100')).state;
}

const realStopJob = useLaserStore.getState().stopJob;

function press(key: string, init: KeyboardEventInit = {}): void {
  window.dispatchEvent(
    new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true, ...init }),
  );
}

afterEach(() => {
  patchLaserStore({
    streamer: null,
    stopJob: realStopJob,
    connection: { kind: 'disconnected' },
  });
  useUiStore.setState({ textDialog: null });
  vi.restoreAllMocks();
});

describe('job shortcuts (M22: keyboard Start/Stop)', () => {
  it('Ctrl+. stops an active job', () => {
    const stopJob = vi.fn(async () => undefined);
    patchLaserStore({ streamer: streamingState(), stopJob });
    const uninstall = installJobShortcuts(window);

    press('.');

    expect(stopJob).toHaveBeenCalledTimes(1);
    uninstall();
  });

  it('Ctrl+. stops even while a modal dialog is open (panic path bypasses gates)', () => {
    const stopJob = vi.fn(async () => undefined);
    patchLaserStore({ streamer: streamingState(), stopJob });
    useUiStore.setState({
      textDialog: { mode: 'add' },
    } as Partial<ReturnType<typeof useUiStore.getState>>);
    const uninstall = installJobShortcuts(window);

    press('.');

    expect(stopJob).toHaveBeenCalledTimes(1);
    uninstall();
  });

  it('Ctrl+. does nothing when no job is active', () => {
    const stopJob = vi.fn(async () => undefined);
    patchLaserStore({ streamer: null, stopJob });
    const uninstall = installJobShortcuts(window);

    press('.');

    expect(stopJob).not.toHaveBeenCalled();
    uninstall();
  });

  it('plain "." without a modifier never stops the job', () => {
    const stopJob = vi.fn(async () => undefined);
    patchLaserStore({ streamer: streamingState(), stopJob });
    const uninstall = installJobShortcuts(window);

    press('.', { ctrlKey: false });

    expect(stopJob).not.toHaveBeenCalled();
    uninstall();
  });

  it('Ctrl+Enter does not start while disconnected or mid-job', () => {
    // startJob would be reached only through runStartJobFlow's readiness
    // checks; here the hook's own gates must refuse first.
    const stopJob = vi.fn(async () => undefined);
    patchLaserStore({ streamer: streamingState(), stopJob, connection: { kind: 'connected' } });
    const uninstall = installJobShortcuts(window);

    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    // Not prevented = the hook declined to handle it (job already active).
    expect(event.defaultPrevented).toBe(false);
    uninstall();
  });

  it('Ctrl+Enter claims the event when connected and idle', () => {
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    patchLaserStore({ streamer: null, connection: { kind: 'connected' } });
    const uninstall = installJobShortcuts(window);

    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    // The flow runs and (with an empty scene / unknown status) surfaces the
    // readiness alert — proving the shortcut reached runStartJobFlow.
    expect(event.defaultPrevented).toBe(true);
    expect(alert).toHaveBeenCalled();
    uninstall();
  });
});
