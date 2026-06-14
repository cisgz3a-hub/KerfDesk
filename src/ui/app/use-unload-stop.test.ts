import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStreamer, step } from '../../core/controllers/grbl';
import type { LaserState } from '../state/laser-store';
import { useLaserStore } from '../state/laser-store';
import { installUnloadStop } from './use-unload-stop';

const realStopJob = useLaserStore.getState().stopJob;

// A genuine mid-stream state: createStreamer + step is the same path the
// store takes, so isActiveJob sees a real 'streaming' status.
function streamingState(): LaserState['streamer'] {
  return step(createStreamer('G1 X1 S100')).state;
}

function patchStore(partial: Partial<LaserState>): void {
  useLaserStore.setState(partial as Partial<ReturnType<typeof useLaserStore.getState>>);
}

afterEach(() => {
  patchStore({ streamer: null, stopJob: realStopJob });
});

describe('installUnloadStop (C3: laser-off on tab close mid-job)', () => {
  it('initiates stopJob on pagehide while a job is streaming', () => {
    const stopJob = vi.fn(async () => undefined);
    patchStore({ streamer: streamingState(), stopJob });
    const uninstall = installUnloadStop(window);

    window.dispatchEvent(new Event('pagehide'));

    expect(stopJob).toHaveBeenCalledTimes(1);
    uninstall();
  });

  it('initiates stopJob on beforeunload while a job is streaming', () => {
    const stopJob = vi.fn(async () => undefined);
    patchStore({ streamer: streamingState(), stopJob });
    const uninstall = installUnloadStop(window);

    window.dispatchEvent(new Event('beforeunload'));

    expect(stopJob).toHaveBeenCalledTimes(1);
    uninstall();
  });

  it('does not send a stop when no job is active', () => {
    const stopJob = vi.fn(async () => undefined);
    patchStore({ streamer: null, stopJob });
    const uninstall = installUnloadStop(window);

    window.dispatchEvent(new Event('pagehide'));
    window.dispatchEvent(new Event('beforeunload'));

    expect(stopJob).not.toHaveBeenCalled();
    uninstall();
  });

  it('initiates stopJob after all lines are acked but before Idle confirms completion', () => {
    const stopJob = vi.fn(async () => undefined);
    patchStore({ streamer: createStreamer(''), stopJob });
    const uninstall = installUnloadStop(window);

    window.dispatchEvent(new Event('pagehide'));

    expect(stopJob).toHaveBeenCalledTimes(1);
    uninstall();
  });

  it('stops listening once uninstalled', () => {
    const stopJob = vi.fn(async () => undefined);
    patchStore({ streamer: streamingState(), stopJob });
    const uninstall = installUnloadStop(window);
    uninstall();

    window.dispatchEvent(new Event('pagehide'));

    expect(stopJob).not.toHaveBeenCalled();
  });

  it('swallows a failed stop write (port already gone) without an unhandled rejection', async () => {
    const stopJob = vi.fn(async () => {
      throw new Error('no port');
    });
    patchStore({ streamer: streamingState(), stopJob });
    const uninstall = installUnloadStop(window);

    window.dispatchEvent(new Event('pagehide'));
    // Let the rejected promise settle; the handler must have caught it.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(stopJob).toHaveBeenCalledTimes(1);
    uninstall();
  });
});
