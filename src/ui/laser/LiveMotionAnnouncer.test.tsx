import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cancel, createStreamer, onAck, pause, resume, step } from '../../core/controllers/grbl';
import { Dialog } from '../kit/Dialog';
import { useLaserStore } from '../state/laser-store';
import { LiveMotionBar } from './LiveMotionBar';
import {
  NOTHING_ANNOUNCED,
  nextLiveMotionAnnouncement,
  type LiveMotionAnnounced,
  type LiveMotionShown,
} from './LiveMotionAnnouncer';
import { installAbortShortcut } from './use-job-shortcuts';
import type { LiveStreamProgress } from './use-live-stream-progress';

// UX audit U7-P2-1: the bar's line count was a polite live region refreshed up
// to every 120 ms, about five announcements a second through every burn.

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const realStopJob = useLaserStore.getState().stopJob;
let root: Root | null = null;

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  root = null;
  vi.useRealTimers();
  useLaserStore.setState({
    streamer: null,
    statusReport: null,
    pauseResumeTransition: null,
    stopJob: realStopJob,
  });
  document.body.replaceChildren();
});

const running: LiveMotionShown = { heading: 'JOB RUNNING', spokenDetail: null, job: true };

function progress(
  status: LiveStreamProgress['status'],
  completed: number,
  total = 100,
): LiveStreamProgress {
  return { status, completed, total };
}

function sequence(
  steps: ReadonlyArray<readonly [LiveMotionShown | null, LiveStreamProgress]>,
): Array<string | null> {
  let announced: LiveMotionAnnounced = NOTHING_ANNOUNCED;
  return steps.map(([shown, value]) => {
    const next = nextLiveMotionAnnouncement(announced, shown, value);
    announced = next.announced;
    return next.text;
  });
}

describe('nextLiveMotionAnnouncement', () => {
  it('speaks a job start, each 10 % step once, pause, resume and the finish', () => {
    expect(
      sequence([
        [running, progress('streaming', 1)],
        [running, progress('streaming', 4)],
        [running, progress('streaming', 9)],
        [running, progress('streaming', 10)],
        [running, progress('streaming', 14)],
        [running, progress('streaming', 33)],
        [{ ...running, heading: 'JOB PAUSED' }, progress('paused', 33)],
        [running, progress('streaming', 34)],
        [{ ...running, heading: 'MACHINE FINISHING' }, progress('done', 100)],
        [null, progress(null, 0, 0)],
      ]),
    ).toEqual([
      'Job running',
      null,
      null,
      '10% done, 10 of 100 lines',
      null,
      '30% done, 33 of 100 lines',
      'Job paused',
      'Job resumed',
      'Machine finishing',
      'Job finished',
    ]);
  });

  it('says a job was aborted, and what the bar shows next', () => {
    expect(
      sequence([
        [running, progress('streaming', 20)],
        [null, progress('cancelled', 20)],
      ]),
    ).toEqual(['Job running', 'Job aborted']);
    expect(
      sequence([
        [running, progress('streaming', 20)],
        [
          { heading: 'LASER ON', spokenDetail: 'The controller reports the laser on', job: false },
          progress('cancelled', 20),
        ],
      ]),
    ).toEqual(['Job running', 'Job aborted. Laser on. The controller reports the laser on']);
  });

  it('names why a job is held, once', () => {
    const hold: LiveMotionShown = {
      heading: 'CONTROLLER HOLD',
      spokenDetail: 'Release it with cycle start on the machine',
      job: true,
    };
    expect(
      sequence([
        [running, progress('streaming', 5)],
        [hold, progress('streaming', 5)],
        [hold, progress('streaming', 25)],
      ]),
    ).toEqual(['Job running', 'Controller hold. Release it with cycle start on the machine', null]);
  });
});

function streamerFor(lines: number) {
  const program = Array.from({ length: lines }, (_, i) => `G1 X${i + 1} S100`).join('\n');
  return step(createStreamer(program)).state;
}

async function renderBar(): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => {
    root = createRoot(host);
    root.render(<LiveMotionBar />);
  });
  return host;
}

describe('LiveMotionBar announcements', () => {
  it('changes its live regions only a handful of times over a 100-line job', async () => {
    vi.useFakeTimers();
    useLaserStore.setState({ streamer: streamerFor(100) });
    const host = await renderBar();
    const live = Array.from(host.querySelectorAll('[aria-live]'));
    expect(live.map((region) => region.getAttribute('aria-live'))).toEqual(['polite', 'assertive']);
    // The bar's own text is no live region.
    expect(host.querySelector('section[aria-label="Live Motion"] [aria-live]')).toBeNull();

    const spoken: string[] = [];
    const observer = new MutationObserver(() => spoken.push(live[0]?.textContent ?? ''));
    observer.observe(live[0] as Node, { childList: true, subtree: true, characterData: true });
    // Ten seconds of acknowledgements, one every 100 ms.
    for (let line = 0; line < 100; line += 1) {
      await act(async () => {
        const streamer = useLaserStore.getState().streamer;
        if (streamer !== null)
          useLaserStore.setState({ streamer: step(onAck(streamer, 'ok').state).state });
        await vi.advanceTimersByTimeAsync(100);
      });
    }
    await act(async () => useLaserStore.setState({ streamer: null }));
    observer.disconnect();

    // Nine 10 % steps, the machine finishing and the finish: never a line count.
    expect(spoken.length).toBeLessThanOrEqual(12);
    expect(spoken.at(-1)).toBe('Job finished');
    expect(spoken.filter((text) => text.includes('% done'))).toHaveLength(9);
  });

  it('announces pause, resume and abort from the streamer', async () => {
    const streamer = streamerFor(10);
    useLaserStore.setState({ streamer });
    const host = await renderBar();
    const polite = (): string => host.querySelector('[aria-live="polite"]')?.textContent ?? '';
    expect(polite()).toBe('Job running');
    await act(async () => useLaserStore.setState({ streamer: pause(streamer) }));
    expect(polite()).toBe('Job paused');
    await act(async () => useLaserStore.setState({ streamer: resume(pause(streamer)) }));
    expect(polite()).toBe('Job resumed');
    await act(async () => useLaserStore.setState({ streamer: cancel(streamer) }));
    expect(polite()).toBe('Job aborted');
    expect(host.querySelector('section[aria-label="Live Motion"]')).toBeNull();
  });

  it('focuses Pause when a job starts with focus nowhere, and keeps it through Pausing…', async () => {
    const streamer = streamerFor(10);
    useLaserStore.setState({ streamer });
    await renderBar();
    const pauseButton = document.activeElement as HTMLButtonElement;
    expect(pauseButton.textContent).toBe('Pause');
    await act(async () =>
      useLaserStore.setState({
        pauseResumeTransition: { token: Symbol('pause'), action: 'pause' },
      }),
    );
    // The same button flips, unavailable but focusable (UX audit U7-P3-1).
    expect(document.activeElement).toBe(pauseButton);
    expect(pauseButton.textContent).toBe('Pausing…');
    expect(pauseButton.getAttribute('aria-disabled')).toBe('true');
    await act(async () =>
      useLaserStore.setState({ pauseResumeTransition: null, streamer: pause(streamer) }),
    );
    expect(document.activeElement).toBe(pauseButton);
    expect(pauseButton.textContent).toBe('Resume');
  });

  it('speaks an alarm that stops a job assertively', async () => {
    useLaserStore.setState({ streamer: streamerFor(10) });
    const host = await renderBar();
    await act(async () =>
      useLaserStore.setState({
        streamer: null,
        statusReport: { state: 'Alarm' } as NonNullable<
          ReturnType<typeof useLaserStore.getState>['statusReport']
        >,
      }),
    );
    expect(host.querySelector('[aria-live="assertive"]')?.textContent).toBe(
      'Alarm: the controller stopped the machine',
    );
  });

  it('names Ctrl+. on ABORT JOB, and Ctrl+. aborts from inside an open dialog', async () => {
    const stopJob = vi.fn(async () => undefined);
    useLaserStore.setState({ streamer: streamerFor(10), stopJob });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const uninstall = installAbortShortcut(window);
    try {
      await act(async () => {
        root = createRoot(host);
        root.render(
          <>
            <LiveMotionBar />
            <Dialog title="Keyboard Shortcuts" onClose={() => undefined}>
              <button type="button">Close</button>
            </Dialog>
          </>,
        );
      });
      const abort = Array.from(host.querySelectorAll('button')).find(
        (button) => button.textContent === 'ABORT JOB',
      );
      expect(abort?.getAttribute('aria-keyshortcuts')).toBe('Control+.');
      expect(abort?.title).toContain('Ctrl+.');
      // The dialog hides the workspace, never the bar.
      expect(abort?.closest('[aria-hidden="true"]')).toBeNull();

      const close = document.activeElement as HTMLElement;
      expect(close.textContent).toBe('Close');
      act(() => {
        close.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: '.',
            ctrlKey: true,
            bubbles: true,
            cancelable: true,
          }),
        );
      });
      expect(stopJob).toHaveBeenCalledTimes(1);
    } finally {
      uninstall();
    }
  });
});
