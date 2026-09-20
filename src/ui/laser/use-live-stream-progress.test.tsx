import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStreamer, onAck, pause, step } from '../../core/controllers/grbl';
import { useLaserStore } from '../state/laser-store';
import { useLiveStreamProgress, type LiveStreamProgress } from './use-live-stream-progress';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let renders: LiveStreamProgress[] = [];

function Probe(): JSX.Element {
  const progress = useLiveStreamProgress();
  renders.push(progress);
  return <output>{`${progress.status ?? 'none'} ${progress.completed}/${progress.total}`}</output>;
}

async function mount(): Promise<{ host: HTMLDivElement; root: Root }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<Probe />));
  return { host, root };
}

function streaming(
  lineCount = 40,
): NonNullable<ReturnType<typeof useLaserStore.getState>['streamer']> {
  return step(createStreamer(Array.from({ length: lineCount }, (_, i) => `G1 X${i}`).join('\n')))
    .state;
}

afterEach(() => {
  renders = [];
  useLaserStore.setState({ streamer: null });
  vi.useRealTimers();
});

describe('useLiveStreamProgress (ADR-333)', () => {
  it('coalesces an acknowledgement burst into one render', async () => {
    vi.useFakeTimers();
    useLaserStore.setState({ streamer: streaming() });
    const { host, root } = await mount();
    try {
      const rendersAtStart = renders.length;
      let streamer = useLaserStore.getState().streamer;
      await act(async () => {
        for (let i = 0; i < 12; i += 1) {
          streamer = onAck(streamer as NonNullable<typeof streamer>, 'ok').state;
          useLaserStore.setState({ streamer });
        }
      });

      // Twelve acknowledgements, no render yet: the count is cosmetic.
      expect(renders.length).toBe(rendersAtStart);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });

      expect(renders.length).toBe(rendersAtStart + 1);
      // And the render shows the newest count, not the one that scheduled it.
      expect(renders.at(-1)?.completed).toBe(12);
      expect(host.textContent).toContain('12/40');
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('publishes a status change immediately', async () => {
    vi.useFakeTimers();
    useLaserStore.setState({ streamer: streaming() });
    const { host, root } = await mount();
    try {
      const rendersAtStart = renders.length;

      await act(async () => {
        useLaserStore.setState({ streamer: pause(useLaserStore.getState().streamer!) });
      });

      expect(renders.length).toBe(rendersAtStart + 1);
      expect(host.textContent).toContain('paused');
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('does not render when nothing it reads changed', async () => {
    useLaserStore.setState({ streamer: streaming() });
    const { root } = await mount();
    try {
      const rendersAtStart = renders.length;

      await act(async () => {
        // A status report replaces an unrelated slice four times a second.
        useLaserStore.setState({ statusSequence: 7 });
        useLaserStore.setState({ statusSequence: 8 });
      });

      expect(renders.length).toBe(rendersAtStart);
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('reports no stream as a null status rather than throwing', async () => {
    const { host, root } = await mount();
    try {
      expect(host.textContent).toContain('none 0/0');
    } finally {
      await act(async () => root.unmount());
    }
  });
});
