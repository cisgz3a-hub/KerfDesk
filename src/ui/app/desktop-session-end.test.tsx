import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sessionEndScript } from '../../../electron/session-end-guard';
import { createStreamer, step } from '../../core/controllers/grbl';
import type { PlatformAdapter } from '../../platform/types';
import { useLaserStore } from '../state/laser-store';
import { desktopCloseController } from './desktop-close-runtime';
import {
  installDesktopSessionEnd,
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
    const report = vi.fn(async (_busy: boolean) => undefined);
    dispose = installDesktopSessionEnd(window, report);
    expect(report).not.toHaveBeenCalled();

    running();
    useLaserStore.setState({ fireActive: false });
    useLaserStore.setState({ streamer: null });
    useLaserStore.setState({ fireActive: true });

    expect(report.mock.calls).toEqual([[true], [false], [true]]);
  });

  it('reports a job already running when it starts listening', () => {
    running();
    const report = vi.fn(async (_busy: boolean) => undefined);
    dispose = installDesktopSessionEnd(window, report);
    expect(report).toHaveBeenCalledExactlyOnceWith(true);
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
    const reportJobActivity = vi.fn(async (_busy: boolean) => undefined);
    const platform = { reportJobActivity } as unknown as PlatformAdapter;
    await act(async () =>
      root.render(
        <PlatformProvider adapter={platform}>
          <DesktopSessionEndNotice />
        </PlatformProvider>,
      ),
    );
    await act(async () => running());
    expect(reportJobActivity).toHaveBeenCalledExactlyOnceWith(true);

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
