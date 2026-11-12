// Rolling audit v5 J7-P1-2. A FluidNC board connected under the default
// stock-GRBL profile runs `[13]1` as `$13=1` and `[RST]#` as `$RST=#`
// (ProcessSettings.cpp L1209-L1240), but the stock driver took both for G-code
// although the banner had shown FluidNC: `[13]1` went out unconfirmed and
// unread, the board reported inches while KerfDesk read millimetres, and the
// next point move from X100 to X60 sent `$J=G91 G21 X56.063 Y56.063`; `[RST]#`
// went out with the probed Work Z kept. Once the banner shows FluidNC, the line
// gets the checks of the `$` form it runs as (ADR-375 Amendment 11).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectedFluidnc, sentAfter } from './fluidnc-board.test-support';
import { useLaserStore } from './laser-store';
import { resetStore } from './test-helpers';

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  resetStore();
});

afterEach(async () => {
  vi.useRealTimers();
  await useLaserStore.getState().disconnect();
  resetStore();
  vi.restoreAllMocks();
});

const TO_X60_Y60 = '$J=G91 G21 X-40.000 Y-40.000 F1000\n';

async function moveToX60Y60(): Promise<void> {
  const jog = useLaserStore.getState().jogToMachinePosition(60, 60, 1000);
  await vi.advanceTimersByTimeAsync(2000);
  await jog;
}

async function grblProfileOnFluidnc() {
  const connected = await connectedFluidnc('grbl-v1.1');
  const laser = useLaserStore.getState();
  expect(laser.activeControllerKind).toBe('grbl-v1.1');
  expect(laser.detectedControllerKind).toBe('fluidnc');
  return connected;
}

describe('FluidNC bracket lines under the stock-GRBL profile (rolling audit v5 J7-P1-2)', () => {
  it.each(['[13]1', '[Report/Inches]1', '[report/inches]1'])(
    'asks for confirmation of %s as for the numeric setting 13 write, so nothing is sent unasked',
    async (line) => {
      const { port, board } = await grblProfileOnFluidnc();
      const mark = port.outbound().length;
      await expect(useLaserStore.getState().sendConsoleCommand(line)).rejects.toThrow(
        /needs confirmation/,
      );
      expect(sentAfter(port, mark)).toEqual([]);
      expect(board.inches).toBe(false);
      await moveToX60Y60();
      expect(sentAfter(port, mark)).toContain(TO_X60_Y60);
    },
  );

  it('sends a confirmed [13]1 as $13=1 and reads the settings back, so the next point move lands', async () => {
    const { port, board } = await grblProfileOnFluidnc();
    const mark = port.outbound().length;
    const sent = useLaserStore.getState().sendConsoleCommand('[13]1', { confirmed: true });
    await vi.advanceTimersByTimeAsync(2000);
    await sent;
    expect(sentAfter(port, mark).slice(0, 2)).toEqual(['$13=1\n', '$$\n']);
    expect(board.inches).toBe(true);
    const laser = useLaserStore.getState();
    expect(laser.controllerSettings?.reportInches).toBe(true);
    expect(laser.reportUnitsUnconfirmed).toBe(false);
    await vi.advanceTimersByTimeAsync(500);
    await moveToX60Y60();
    expect(sentAfter(port, mark)).toContain(TO_X60_Y60);
  });

  it.each(['[RST]#', '[rst]*', '[Settings/Restore]#', '[NVX]', '[Settings/Erase]'])(
    'refuses %s, so the offsets and the probed Work Z stay as they are',
    async (line) => {
      const { port } = await grblProfileOnFluidnc();
      const epoch = useLaserStore.getState().workZReferenceEpoch;
      useLaserStore.setState({
        workZZeroEvidence: { source: 'probe', referenceEpoch: epoch, probePlateRemoved: true },
      });
      const mark = port.outbound().length;
      await expect(useLaserStore.getState().sendConsoleCommand(line)).rejects.toThrow(
        /KerfDesk does not send this command|blocked in the Console/,
      );
      expect(sentAfter(port, mark)).toEqual([]);
      expect(useLaserStore.getState().workZZeroEvidence?.referenceEpoch).toBe(epoch);
      await moveToX60Y60();
      expect(sentAfter(port, mark)).toContain(TO_X60_Y60);
    },
  );

  it.each(['$report_inches=on', '[report_inches]true'])(
    'refuses %s, the machine-config spelling of setting 13',
    async (line) => {
      const { port, board } = await grblProfileOnFluidnc();
      const mark = port.outbound().length;
      await expect(useLaserStore.getState().sendConsoleCommand(line)).rejects.toThrow(
        /report_inches switches FluidNC's position reports to inches/,
      );
      expect(sentAfter(port, mark)).toEqual([]);
      expect(board.inches).toBe(false);
    },
  );
});
