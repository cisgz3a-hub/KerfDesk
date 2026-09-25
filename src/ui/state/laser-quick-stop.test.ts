// Controller audit CG-10 (with MA-7): only M9 switches Marlin's air assist off
// (M7-M9.cpp L64-L75), and neither M5 I nor M107 does. Abort and Disconnect
// used to leave the pump running, and Abort showed Manual Air as OFF anyway.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMarlinSimulator, type MarlinSimulator } from '../../__fixtures__/controllers';
import { createStreamer, step } from '../../core/controllers/grbl';
import { grblDriver, marlinDriver } from '../../core/controllers';
import { noResetStopLines } from './laser-quick-stop';
import { QUICK_STOP_UNCONFIRMED_MESSAGE } from './laser-safety-notice';
import { useLaserStore } from './laser-store';
import { startTestLaserJob } from './laser-test-start-helpers';
import { useStore } from './store';
import { resetStore } from './test-helpers';

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  await useLaserStore.getState().disconnect();
  useLaserStore.setState({
    capabilities: grblDriver.capabilities,
    activeControllerKind: grblDriver.kind,
    connection: { kind: 'disconnected' },
    airAssistOn: false,
    safetyNotice: null,
    streamer: null,
  });
  resetStore();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function settle<T>(pending: Promise<T>): Promise<T> {
  let done = false;
  const tracked = pending.finally(() => {
    done = true;
  });
  for (let t = 0; t < 1_000 && !done; t += 1) await vi.advanceTimersByTimeAsync(10);
  return tracked;
}

async function connectMarlin(airOn: boolean): Promise<MarlinSimulator> {
  const sim = createMarlinSimulator({ motionMs: 500 });
  useStore.getState().updateDeviceProfile({ controllerKind: 'marlin', airAssistCommand: 'M8' });
  await useLaserStore.getState().connect(sim.adapter, { controllerKind: 'marlin' });
  await vi.advanceTimersByTimeAsync(1_200);
  expect(useLaserStore.getState().statusReport?.state).toBe('Idle');
  if (airOn) {
    await settle(useLaserStore.getState().setAirAssistEnabled(true));
    await vi.advanceTimersByTimeAsync(500);
    expect(useLaserStore.getState().airAssistOn).toBe(true);
  }
  return sim;
}

describe('the stop lines of a controller without a realtime reset', () => {
  it('adds M9 only when air assist may be on', () => {
    const idle = { airAssistOn: false, streamer: null };
    expect(noResetStopLines(marlinDriver, idle)).toEqual(['M107\n', 'M410\n', 'M5 I\n']);
    expect(noResetStopLines(marlinDriver, { ...idle, airAssistOn: true })).toEqual([
      'M107\n',
      'M410\n',
      'M5 I\n',
      'M9\n',
    ]);
    const airJob = step(createStreamer('M8\nG1 X10 F600 S100\nM9\n')).state;
    expect(noResetStopLines(marlinDriver, { ...idle, streamer: airJob }).at(-1)).toBe('M9\n');
  });
});

describe('Marlin Abort and air assist', () => {
  it('switches Manual Air off with M9 after the quickstop and clears the latch', async () => {
    const sim = await connectMarlin(true);
    const before = sim.outbound().length;
    await settle(useLaserStore.getState().stopJob());
    expect(sim.outbound().slice(before)).toEqual(['M107\n', 'M410\n', 'M5 I\n', 'M9\n']);
    expect(useLaserStore.getState().airAssistOn).toBe(false);
  });

  it("switches off the air the job's own program turned on", async () => {
    const sim = await connectMarlin(false);
    await startTestLaserJob('M8\nG1 X10 F600 S100\nG1 X20\nG1 X30\nM9\n', {
      streamingMode: 'ping-pong',
    });
    await vi.advanceTimersByTimeAsync(20);
    const before = sim.outbound().length;
    await settle(useLaserStore.getState().stopJob());
    expect(sim.outbound().slice(before)).toEqual(['M107\n', 'M410\n', 'M5 I\n', 'M9\n']);
  });

  it('sends no M9 when no air was switched on', async () => {
    const sim = await connectMarlin(false);
    const before = sim.outbound().length;
    await settle(useLaserStore.getState().stopJob());
    expect(sim.outbound().slice(before)).toEqual(['M107\n', 'M410\n', 'M5 I\n']);
  });

  it('keeps showing Manual Air on when the M9 did not go out', async () => {
    const sim = await connectMarlin(true);
    sim.port.onWrite((data) => {
      if (data === 'M9\n') throw new Error('USB write failed');
    });
    await settle(useLaserStore.getState().stopJob());
    expect(useLaserStore.getState().airAssistOn).toBe(true);
  });
});

describe('Marlin Disconnect and air assist', () => {
  it('switches Manual Air off with M9 before the port closes', async () => {
    const sim = await connectMarlin(true);
    const before = sim.outbound().length;
    await settle(useLaserStore.getState().disconnect());
    expect(sim.outbound().slice(before)).toEqual(['M5 I\n', 'M107\n', 'M9\n']);
  });

  it('quick-stops a running job before the port closes', async () => {
    const sim = await connectMarlin(false);
    await startTestLaserJob('G1 X10 F600 S100\nG1 X20\nG1 X30\n', { streamingMode: 'ping-pong' });
    await vi.advanceTimersByTimeAsync(20);
    const before = sim.outbound().length;
    await settle(useLaserStore.getState().disconnect());
    expect(sim.outbound().slice(before)).toEqual(['M107\n', 'M410\n', 'M5 I\n']);
    expect(useLaserStore.getState().safetyNotice).toEqual({
      kind: 'disconnect-stop-unconfirmed',
      message: QUICK_STOP_UNCONFIRMED_MESSAGE,
    });
  });

  // MA-7: a Disconnect used to send nothing for a jog on Marlin (no jog-cancel
  // byte), so the head finished the move after the port closed.
  it('quick-stops a jog still moving before the port closes, as ABORT MOTION does', async () => {
    const sim = await connectMarlin(false);
    const jog = useLaserStore
      .getState()
      .jog({ dx: 50, feed: 300 })
      .catch(() => undefined);
    await vi.advanceTimersByTimeAsync(100);
    expect(useLaserStore.getState().motionOperation).not.toBeNull();
    const before = sim.outbound().length;
    await settle(useLaserStore.getState().disconnect());
    await jog;
    expect(sim.outbound().slice(before)).toEqual(['M107\n', 'M410\n', 'M5 I\n']);
    expect(sim.state().pendingMotions).toBe(0);
    expect(useLaserStore.getState().safetyNotice).toEqual({
      kind: 'disconnect-stop-unconfirmed',
      message: QUICK_STOP_UNCONFIRMED_MESSAGE,
    });
  });
});
