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
const realCancelJog = useLaserStore.getState().cancelJog;

function press(key: string, init: KeyboardEventInit = {}): void {
  window.dispatchEvent(
    new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true, ...init }),
  );
}

function pressFromTarget(target: HTMLElement, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

afterEach(() => {
  patchLaserStore({
    streamer: null,
    stopJob: realStopJob,
    cancelJog: realCancelJog,
    motionOperation: null,
    connection: { kind: 'disconnected' },
  });
  useUiStore.setState({ textDialog: null });
  useUiStore.setState({ imageDialog: null, modalDepth: 0 });
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

  it('Ctrl+. cancels active frame or jog motion when no stream job is active', () => {
    const stopJob = vi.fn(async () => undefined);
    const cancelJog = vi.fn(async () => undefined);
    patchLaserStore({
      streamer: null,
      stopJob,
      cancelJog,
      motionOperation: {
        kind: 'frame',
        sawControllerBusy: false,
        idleStatusReports: 0,
        dispatchComplete: true,
        pendingLines: [],
      },
    });
    const uninstall = installJobShortcuts(window);

    press('.');

    expect(cancelJog).toHaveBeenCalledTimes(1);
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

  it('Ctrl+Enter claims the event when connected and idle', async () => {
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
    await vi.waitFor(() => expect(alert).toHaveBeenCalled());
    uninstall();
  });

  it.each([
    ['input', () => document.createElement('input')],
    ['textarea', () => document.createElement('textarea')],
    [
      'contenteditable',
      () => {
        const element = document.createElement('div');
        element.setAttribute('contenteditable', 'true');
        return element;
      },
    ],
    [
      'role textbox',
      () => {
        const element = document.createElement('div');
        element.setAttribute('role', 'textbox');
        return element;
      },
    ],
  ])('Ctrl+Enter does not start from %s targets', (_label, createTarget) => {
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    patchLaserStore({ streamer: null, connection: { kind: 'connected' } });
    const target = createTarget();
    document.body.appendChild(target);
    const uninstall = installJobShortcuts(window);

    const event = pressFromTarget(target, { key: 'Enter', ctrlKey: true });

    expect(event.defaultPrevented).toBe(false);
    expect(alert).not.toHaveBeenCalled();
    uninstall();
    target.remove();
  });
});
