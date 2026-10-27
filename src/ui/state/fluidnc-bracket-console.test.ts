// Rolling audit v3 G4-P1-1. FluidNC v4.0.3 runs `[13]1` exactly as `$13=1`
// (ProcessSettings.cpp L1209-L1240, L1080) and then divides every reported
// position by 25.4 (Report.cpp L82-L84). The Console sent the bracket form as
// G-code, so a point move to X60 Y60 from X100 Y100 landed at X156.063
// Y156.063, and `[RST]#` and `[NVX]` erased the work offsets while the probed
// Work Z stayed current. The bracket form now meets the `$` form's checks.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSerialPort } from '../../__fixtures__/controllers/fake-serial-port';
import { useLaserStore } from './laser-store';
import { useStore } from './store';
import { resetStore } from './test-helpers';

const BANNER = "Grbl 4.0 [FluidNC v4.0.3 (wifi) '$' for help]";
const SETTINGS = ['$10=1', '$20=0', '$21=0', '$22=0', '$23=0', '$30=1000', '$32=1'];

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

/** A FluidNC board at machine X100 Y100 Z-20 that reads a `$` or `[` line the
 *  way settings_execute_line() does and reports inches while `13` is set. */
async function connectedFluidnc() {
  const port = createFakeSerialPort();
  const board = { inches: false };
  const settingKey = (line: string): string | null => {
    if (line.startsWith('$')) return line.slice(1).split('=')[0]?.trim().toUpperCase() ?? null;
    if (line.startsWith('[')) return line.slice(1).split(']')[0]?.trim().toUpperCase() ?? null;
    return null;
  };
  const value = (line: string): string =>
    line.startsWith('[') ? (line.split(']')[1] ?? '') : (line.split('=')[1] ?? '');
  const report = () =>
    board.inches
      ? '<Idle|MPos:3.9370,3.9370,-0.7874|FS:0,0>'
      : '<Idle|MPos:100.000,100.000,-20.000|FS:0,0>';
  port.onOpen(() => setTimeout(() => port.emitLine(BANNER), 1));
  port.onWrite((data) => {
    if (data === '?') {
      setTimeout(() => port.emitLine(report()), 1);
      return;
    }
    if (!data.endsWith('\n')) return;
    const line = data.trim();
    setTimeout(() => {
      if (line === '$$')
        for (const setting of [`$13=${board.inches ? 1 : 0}`, ...SETTINGS]) port.emitLine(setting);
      if (line === '$G') port.emitLine('[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]');
      const key = settingKey(line);
      if (key === '13' || key === 'REPORT/INCHES') board.inches = value(line).startsWith('1');
      port.emitLine('ok');
    }, 1);
  });
  const project = useStore.getState().project;
  useStore.setState({
    project: { ...project, device: { ...project.device, controllerKind: 'fluidnc' } },
  });
  await useLaserStore
    .getState()
    .connect(port.adapter, { controllerKind: 'fluidnc', baudRate: 115200 });
  await vi.advanceTimersByTimeAsync(3000);
  return { port, board };
}

function sentAfter(port: ReturnType<typeof createFakeSerialPort>, mark: number): string[] {
  return port
    .outbound()
    .slice(mark)
    .filter((data) => data !== '?');
}

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
        /blocked in the Console/,
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
