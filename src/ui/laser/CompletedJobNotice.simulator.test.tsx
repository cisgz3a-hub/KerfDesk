import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createGrblSimulator } from '../../__fixtures__/controllers';
import { completedJobCanBeDismissed } from '../state/completed-job-display';
import { laserCountdownTestHandoff } from '../state/laser-countdown-test-handoff';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { startTestLaserJob } from '../state/laser-test-start-helpers';
import { resetStore } from '../state/test-helpers';
import { COMPLETED_GCODE } from './CompletedJobNotice.test-support';
import { CompletedJobNotice } from './CompletedJobNotice';
import { LiveMotionBar } from './LiveMotionBar';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  resetStore();
  useLaserStore.setState(initialLaserState());
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  await useLaserStore.getState().disconnect();
  useLaserStore.setState(initialLaserState());
  resetStore();
});

it('offers Done after the real store settles a simulated job and sends no command on dismissal', async () => {
  const simulator = createGrblSimulator();
  await useLaserStore.getState().connect(simulator.adapter);
  await vi.advanceTimersByTimeAsync(1_200);
  expect(useLaserStore.getState().statusReport?.state).toBe('Idle');
  act(() =>
    root.render(
      <>
        <LiveMotionBar />
        <CompletedJobNotice />
      </>,
    ),
  );

  await act(async () => {
    await startTestLaserJob(COMPLETED_GCODE, {
      ...laserCountdownTestHandoff({
        gcode: COMPLETED_GCODE,
        retentionKey: 'completed-display-simulator',
        capability: 'realtime',
      }),
    });
  });
  expect(completedJobCanBeDismissed(useLaserStore.getState())).toBe(false);
  expect(host.textContent).not.toContain('Job complete');

  await act(async () => vi.advanceTimersByTimeAsync(5_000));
  expect(useLaserStore.getState()).toMatchObject({
    streamer: null,
    controllerOperation: null,
    liveCanvasRun: { lifecycle: 'finished', timing: { kind: 'complete' } },
  });
  expect(host.textContent).toContain('Job complete');
  const button = host.querySelector<HTMLButtonElement>('button');
  expect(button?.textContent).toBe('Done');
  const before = [...simulator.outbound()];
  act(() => button?.click());
  expect(useLaserStore.getState().liveCanvasRun).toBeNull();
  expect(simulator.outbound()).toEqual(before);
  expect(host.firstElementChild).toBeNull();
});
