import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStreamer } from '../../../core/controllers/grbl';
import { useLaserStore } from '../../state/laser-store';
import { initialLaserState } from '../../state/laser-store-helpers';
import { startMotionOperation } from '../../state/laser-motion-operation';
import { SecondPassAbortButton } from './SecondPassAbortButton';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const originalStopJob = useLaserStore.getState().stopJob;
let host: HTMLDivElement;
let root: Root;
let stop = vi.fn(async () => undefined);

beforeEach(() => {
  stop = vi.fn(async () => undefined);
  useLaserStore.setState({ ...initialLaserState(), stopJob: stop });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  useLaserStore.setState({ ...initialLaserState(), stopJob: originalStopJob });
});

describe('second-pass Abort while archiving', () => {
  it.each(['streaming', 'paused', 'done'] as const)(
    'keeps Abort available for a %s job without a Frame motion operation',
    async (status) => {
      useLaserStore.setState({ streamer: { ...createStreamer('G1 X1'), status } });
      await act(async () => root.render(<SecondPassAbortButton />));
      const button = host.querySelector('button');
      expect(button?.textContent).toBe('Abort job');
      expect(button?.disabled).toBe(false);
      await act(async () => button?.click());
      expect(stop).toHaveBeenCalledOnce();
    },
  );

  it('keeps Abort available while physical completion still needs fresh Idle reports', async () => {
    useLaserStore.setState({
      controllerOperation: { kind: 'post-job-settle', phase: 'awaiting-idle', idleReports: 0 },
    });
    await act(async () => root.render(<SecondPassAbortButton />));
    const button = host.querySelector('button');
    expect(button?.textContent).toBe('Abort job');
    await act(async () => button?.click());
    expect(stop).toHaveBeenCalledOnce();
  });

  it('retains Frame Abort and removes the button after motion ends', async () => {
    useLaserStore.setState({ motionOperation: startMotionOperation('frame') });
    await act(async () => root.render(<SecondPassAbortButton />));
    const button = host.querySelector('button');
    expect(button?.textContent).toBe('Abort motion');
    await act(async () => button?.click());
    expect(stop).toHaveBeenCalledOnce();
    await act(async () => useLaserStore.setState({ motionOperation: null }));
    expect(host.querySelector('button')).toBeNull();
  });
});
