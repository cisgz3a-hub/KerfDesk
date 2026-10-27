// Rolling audit v5 J2-P2-1 (ADR-375 Amendment 9), on the real store against the
// GRBL simulator. A Console M3, or a file that ends without M5, leaves the laser
// on at Idle, and the controller says so with `A:S`. KerfDesk offered no way
// off: no LASER OFF, Ctrl+. did nothing, and an ordinary desktop or web close
// went ahead with no stop, while the update close refused in the same state.
// The simulator does not print `A:`, so the report GRBL sends is emitted here.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rendererCloseRequestScript } from '../../../electron/renderer-close-request';
import { createGrblSimulator, type GrblSimulator } from '../../__fixtures__/controllers';
import { grblDriver } from '../../core/controllers';
import { desktopCloseController } from '../app/desktop-close-runtime';
import { installUnloadStop } from '../app/use-unload-stop';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { resetStore } from '../state/test-helpers';
import { LiveMotionBar } from './LiveMotionBar';
import { installAbortShortcut } from './use-job-shortcuts';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const LASER_ON = '<Idle|MPos:0.000,0.000,0.000|FS:0,0|Ov:100,100,100|A:S>';
const LASER_AND_AIR_ON = '<Idle|MPos:0.000,0.000,0.000|FS:0,0|Ov:100,100,100|A:SF>';

let sim: GrblSimulator;
let uninstall: Array<() => void> = [];

beforeEach(async () => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  sim = createGrblSimulator({});
  await useLaserStore.getState().connect(sim.adapter);
  await vi.advanceTimersByTimeAsync(1_100);
  expect(useLaserStore.getState().statusReport?.state).toBe('Idle');
});

afterEach(async () => {
  for (const remove of uninstall) remove();
  uninstall = [];
  desktopCloseController.keepOpen();
  await vi.advanceTimersByTimeAsync(1_000);
  vi.useRealTimers();
  await useLaserStore.getState().disconnect();
  useLaserStore.setState({
    capabilities: grblDriver.capabilities,
    activeControllerKind: grblDriver.kind,
    connection: { kind: 'disconnected' },
    statusReport: null,
    accessoryCache: null,
    safetyNotice: null,
    lastWriteError: null,
    log: [],
    transcript: [],
  });
  resetStore();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

/** A Console M3 turns the simulated laser on; the controller then reports it. */
async function leaveLaserOn(report = LASER_ON): Promise<void> {
  const sent = useLaserStore.getState().sendConsoleCommand('M3 S100');
  await vi.advanceTimersByTimeAsync(50);
  await sent;
  expect(sim.state().spindle).toBe(100);
  sim.port.emitLine(report);
  await vi.advanceTimersByTimeAsync(0);
}

function writtenSince(before: number): ReadonlyArray<string> {
  return sim
    .outbound()
    .slice(before)
    .filter((line) => line !== '?');
}

function closeRequest(operation: 'prepare' | 'prepare-update', id: number): Promise<unknown> {
  return Promise.resolve(window.eval(rendererCloseRequestScript(operation, id)) as unknown);
}

describe('a laser the controller reports on at Idle', () => {
  it('gets LASER OFF in the Live Motion bar, which sends M5 and no reset', async () => {
    await leaveLaserOn();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => root.render(<LiveMotionBar />));
    expect(host.textContent).toContain('LASER ON');
    const off = [...host.querySelectorAll('button')].find((b) => b.textContent === 'LASER OFF');
    expect(off).toBeInstanceOf(HTMLButtonElement);

    const before = sim.outbound().length;
    await act(async () => off?.click());
    await act(async () => vi.advanceTimersByTimeAsync(1_100));
    expect(writtenSince(before)).toEqual(['M5\n']);
    expect(sim.state().spindle).toBe(0);
    expect(host.textContent).not.toContain('LASER ON');
    await act(async () => root.unmount());
  });

  it('turns air off with the laser when the report shows both', async () => {
    await leaveLaserOn(LASER_AND_AIR_ON);
    uninstall.push(installAbortShortcut(window));
    const before = sim.outbound().length;
    const key = new KeyboardEvent('keydown', { key: '.', ctrlKey: true, cancelable: true });
    window.dispatchEvent(key);
    await vi.advanceTimersByTimeAsync(50);
    expect(key.defaultPrevented).toBe(true);
    expect(writtenSince(before)).toEqual(['M5 M9\n']);
  });

  it('is turned off before an ordinary desktop close', async () => {
    await leaveLaserOn();
    uninstall.push(installUnloadStop(window));
    const before = sim.outbound().length;
    const reply = closeRequest('prepare', 1);
    await vi.advanceTimersByTimeAsync(50);
    await expect(reply).resolves.toEqual({ status: 'ready', dirty: false });
    expect(writtenSince(before)).toEqual(['M5\n']);
    expect(sim.state().spindle).toBe(0);
  });

  it('still keeps an update close from going ahead', async () => {
    await leaveLaserOn();
    uninstall.push(installUnloadStop(window));
    const before = sim.outbound().length;
    const reply = closeRequest('prepare-update', 1);
    await vi.advanceTimersByTimeAsync(50);
    await expect(reply).resolves.toEqual({ status: 'cancelled' });
    expect(writtenSince(before)).toEqual([]);
  });

  it('is turned off when a web tab closes', async () => {
    await leaveLaserOn();
    uninstall.push(installUnloadStop(window));
    const before = sim.outbound().length;
    window.dispatchEvent(new Event('beforeunload', { cancelable: true }));
    // Started in the event itself: a closing page cannot wait for a later task.
    expect(writtenSince(before)).toEqual(['M5\n']);
  });

  it('says it could not turn the laser off, and retries, when M5 is refused', async () => {
    await leaveLaserOn();
    uninstall.push(installUnloadStop(window));
    const send = vi
      .spyOn(useLaserStore.getState(), 'sendConsoleCommand')
      .mockRejectedValueOnce(new Error('Serial port not writable.'));
    useLaserStore.setState({ sendConsoleCommand: send });
    const reply = closeRequest('prepare', 1);
    await vi.advanceTimersByTimeAsync(50);
    const notice = desktopCloseController.getNotice();
    expect(notice).toMatchObject({ kind: 'unconfirmed', retry: true });
    expect(notice?.message).toContain('could not turn off the laser');
    expect(notice?.message).toContain('Serial port not writable.');

    desktopCloseController.retryStop();
    await vi.advanceTimersByTimeAsync(50);
    expect(send).toHaveBeenLastCalledWith('M5');
    await expect(reply).resolves.toEqual({ status: 'ready', dirty: false });
  });

  it('is left to Stop spindle & coolant on a CNC profile', async () => {
    useStore.getState().setMachineKind('cnc');
    await leaveLaserOn();
    uninstall.push(installAbortShortcut(window));
    const before = sim.outbound().length;
    const key = new KeyboardEvent('keydown', { key: '.', ctrlKey: true, cancelable: true });
    window.dispatchEvent(key);
    await vi.advanceTimersByTimeAsync(50);
    expect(key.defaultPrevented).toBe(false);
    expect(writtenSince(before)).toEqual([]);
  });
});
