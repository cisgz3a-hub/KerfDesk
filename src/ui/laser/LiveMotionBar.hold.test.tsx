// The controller keeps answering `?` but has stopped acknowledging the sent
// lines. The bar used to read JOB RUNNING over an idle machine (or, after ten
// seconds, a safety banner claiming a soft reset that never happened).
import { act, Profiler } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { createStreamer, pause, step } from '../../core/controllers/grbl';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { LiveMotionBar } from './LiveMotionBar';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function streamingStreamer(): NonNullable<ReturnType<typeof useLaserStore.getState>['streamer']> {
  return step(createStreamer('G1 X1 S100\nG1 X2 S100\nG1 X3 S100')).state;
}

function idleReport() {
  return {
    state: 'Idle',
    subState: null,
    mPos: { x: 0, y: 0, z: 0 },
    wPos: null,
    feed: 0,
    spindle: 0,
    wco: null,
  } as NonNullable<ReturnType<typeof useLaserStore.getState>['statusReport']>;
}

function hold() {
  return {
    since: 1_000,
    observedAt: 13_000,
    unacknowledgedLines: 3,
    unacknowledgedBytes: 42,
    controllerState: 'Idle',
  };
}

async function render(node: JSX.Element): Promise<{ host: HTMLDivElement; root: Root }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(node));
  return { host, root };
}

function buttonByText(host: HTMLElement, text: string): HTMLButtonElement | undefined {
  return [...host.querySelectorAll('button')].find((button) => button.textContent === text);
}

afterEach(() => {
  useStore.getState().newProject();
  useLaserStore.setState({
    streamer: null,
    statusReport: null,
    streamHold: null,
    pauseResumeTransition: null,
  });
  document.body.innerHTML = '';
});

describe('LiveMotionBar controller holding the program', () => {
  it('names the wait with the unacknowledged count and age', async () => {
    useLaserStore.setState({
      streamer: streamingStreamer(),
      statusReport: idleReport(),
      streamHold: hold(),
    });
    const { host, root } = await render(<LiveMotionBar />);
    try {
      expect(host.textContent).toContain('CONTROLLER HOLDING PROGRAM');
      expect(host.textContent).toContain('reports Idle');
      expect(host.textContent).toContain('last 3 sent lines for 12 s');
      expect(host.textContent).toContain('nothing was reset');
      expect(host.textContent).not.toContain('$152');
      // Progress is still shown: the operator needs to know where it stopped.
      expect(host.textContent).toContain('lines');
      expect(buttonByText(host, 'Resume')).toBeUndefined();
      expect(buttonByText(host, 'ABORT JOB')).toBeInstanceOf(HTMLButtonElement);
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('adds the standby-timer hint on a Creality Falcon profile', async () => {
    useStore.getState().updateDeviceProfile({
      ...useStore.getState().project.device,
      machineFamily: 'creality-falcon',
    });
    useLaserStore.setState({
      streamer: streamingStreamer(),
      statusReport: idleReport(),
      streamHold: hold(),
    });
    const { host, root } = await render(<LiveMotionBar />);
    try {
      expect(host.textContent).toContain('$152=100');
    } finally {
      await act(async () => root.unmount());
    }
  });

  // One shared value per hold state: a fresh object compared unequal on every
  // store write, so a held job re-rendered the bar on each status poll.
  it('does not re-render a held bar for polls that leave the hold unchanged', async () => {
    const heldReport = () => ({ ...idleReport(), state: 'Hold' as const });
    useLaserStore.setState({ streamer: streamingStreamer(), statusReport: heldReport() });
    let commits = 0;
    const { host, root } = await render(
      <Profiler id="live-motion" onRender={() => (commits += 1)}>
        <LiveMotionBar />
      </Profiler>,
    );
    try {
      commits = 0;
      for (let sequence = 1; sequence <= 5; sequence += 1) {
        await act(async () =>
          useLaserStore.setState({ statusSequence: sequence, statusReport: heldReport() }),
        );
      }
      expect(commits).toBe(0);
      expect(host.textContent).toContain('CONTROLLER HOLD');
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('lets a controller feed hold and a host pause keep their own headings', async () => {
    useLaserStore.setState({
      streamer: streamingStreamer(),
      statusReport: { ...idleReport(), state: 'Hold' },
      streamHold: hold(),
    });
    const held = await render(<LiveMotionBar />);
    try {
      expect(held.host.textContent).toContain('CONTROLLER HOLD');
      expect(held.host.textContent).not.toContain('HOLDING PROGRAM');
    } finally {
      await act(async () => held.root.unmount());
    }
    useLaserStore.setState({
      streamer: pause(streamingStreamer()),
      statusReport: idleReport(),
      streamHold: hold(),
    });
    const paused = await render(<LiveMotionBar />);
    try {
      expect(paused.host.textContent).toContain('JOB PAUSED');
      expect(paused.host.textContent).not.toContain('HOLDING PROGRAM');
    } finally {
      await act(async () => paused.root.unmount());
    }
  });
});
