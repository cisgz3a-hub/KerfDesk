// Rolling audit v5 J2-P2-3 (ADR-546 Amendment 3), on the real App and stores.
// After a workspace render crash no safety notice showed: the link-lost and
// failed-stop notices floated over the canvas, which the crash took with it.
// The crash screen's ABORT dropped its own failure, so a refused Abort changed
// nothing on screen. And a crash-screen host that threw took the whole window
// (rolling v4 H2-P3-1). J2-P2-1: a laser left on at Idle got no ABORT there.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createStreamer, parseStatusReport, step } from '../../core/controllers/grbl';
import type { PlatformAdapter } from '../../platform/types';
import { SOFTWARE_ABORT_LABEL } from '../common/software-abort-copy';
import type * as SafetyNoticeBannerModule from '../laser/SafetyNoticeBanner';
import { useStore } from '../state';
import { disconnectDuringJobNotice } from '../state/laser-safety-notice';
import { statusPositionPatch } from '../state/laser-status-position';
import { initialLaserState } from '../state/laser-store-helpers';
import { useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import type * as WorkspaceModule from '../workspace';
import { App } from './App';
import { PlatformProvider } from './platform-context';

const leaf = vi.hoisted(() => ({ crash: false, hostCrash: false }));

// One ordinary canvas leaf stands in for any render bug in the workspace.
vi.mock('./AutosaveRecoveryCard', () => ({
  AutosaveRecoveryCard: (): null => {
    if (leaf.crash) throw new Error('canvas card render bug');
    return null;
  },
}));
// The real banner, which can be made to throw on the crash screen.
vi.mock('../laser/SafetyNoticeBanner', async (importOriginal) => {
  const real = await importOriginal<typeof SafetyNoticeBannerModule>();
  return {
    ...real,
    SafetyNoticeBanner: (props: Parameters<typeof real.SafetyNoticeBanner>[0]) => {
      if (leaf.hostCrash) throw new Error('safety notice render bug');
      return <real.SafetyNoticeBanner {...props} />;
    },
  };
});
vi.mock('./WorkspaceSidePanels', () => ({ WorkspaceSidePanels: (): null => null }));
// The canvas is not under test; jsdom has no 2D context for it.
vi.mock('../workspace', async (importOriginal) => ({
  ...(await importOriginal<typeof WorkspaceModule>()),
  Workspace: (): null => null,
}));
vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    offlineReady: [false, vi.fn()],
    needRefresh: [false, vi.fn()],
    updateServiceWorker: vi.fn(),
  }),
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const LINK_LOST = disconnectDuringJobNotice('usb');
const STOP_UNCONFIRMED = 'ABORT COULD NOT BE CONFIRMED. Use the physical E-stop.';
const realStopJob = useLaserStore.getState().stopJob;
const realSendConsoleCommand = useLaserStore.getState().sendConsoleCommand;
const platform: PlatformAdapter = {
  id: 'mock',
  pickFilesForOpen: vi.fn(async () => []),
  pickFileForSave: vi.fn(async () => null),
  serial: { isSupported: () => false, requestPort: vi.fn(async () => null) },
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  window.localStorage.clear();
  useStore.getState().newProject();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  leaf.crash = false;
  leaf.hostCrash = false;
  useLaserStore.setState({
    ...initialLaserState(),
    stopJob: realStopJob,
    sendConsoleCommand: realSendConsoleCommand,
  });
  useToastStore.setState({ toasts: [] });
  useStore.getState().newProject();
  vi.restoreAllMocks();
});

function tree(): JSX.Element {
  return (
    <PlatformProvider adapter={platform}>
      <App />
    </PlatformProvider>
  );
}

async function crashWorkspace(): Promise<void> {
  await act(async () => root.render(tree()));
  leaf.crash = true;
  await act(async () => root.render(tree()));
  expect(host.textContent).toContain('Something broke');
}

function abortButton(): HTMLButtonElement | undefined {
  return [...host.querySelectorAll('button')].find(
    (node) => node.textContent === SOFTWARE_ABORT_LABEL,
  );
}

it('shows a link-lost notice raised under the crash screen', async () => {
  useLaserStore.setState({ streamer: step(createStreamer('G1 X1 S100')).state });
  await crashWorkspace();
  expect(host.textContent).not.toContain(LINK_LOST.message);

  await act(async () => useLaserStore.setState({ safetyNotice: LINK_LOST }));
  expect(host.textContent).toContain('Connection lost mid-job');
  expect(host.textContent).toContain(LINK_LOST.message);
});

it('shows a failed ABORT, and the stop notice it leaves, on the crash screen', async () => {
  const stopJob = vi.fn(async () => {
    useLaserStore.setState({
      safetyNotice: { kind: 'disconnect-stop-unconfirmed', message: STOP_UNCONFIRMED },
    });
    throw new Error('Serial port not writable');
  });
  useLaserStore.setState({ streamer: step(createStreamer('G1 X1 S100')).state, stopJob });
  await crashWorkspace();

  await act(async () => abortButton()?.click());
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  expect(stopJob).toHaveBeenCalledOnce();
  expect(host.textContent).toContain(
    'ABORT failed: Serial port not writable. Use the physical E-stop or power cutoff now',
  );
  expect(host.textContent).toContain(STOP_UNCONFIRMED);
  // Still offered: pressing it again is the retry.
  expect(abortButton()).toBeDefined();
});

it('keeps the crash screen and its other hosts when one host throws', async () => {
  await crashWorkspace();
  leaf.hostCrash = true;
  await act(async () => useLaserStore.setState({ safetyNotice: LINK_LOST }));
  await act(async () => useToastStore.getState().pushToast('toast after the host broke', 'info'));

  expect(host.textContent).toContain('Something broke');
  expect(host.textContent).toContain('toast after the host broke');
});

it('offers ABORT for a laser left on at Idle and sends M5, not a reset', async () => {
  const stopJob = vi.fn(async () => undefined);
  const sendConsoleCommand = vi.fn(async () => undefined);
  const report = parseStatusReport('<Idle|MPos:0.000,0.000,0.000|FS:0,0|Ov:100,100,100|A:SF>');
  if (report === null) throw new Error('bad fixture');
  useLaserStore.setState({ connection: { kind: 'connected' }, stopJob, sendConsoleCommand });
  useLaserStore.setState(statusPositionPatch(useLaserStore.getState(), report));
  await crashWorkspace();

  await act(async () => abortButton()?.click());
  expect(sendConsoleCommand).toHaveBeenCalledWith('M5 M9');
  expect(stopJob).not.toHaveBeenCalled();
});
