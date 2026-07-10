import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { useLaserStore } from '../state/laser-store';
import { JobControls } from './JobControls';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  useLaserStore.setState({
    streamer: null,
    statusReport: null,
  } as Partial<ReturnType<typeof useLaserStore.getState>>);
});

describe('JobControls progress display', () => {
  it('shows acknowledged jobs as machine-finishing instead of complete', async () => {
    useLaserStore.setState({
      statusReport: {
        state: 'Run',
        subState: null,
        mPos: { x: 120, y: 20, z: 0 },
        wPos: null,
        wco: null,
        feed: 600,
        spindle: 255,
      },
      streamer: {
        status: 'done',
        streamingMode: 'char-counted',
        queued: [],
        inFlight: [],
        inFlightBytes: 0,
        completed: 5,
        total: 5,
        rxBufferBytes: 120,
        toolChangePause: false,
      },
    });
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    try {
      await act(async () => {
        root = createRoot(host);
        root.render(<JobControls disabled={false} onStartJob={() => undefined} />);
      });

      expect(host.textContent).toContain('Machine finishing');
      const fill = host.querySelector<HTMLElement>('[data-testid="job-progress-fill"]');
      expect(fill?.style.width).toBe('99%');
    } finally {
      if (root !== null) {
        await act(async () => root?.unmount());
      }
      host.remove();
    }
  });
});
