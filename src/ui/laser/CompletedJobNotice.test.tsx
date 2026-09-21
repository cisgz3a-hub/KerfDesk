import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStreamer } from '../../core/controllers/grbl';
import { useStore } from '../state';
import { dismissCompletedJobDisplay } from '../state/completed-job-display';
import { startMotionOperation } from '../state/laser-motion-operation';
import { initialLaserState } from '../state/laser-store-helpers';
import { useLaserStore, type LaserState } from '../state/laser-store';
import { resetStore, svgObj } from '../state/test-helpers';
import { CompletedJobNotice } from './CompletedJobNotice';
import {
  completedRepository,
  completedRun,
  showCompletedRun,
} from './CompletedJobNotice.test-support';
import { ExecutionArchivePanel } from './ExecutionArchivePanel';
import { LiveMotionBar } from './LiveMotionBar';
import { RunAgainControl } from './RunAgainControl';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  resetStore();
  useLaserStore.setState(initialLaserState());
  const project = useStore.getState().project;
  useStore.setState({
    project: { ...project, scene: { ...project.scene, objects: [svgObj('artwork', ['#000000'])] } },
    dirty: true,
  });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  useLaserStore.setState(initialLaserState());
  resetStore();
  vi.restoreAllMocks();
});

describe('completed job acknowledgement', () => {
  it('clears only the finished display, retaining artwork, replay, archive and Frame state', async () => {
    const run = showCompletedRun();
    const repository = await completedRepository(run);
    const onRunAgain = vi.fn(async () => undefined);
    await act(async () => {
      root.render(
        <>
          <LiveMotionBar />
          <CompletedJobNotice />
          <RunAgainControl
            disabled={false}
            busy={false}
            repository={repository}
            onRunAgain={onRunAgain}
          />
          <ExecutionArchivePanel repository={repository} />
        </>,
      );
    });
    const appBefore = useStore.getState();
    const machineBefore = useLaserStore.getState();
    const archiveBefore = repository.getSnapshot();
    expect(archiveBefore.lastCompletedReceipt).not.toBeNull();
    expect(archiveBefore.executionHistory).toHaveLength(1);
    expect(host.textContent).toContain('Job complete');
    expect(host.querySelector('[aria-label="Live machine controls"]')).toBeNull();

    act(() => button('Done').click());

    expect(useLaserStore.getState()).toEqual({ ...machineBefore, liveCanvasRun: null });
    expect(useStore.getState()).toBe(appBefore);
    expect(repository.getSnapshot()).toBe(archiveBefore);
    expect((await repository.getArchivedExecution('run-completed-display')).ok).toBe(true);
    expect(host.textContent).not.toContain('Job complete');
    expect(button('Run same job again from start').disabled).toBe(false);
    expect(host.querySelector('[aria-label="Execution archive"]')?.textContent).toContain(
      'Completed',
    );
    await act(async () => button('Run same job again from start').click());
    expect(onRunAgain).toHaveBeenCalledWith(archiveBefore.lastCompletedReceipt);
  });

  it('stays dismissed after remount and offers Done for the next completed run', () => {
    showCompletedRun();
    act(() => root.render(<CompletedJobNotice />));
    act(() => button('Done').click());
    act(() => root.render(<></>));
    act(() => root.render(<CompletedJobNotice />));
    expect(host.textContent).not.toContain('Job complete');
    act(() => {
      showCompletedRun(completedRun());
    });
    expect(button('Done')).toBeInstanceOf(HTMLButtonElement);
  });

  it.each(['streaming', 'paused', 'tool-change', 'done', 'errored'] as const)(
    'retains live controls and has no Done action for a %s stream',
    (status) => {
      const run = showCompletedRun();
      useLaserStore.setState({ streamer: { ...createStreamer('M5'), status } });
      act(() =>
        root.render(
          <>
            <LiveMotionBar />
            <CompletedJobNotice />
          </>,
        ),
      );
      expect(host.textContent).not.toContain('Job complete');
      expect(host.querySelector('[aria-label="Live machine controls"]')).not.toBeNull();
      expect(dismissCompletedJobDisplay(run)).toBe(false);
      expect(useLaserStore.getState().liveCanvasRun).toBe(run);
    },
  );

  it.each(['running', 'paused', 'tool-change', 'errored', 'stopped', 'disconnected'] as const)(
    'does not dismiss a %s run even if a stale completion badge is present',
    (lifecycle) => {
      const run = showCompletedRun({ ...completedRun(), lifecycle });
      assertNotDismissible(run);
    },
  );

  it.each([
    [
      'settle marker',
      { controllerOperation: { kind: 'post-job-settle', phase: 'dwell', idleReports: 0 } },
    ],
    [
      'stable Idle wait',
      { controllerOperation: { kind: 'post-job-settle', phase: 'awaiting-idle', idleReports: 1 } },
    ],
    ['controller error', { lastError: 20 }],
    ['alarm', { alarmCode: 3 }],
    ['failed completion write', { lastWriteError: 'Settle marker failed' }],
    [
      'safety notice',
      { safetyNotice: { kind: 'controller-error', code: 20, message: 'Line rejected' } },
    ],
    ['autofocus', { autofocusBusy: true }],
    ['probe', { probeBusy: true }],
    ['fire', { fireActive: true }],
    ['jog motion', { motionOperation: startMotionOperation('jog') }],
    ['Frame motion', { motionOperation: startMotionOperation('frame') }],
    ['pause transition', { pauseResumeTransition: { token: Symbol('pause'), action: 'pause' } }],
    ['unknown status', { statusReport: null }],
  ] satisfies ReadonlyArray<readonly [string, Partial<LaserState>]>)(
    'retains status during %s',
    (_name, patch) => {
      const run = showCompletedRun();
      useLaserStore.setState(patch);
      assertNotDismissible(run);
    },
  );

  it('does not treat a finished route with an unsettled countdown as completion', () => {
    const run = showCompletedRun({ ...completedRun(), timing: { kind: 'finishing' } });
    assertNotDismissible(run);
  });

  it('rechecks run identity so a stale Done cannot dismiss a newer completed run', () => {
    const previous = showCompletedRun();
    const newer = showCompletedRun({ ...completedRun(), startedAtMs: previous.startedAtMs + 1 });
    expect(dismissCompletedJobDisplay(previous)).toBe(false);
    expect(useLaserStore.getState().liveCanvasRun).toBe(newer);
  });

  it('accepts trailing status updates to the same completed run', () => {
    const previous = showCompletedRun();
    showCompletedRun({ ...previous, reportedFeedMmPerMin: 0 });
    expect(dismissCompletedJobDisplay(previous)).toBe(true);
    expect(useLaserStore.getState().liveCanvasRun).toBeNull();
  });
});

function assertNotDismissible(run: ReturnType<typeof completedRun>): void {
  act(() => root.render(<CompletedJobNotice />));
  expect(host.firstElementChild).toBeNull();
  const before = useLaserStore.getState();
  expect(dismissCompletedJobDisplay(run)).toBe(false);
  expect(useLaserStore.getState()).toBe(before);
}

function button(label: string): HTMLButtonElement {
  const candidate = [...host.querySelectorAll('button')].find(
    (element) => element.textContent === label,
  );
  if (candidate === undefined) throw new Error(`Expected button: ${label}`);
  return candidate;
}
