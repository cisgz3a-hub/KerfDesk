// Rolling audit v3 G4-P1-1. FluidNC v4.0.3 runs `[13]1` exactly as `$13=1`
// (ProcessSettings.cpp L1209-L1240, L1080) and then divides every reported
// position by 25.4 (Report.cpp L82-L84). The Console sent the bracket form as
// G-code, so a point move to X60 Y60 from X100 Y100 landed at X156.063
// Y156.063, and `[RST]#` and `[NVX]` erased the work offsets while the probed
// Work Z stayed current. The bracket form now meets the `$` form's checks.
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

describe('FluidNC bracket lines in the Console (rolling audit v3 G4-P1-1)', () => {
  it.each(['[13]1', '[Report/Inches]1', '$Report/Inches=1'])(
    'refuses %s like the numeric setting 13 write, so the board keeps millimetre reports and the move lands',
    async (line) => {
      const { port, board } = await connectedFluidnc();
      const mark = port.outbound().length;
      await expect(useLaserStore.getState().sendConsoleCommand(line)).rejects.toThrow(
        /does not send numeric \$ setting writes on the FluidNC profile/,
      );
      expect(sentAfter(port, mark)).toEqual([]);
      expect(board.inches).toBe(false);
      const jog = useLaserStore.getState().jogToMachinePosition(60, 60, 1000);
      await vi.advanceTimersByTimeAsync(2000);
      await jog;
      expect(sentAfter(port, mark)).toContain('$J=G91 G21 X-40.000 Y-40.000 F1000\n');
    },
  );

  it.each(['[RST]#', '[rst]*', '[Settings/Restore]#', '[NVX]', '[Settings/Erase]'])(
    'refuses %s, so the offsets and the probed Work Z stay as they are',
    async (line) => {
      const { port } = await connectedFluidnc();
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
    },
  );

  it.each(['$report_inches=on', '[report_inches]true'])(
    'refuses %s, the machine-config spelling of setting 13',
    async (line) => {
      const { port } = await connectedFluidnc();
      const mark = port.outbound().length;
      await expect(useLaserStore.getState().sendConsoleCommand(line)).rejects.toThrow(
        /report_inches switches FluidNC's position reports to inches/,
      );
      expect(sentAfter(port, mark)).toEqual([]);
    },
  );
});
