import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RT_SOFT_RESET } from '../../core/controllers/grbl/commands';
import {
  prepareCncPauseResumeTest,
  resetCncPauseResumeTest,
} from '../../__fixtures__/controllers/cnc-pause-resume-lifecycle';
import {
  connectAndStartCnc,
  EXPECTED_HEARTBEAT_TIMEOUT_MS,
  flushPromises,
  makeConnectionHarness,
  observeOutcome,
  pauseAtSettledDoor,
  type ConnectionHarness,
} from '../../__fixtures__/controllers/cnc-pause-resume-store';
import type { PlatformAdapter } from '../../platform/types';
import { PlatformProvider } from '../app/platform-context';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { settleTestGrblHandshake } from '../state/laser-test-start-helpers';
import { ControllerConnectionControls } from './ControllerConnectionControls';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const IDLE = '<Idle|MPos:0.000,0.000,0.000|FS:0,0|Ov:100,100,100>';
let host: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(prepareCncPauseResumeTest);
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  host = null;
  root = null;
  await resetCncPauseResumeTest();
  useLaserStore.setState(initialLaserState());
});

function fakePlatform(harness?: ConnectionHarness): PlatformAdapter {
  return {
    id: 'mock',
    pickFilesForOpen: async () => [],
    pickFileForSave: async () => null,
    serial: {
      isSupported: () => true,
      requestPort: vi.fn(async () =>
        harness === undefined ? null : { open: async () => harness.connection },
      ),
    },
  };
}

function respondToManualReads(harness: ConnectionHarness): void {
  harness.setWriteOverride(async (data) => {
    if (data === RT_SOFT_RESET) harness.connection.emitLine('Grbl 1.1f');
    if (useLaserStore.getState().controllerOperation?.kind === 'connection-handshake') return;
    if (data === '$I\n') {
      harness.connection.emitLine('[VER:1.1h.20190830:test]');
      harness.connection.emitLine('[OPT:VM,15,128]');
      harness.connection.emitLine('ok');
    }
    if (data === '$G\n') {
      harness.connection.emitLine('[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]');
      harness.connection.emitLine('ok');
    }
  });
}

async function connectedInfoFailure(harness: ConnectionHarness): Promise<PlatformAdapter> {
  respondToManualReads(harness);
  const platform = fakePlatform(harness);
  await useLaserStore.getState().connect(platform);
  harness.connection.emitLine('Grbl 1.1f');
  harness.emitStatus(IDLE);
  await settleTestGrblHandshake();
  useLaserStore.setState({
    controllerQualification: {
      kind: 'failed',
      epoch: useLaserStore.getState().controllerSessionEpoch,
      message: 'The controller settings response was empty.',
    },
    lastWriteError: null,
    log: [],
  });
  harness.writes.length = 0;
  return platform;
}

async function render(platform: PlatformAdapter, machineKind: 'laser' | 'cnc' = 'laser') {
  host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => {
    root = createRoot(host!);
    root.render(
      <PlatformProvider adapter={platform}>
        <ControllerConnectionControls
          machineKind={machineKind}
          autofocusBusy={false}
          motionOperation={null}
          controllerOperation={null}
          onForget={() => undefined}
        />
      </PlatformProvider>,
    );
  });
  return host;
}

function retryButton(container: HTMLElement): HTMLButtonElement | undefined {
  return [...container.querySelectorAll('button')].find(
    (button) => button.textContent === 'Retry reading controller settings',
  );
}

describe('ControllerConnectionControls contextual recovery', () => {
  it('reads information through the current port without reconnecting a healthy controller', async () => {
    const harness = makeConnectionHarness();
    const platform = await connectedInfoFailure(harness);
    const close = vi.spyOn(harness.connection, 'close');
    const container = await render(platform);
    expect(container.textContent).toContain('Controller information unavailable');
    expect(container.textContent).not.toContain('Reconnect controller');
    const retry = retryButton(container);
    expect(retry?.disabled).toBe(false);

    await act(async () => {
      retry?.click();
      await flushPromises();
    });

    expect(harness.writes.filter((line) => line === '$$\n')).toHaveLength(1);
    expect(harness.writes).not.toContain(RT_SOFT_RESET);
    expect(platform.serial.requestPort).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
    expect(useLaserStore.getState().connection.kind).toBe('connected');
    expect(useLaserStore.getState().controllerQualification.kind).toBe('qualified');
  });

  it('rechecks read readiness when acknowledgement debt appears before an enabled Retry click', async () => {
    const harness = makeConnectionHarness();
    const platform = await connectedInfoFailure(harness);
    const container = await render(platform);
    const retry = retryButton(container);
    expect(retry?.disabled).toBe(false);

    await act(async () => {
      useLaserStore.setState({ pendingUntrackedAcks: 1 });
      retry?.click();
      await flushPromises();
    });

    expect(retry?.disabled).toBe(true);
    expect(container.textContent).toContain('Waiting to retry:');
    expect(harness.writes).toEqual([]);
    expect(useLaserStore.getState().lastWriteError).toBeNull();
    expect(useLaserStore.getState().log).toEqual([]);
    useLaserStore.setState({ pendingUntrackedAcks: 0 });
  });

  it.each(['Sleep'])(
    'keeps a fresh %s read waiting without a reconnect suggestion or blocked-read error',
    async (controllerState) => {
      const harness = makeConnectionHarness();
      const platform = await connectedInfoFailure(harness);
      harness.emitStatus(`<${controllerState}|MPos:0.000,0.000,0.000|FS:0,0|Ov:100,100,100>`);
      const current = useLaserStore.getState();
      expect(current.pendingUntrackedAcks).toBe(0);
      expect(current.statusReport?.state).toBe(controllerState);
      // Alarm and Sleep deliberately invalidate position authority. Their
      // fresh response still proves communication over the current port.
      expect(current.statusObservation).toBeNull();
      const inboundLog = [...current.log];
      const container = await render(platform);
      const retry = retryButton(container);
      expect(retry?.disabled).toBe(true);
      expect(container.textContent).toContain(
        useLaserStore.getState().getMachineSettingsReadBlockReason(),
      );
      expect(container.textContent).not.toContain('Reconnect controller');
      await act(async () => retry?.click());
      expect(harness.writes).toEqual([]);
      expect(useLaserStore.getState().lastWriteError).toBeNull();
      expect(useLaserStore.getState().log).toEqual(inboundLog);
    },
  );

  it('reads information in exact Alarm through the connected port without unnecessary reconnect', async () => {
    const harness = makeConnectionHarness();
    const platform = await connectedInfoFailure(harness);
    harness.emitStatus('<Alarm|MPos:0.000,0.000,0.000|FS:0,0|Ov:100,100,100>');
    const close = vi.spyOn(harness.connection, 'close');
    const container = await render(platform);
    const retry = retryButton(container);
    expect(useLaserStore.getState().getMachineSettingsReadBlockReason()).toBeNull();
    expect(retry?.disabled).toBe(false);
    expect(container.textContent).not.toContain('Reconnect controller');
    await act(async () => {
      retry?.click();
      await flushPromises();
    });
    expect(harness.writes.filter((line) => line === '$$\n')).toHaveLength(1);
    expect(harness.writes).not.toContain(RT_SOFT_RESET);
    expect(close).not.toHaveBeenCalled();
    expect(platform.serial.requestPort).toHaveBeenCalledOnce();
    expect(useLaserStore.getState().lastWriteError).toBeNull();
  });

  it('preserves the connected paused CNC job after a Resume confirmation timeout', async () => {
    const harness = makeConnectionHarness();
    respondToManualReads(harness);
    await connectAndStartCnc(harness);
    await pauseAtSettledDoor(harness);
    harness.setStatusResponsesEnabled(false);
    harness.writes.length = 0;
    vi.useFakeTimers();
    const resume = observeOutcome(useLaserStore.getState().resumeJob());
    await flushPromises();
    await vi.advanceTimersByTimeAsync(EXPECTED_HEARTBEAT_TIMEOUT_MS);
    await flushPromises();
    expect(resume.result()).toBe('rejected');
    const retainedStreamer = useLaserStore.getState().streamer;
    expect(retainedStreamer?.status).toBe('paused');
    expect(useLaserStore.getState().safetyNotice?.kind).toBe('cnc-transition-unconfirmed');

    const platform = fakePlatform();
    const container = await render(platform, 'cnc');
    expect(container.textContent).toContain('retry Resume or request ABORT JOB');
    expect(container.textContent).not.toContain('Reconnect controller');
    const acknowledge = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'I made the machine safe',
    );
    await act(async () => acknowledge?.click());

    expect(useLaserStore.getState().connection.kind).toBe('connected');
    expect(useLaserStore.getState().streamer).toBe(retainedStreamer);
    expect(harness.writes).not.toContain(RT_SOFT_RESET);
    expect(platform.serial.requestPort).not.toHaveBeenCalled();
  });
});
