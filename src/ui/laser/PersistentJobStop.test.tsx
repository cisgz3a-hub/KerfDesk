import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStreamer, step } from '../../core/controllers/grbl';
import { useLaserStore } from '../state/laser-store';
import { PersistentJobStop } from './PersistentJobStop';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const realStopJob = useLaserStore.getState().stopJob;

async function renderStop(): Promise<{ host: HTMLDivElement; root: Root }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<PersistentJobStop />));
  return { host, root };
}

afterEach(() => {
  useLaserStore.setState({ streamer: null, stopJob: realStopJob });
  document.body.innerHTML = '';
});

describe('PersistentJobStop', () => {
  it('keeps a visible stop action mounted while a job is active', async () => {
    const stopJob = vi.fn(async () => undefined);
    useLaserStore.setState({
      streamer: step(createStreamer('G1 X1 S100')).state,
      stopJob,
    });
    const { host, root } = await renderStop();
    try {
      const button = host.querySelector('button');
      expect(button?.textContent).toBe('Stop job');
      expect(button?.style.position).toBe('fixed');
      await act(async () => button?.click());
      expect(stopJob).toHaveBeenCalledOnce();
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('does not occupy the workspace when no job is active', async () => {
    useLaserStore.setState({ streamer: null });
    const { host, root } = await renderStop();
    try {
      expect(host.querySelector('button')).toBeNull();
    } finally {
      await act(async () => root.unmount());
    }
  });
});
