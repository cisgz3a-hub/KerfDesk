// Controller audit MA-10: after M112, or any kill() (a failed homing move, a
// thermal fault), Marlin prints `Error:Printer halted. kill() called!`,
// disables interrupts and waits for its RESET button or a power cycle
// (MarlinCore.cpp L889-L957). The notice used to say "wait for Idle", which a
// halted board never reports.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMarlinSimulator, type MarlinSimulator } from '../../__fixtures__/controllers';
import { grblDriver } from '../../core/controllers';
import { quickStopUnconfirmedNotice } from './laser-safety-notice';
import { useLaserStore } from './laser-store';
import { startTestLaserJob } from './laser-test-start-helpers';
import { useStore } from './store';
import { resetStore } from './test-helpers';

const HALT_ADVICE = "Press the controller's reset button or power-cycle it, then reconnect.";

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
    statusReport: null,
    safetyNotice: null,
    streamer: null,
    log: [],
    transcript: [],
  });
  resetStore();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function connectMarlinIdle(motionMs = 10): Promise<MarlinSimulator> {
  const sim = createMarlinSimulator({ motionMs });
  useStore.getState().updateDeviceProfile({ controllerKind: 'marlin' });
  await useLaserStore.getState().connect(sim.adapter, { controllerKind: 'marlin' });
  await vi.advanceTimersByTimeAsync(1_200);
  expect(useLaserStore.getState().statusReport?.state).toBe('Idle');
  return sim;
}

describe('a halted Marlin', () => {
  it('after a Console M112 asks for the reset button or a power cycle, not Idle', async () => {
    const sim = await connectMarlinIdle();
    await useLaserStore
      .getState()
      .sendConsoleCommand('M112')
      .catch(() => undefined);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sim.state().isHalted).toBe(true);

    const notice = useLaserStore.getState().safetyNotice;
    expect(notice).toMatchObject({
      kind: 'controller-error',
      raw: 'Error:Printer halted. kill() called!',
    });
    expect(notice?.message).toContain(HALT_ADVICE);
    expect(notice?.message).not.toMatch(/wait for Idle/i);
  });

  it('replaces earlier advice, and no stop line is written to it mid-job', async () => {
    const sim = await connectMarlinIdle(5_000);
    await startTestLaserJob('M3 I S0\nG1 X10 F600 S100\nG1 X20\nG1 X30\nM5 I\n', {
      streamingMode: 'ping-pong',
    });
    await vi.advanceTimersByTimeAsync(20);
    useLaserStore.setState({ safetyNotice: quickStopUnconfirmedNotice() });
    const before = sim.outbound().length;

    sim.port.emitLine('Error:Printer halted. kill() called!');
    await vi.advanceTimersByTimeAsync(50);

    expect(useLaserStore.getState().safetyNotice?.message).toContain(HALT_ADVICE);
    expect(useLaserStore.getState().streamer?.status).toBe('errored');
    const stopLines = sim
      .outbound()
      .slice(before)
      .filter((write) => write !== 'M114\n');
    expect(stopLines).toEqual([]);
  });

  it('keeps the reset advice through ABORT and Disconnect', async () => {
    const sim = await connectMarlinIdle(5_000);
    await startTestLaserJob('M3 I S0\nG1 X10 F600 S100\nG1 X20\nG1 X30\nM5 I\n', {
      streamingMode: 'ping-pong',
    });
    await vi.advanceTimersByTimeAsync(20);
    sim.port.emitLine('Error:Printer halted. kill() called!');
    await vi.advanceTimersByTimeAsync(50);

    await useLaserStore.getState().stopJob();
    expect(useLaserStore.getState().safetyNotice?.message).toContain(HALT_ADVICE);
    await useLaserStore.getState().disconnect();
    expect(useLaserStore.getState().connection.kind).toBe('disconnected');
    expect(useLaserStore.getState().safetyNotice?.message).toContain(HALT_ADVICE);
  });
});
