// Controller audit MA-12: Marlin answers a command its build lacks with
// `echo:Unknown command: "M8"` and then an ordinary `ok` (gcode.cpp L489-L505,
// L1101-L1122; parser.cpp L390-L392). KerfDesk took the echo for a message and
// the `ok` for success, so a job ran on without air assist (or dark). The echo
// belongs to the oldest line still owed an answer, because Marlin runs lines in
// order.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMarlinSimulator, type MarlinSimulator } from '../../__fixtures__/controllers';
import { createStreamer, step } from '../../core/controllers/grbl';
import { grblDriver, marlinDriver } from '../../core/controllers';
import { ControllerCommandRefusedError, startControllerCommand } from './laser-interactive-command';
import { handleLine } from './laser-line-handler';
import { makeLineHandlerHarness } from './laser-line-handler.test-support';
import { useLaserStore } from './laser-store';
import { startTestLaserJob } from './laser-test-start-helpers';
import { reserveUntrackedAcks } from './laser-untracked-ack-ledger';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { disconnectOnTestClock } from './laser-disconnect-testing';

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  await disconnectOnTestClock();
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

async function connectWithoutAirAssist(): Promise<MarlinSimulator> {
  const sim = createMarlinSimulator({ motionMs: 20, build: { airAssist: false } });
  useStore.getState().updateDeviceProfile({ controllerKind: 'marlin' });
  await useLaserStore.getState().connect(sim.adapter, { controllerKind: 'marlin' });
  await vi.advanceTimersByTimeAsync(1_200);
  return sim;
}

function marlinHarness() {
  const harness = makeLineHandlerHarness();
  harness.refs.driver = marlinDriver;
  harness.set({ capabilities: marlinDriver.capabilities, activeControllerKind: 'marlin' });
  return { ...harness, safeWrite: vi.fn(async () => undefined) };
}

describe('a job line Marlin skipped', () => {
  it('stops the job and names the command and the build option it needs', async () => {
    const sim = await connectWithoutAirAssist();
    await startTestLaserJob('M8\nM3 I S0\nG1 X10 F600 S200\nG1 X20 S200\nM5 I\nM9\n', {
      streamingMode: 'ping-pong',
    });
    await vi.advanceTimersByTimeAsync(3_000);

    const laser = useLaserStore.getState();
    expect(laser.log.some((line) => line.includes('Unknown command: "M8"'))).toBe(true);
    expect(laser.safetyNotice).toMatchObject({ kind: 'controller-error', rejectedLine: 'M8' });
    expect(laser.safetyNotice?.message).toContain('skipped M8 during the job');
    expect(laser.safetyNotice?.message).toContain('lacks AIR_ASSIST (or COOLANT_FLOOD)');
    // Nothing after the skipped line was sent; the controller was stopped.
    expect(sim.outbound()).not.toContain('M3 I S0\n');
    expect(sim.outbound()).toEqual(expect.arrayContaining(['M107\n', 'M410\n', 'M5 I\n']));
    expect(laser.liveCanvasRun?.timing ?? null).not.toMatchObject({ kind: 'complete' });
  });

  it('counts the skipped line as answered, as an error', () => {
    const { refs, set, get, safeWrite } = marlinHarness();
    set({ streamer: step(createStreamer('M8\nG1 X10\n', { streamingMode: 'ping-pong' })).state });
    handleLine(set, get, refs, safeWrite, 'echo:Unknown command: "M8"');
    expect(get().streamer?.status).toBe('streaming');
    handleLine(set, get, refs, safeWrite, 'ok');
    expect(get().streamer).toMatchObject({ status: 'errored', completed: 1, inFlight: [] });
    expect(safeWrite).not.toHaveBeenCalledWith('G1 X10\n', undefined, 'job');
  });

  // Rolling audit v9 R1-P1-1: Marlin echoes the bytes it read, so a first byte
  // lost on the wire reads differently from the line sent, and the line was
  // skipped all the same.
  it.each([
    ['a beam-off', 'M107\nG0 X10\n', '107', 'M107'],
    ['a move', 'G1 X10\nG1 X20\n', '1 X10', 'G1 X10'],
  ])('stops the job when %s reaches Marlin damaged', (_label, program, echoed, sent) => {
    const { refs, set, get, safeWrite } = marlinHarness();
    set({ streamer: step(createStreamer(program, { streamingMode: 'ping-pong' })).state });
    handleLine(set, get, refs, safeWrite, `echo:Unknown command: "${echoed}"`);
    expect(get().streamer?.status).toBe('streaming');
    handleLine(set, get, refs, safeWrite, 'ok');

    expect(get().streamer).toMatchObject({ status: 'errored', completed: 1, inFlight: [] });
    expect(get().safetyNotice).toMatchObject({ kind: 'controller-error', rejectedLine: sent });
    expect(get().safetyNotice?.message).toContain(`KerfDesk sent ${sent}`);
    expect(get().safetyNotice?.message).toContain(`"Unknown command" to ${echoed}`);
    // It says nothing of a missing build option: the build was not the problem.
    expect(get().safetyNotice?.message).not.toContain('firmware build lacks');
    // The next job line stays unsent; the stop lines go out instead.
    expect(safeWrite).not.toHaveBeenCalledWith(expect.stringMatching(/^G/), undefined, 'job');
    expect(safeWrite).toHaveBeenCalledWith('M107\n', 'stop', 'system');
  });

  describe('an echo of a non-job line still owed a reply', () => {
    function streamWithConsoleLineOwed(line: string) {
      const harness = marlinHarness();
      const { refs, set } = harness;
      set({
        streamer: step(createStreamer('G1 X10\nG1 X20\n', { streamingMode: 'ping-pong' })).state,
        pendingUntrackedAcks: 1,
      });
      reserveUntrackedAcks(refs, 1, null, [line]);
      return harness;
    }

    it('stays in the log, and the job runs on', () => {
      const { refs, set, get, safeWrite } = streamWithConsoleLineOwed('M119');
      handleLine(set, get, refs, safeWrite, 'echo:Unknown command: "M119"');
      handleLine(set, get, refs, safeWrite, 'ok');
      expect(get().streamer).toMatchObject({ status: 'streaming', completed: 1 });
      expect(get().safetyNotice).toBeNull();
    });

    it('does not excuse the job line in flight when that is what the echo names', () => {
      const { refs, set, get, safeWrite } = streamWithConsoleLineOwed('G1 X10');
      handleLine(set, get, refs, safeWrite, 'echo:Unknown command: "G1 X10"');
      handleLine(set, get, refs, safeWrite, 'ok');
      expect(get().streamer?.status).toBe('errored');
    });

    it('does not excuse an echo that reads as no line sent', () => {
      const { refs, set, get, safeWrite } = streamWithConsoleLineOwed('M119');
      handleLine(set, get, refs, safeWrite, 'echo:Unknown command: "1 X10"');
      handleLine(set, get, refs, safeWrite, 'ok');
      expect(get().streamer?.status).toBe('errored');
      expect(get().safetyNotice?.message).toContain('KerfDesk sent G1 X10');
    });
  });

  it('holds no echo when no job line is in flight', () => {
    const { refs, set, get, safeWrite } = marlinHarness();
    const stream = step(createStreamer('G1 X10\nG1 X20\n', { streamingMode: 'ping-pong' })).state;
    set({ streamer: { ...stream, status: 'paused', inFlight: [] } });
    handleLine(set, get, refs, safeWrite, 'echo:Unknown command: "FROM THE LCD"');
    handleLine(set, get, refs, safeWrite, 'ok');
    expect(get().streamer?.status).toBe('paused');
    expect(get().safetyNotice).toBeNull();
  });
});

describe('an owned command Marlin does not know', () => {
  it('is refused with the same reason on the ok that follows the echo', async () => {
    const { refs, set, get, safeWrite } = marlinHarness();
    const command = startControllerCommand(refs, async () => undefined, {
      kind: 'interactive-command',
      label: 'Air assist on',
      command: 'M8\n',
    });
    await Promise.resolve();
    handleLine(set, get, refs, safeWrite, 'echo:Unknown command: "M8"');
    expect(refs.controllerCommand).not.toBeNull();
    handleLine(set, get, refs, safeWrite, 'ok');
    await expect(command).rejects.toBeInstanceOf(ControllerCommandRefusedError);
    await expect(command).rejects.toThrow(
      'The controller answered "Unknown command" to M8: this firmware build lacks AIR_ASSIST (or COOLANT_FLOOD).',
    );
  });

  it('is not refused by an echo for an earlier line', async () => {
    const { refs, set, get, safeWrite } = marlinHarness();
    const command = startControllerCommand(refs, async () => undefined, {
      kind: 'interactive-command',
      label: 'Wait for moves',
      command: 'M400\n',
    });
    await Promise.resolve();
    handleLine(set, get, refs, safeWrite, 'echo:Unknown command: "M9"');
    handleLine(set, get, refs, safeWrite, 'ok');
    await expect(command).resolves.toEqual([]);
  });
});

describe('a Console line Marlin does not know, outside a job', () => {
  it('stays in the log: no safety notice, nothing left owed', async () => {
    await connectWithoutAirAssist();
    await useLaserStore.getState().sendConsoleCommand('M8');
    await vi.advanceTimersByTimeAsync(100);
    const laser = useLaserStore.getState();
    expect(laser.log.some((line) => line.includes('Unknown command: "M8"'))).toBe(true);
    expect(laser.safetyNotice).toBeNull();
    expect(laser.pendingUntrackedAcks).toBe(0);
  });
});
