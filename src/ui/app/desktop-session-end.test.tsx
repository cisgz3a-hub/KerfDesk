import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sessionEndScript } from '../../../electron/session-end-guard';
import { createStreamer, step } from '../../core/controllers/grbl';
import type { DesktopJobReport, PlatformAdapter } from '../../platform/types';
import { useLaserStore } from '../state/laser-store';
import { desktopCloseController } from './desktop-close-runtime';
import {
  desktopJobReport,
  installDesktopSessionEnd,
  JOB_PROGRESS_REPORT_MS,
  SESSION_END_MESSAGES,
  useSessionEndStore,
} from './desktop-session-end';
import { DesktopSessionEndNotice } from './DesktopSessionEndNotice';
import { PlatformProvider } from './platform-context';

const initialLaser = useLaserStore.getState();
let dispose: () => void = () => undefined;

function running(): void {
  useLaserStore.setState({ streamer: step(createStreamer('G1 X1')).state });
}

/** What main runs in the window when Windows ends the session. */
function fromMain(phase: 'asked' | 'ending'): void {
  window.eval(sessionEndScript(phase, ['shutdown']));
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
});

afterEach(() => {
  dispose();
  dispose = () => undefined;
  desktopCloseController.keepOpen();
  useLaserStore.setState(initialLaser);
  useSessionEndStore.setState({ phase: null });
  vi.unstubAllGlobals();
});

describe('the window side of a Windows session end (ADR-548)', () => {
  it('tells main each time a job starts and ends', async () => {
    const report = vi.fn(async (_report: DesktopJobReport) => undefined);
    dispose = installDesktopSessionEnd(window, report);
    expect(report).not.toHaveBeenCalled();

    running();
    useLaserStore.setState({ fireActive: false });
    useLaserStore.setState({ streamer: null });
    useLaserStore.setState({ fireActive: true });

    expect(report.mock.calls).toEqual([
      [{ busy: true, job: { progress: 0, state: 'running' } }],
      [{ busy: false }],
      [{ busy: true }],
    ]);
  });

  it('reports a job already running when it starts listening', () => {
    running();
    const report = vi.fn(async (_report: DesktopJobReport) => undefined);
    dispose = installDesktopSessionEnd(window, report);
    expect(report).toHaveBeenCalledExactlyOnceWith({
      busy: true,
      job: { progress: 0, state: 'running' },
    });
  });

  it('reports progress in whole percent at most once a second, and a hold at once (ADR-553)', () => {
    vi.useFakeTimers();
    try {
      const report = vi.fn(async (_report: DesktopJobReport) => undefined);
      dispose = installDesktopSessionEnd(window, report);
      const streamer = { ...step(createStreamer('G1 X1')).state, total: 1000 };
      const at = (completed: number, status = streamer.status): void =>
        useLaserStore.setState({ streamer: { ...streamer, completed, status } });

      at(0);
      at(4);
      at(15);
      at(19);
      expect(report).toHaveBeenCalledOnce();

      vi.advanceTimersByTime(JOB_PROGRESS_REPORT_MS);
      at(19, 'paused');
      at(19, 'paused');

      expect(report.mock.calls.map(([sent]) => sent)).toEqual([
        { busy: true, job: { progress: 0, state: 'running' } },
        { busy: true, job: { progress: 0.019, state: 'running' } },
        { busy: true, job: { progress: 0.019, state: 'paused' } },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports an errored job as stopped on an error', () => {
    const errored = { ...step(createStreamer('G1 X1\nG1 X2')).state, status: 'errored' as const };
    expect(desktopJobReport({ ...useLaserStore.getState(), streamer: errored })).toEqual({
      busy: true,
      job: { progress: 0, state: 'error' },
    });
  });

  it('only shows a notice while Windows waits, and sends Abort when it will not', () => {
    const stop = vi.fn(async () => undefined);
    useLaserStore.setState({ streamer: step(createStreamer('G1 X1')).state, stopJob: stop });
    dispose = installDesktopSessionEnd(window, async () => undefined);

    fromMain('asked');
    expect(useSessionEndStore.getState().phase).toBe('asked');
    expect(stop).not.toHaveBeenCalled();

    fromMain('ending');
    expect(useSessionEndStore.getState().phase).toBe('ending');
    // Recovery records it as the app closing, as a window close would.
    expect(stop).toHaveBeenCalledExactlyOnceWith('app-closing');
  });

  it('ignores a malformed event', () => {
    dispose = installDesktopSessionEnd(window, async () => undefined);
    window.dispatchEvent(new CustomEvent('kerfdesk:session-end', { detail: { phase: 'later' } }));
    window.dispatchEvent(new Event('kerfdesk:session-end'));
    expect(useSessionEndStore.getState().phase).toBeNull();
  });
});

describe('the session-end notice', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('says what KerfDesk did, and the operator can dismiss it', async () => {
    const reportJobActivity = vi.fn(async (_report: DesktopJobReport) => undefined);
    const platform = { reportJobActivity } as unknown as PlatformAdapter;
    await act(async () =>
      root.render(
        <PlatformProvider adapter={platform}>
          <DesktopSessionEndNotice />
        </PlatformProvider>,
      ),
    );
    await act(async () => running());
    expect(reportJobActivity).toHaveBeenCalledExactlyOnceWith({
      busy: true,
      job: { progress: 0, state: 'running' },
    });

    await act(async () => fromMain('asked'));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(SESSION_END_MESSAGES.asked);
    await act(async () => host.querySelector('button')?.click());
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it('does nothing in the web app', async () => {
    await act(async () => root.render(<DesktopSessionEndNotice />));
    await act(async () => fromMain('asked'));
    expect(useSessionEndStore.getState().phase).toBeNull();
  });
});
