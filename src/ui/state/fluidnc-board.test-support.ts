// A FluidNC v4.0.3 board for Console tests. It reads a `$` or `[` line the way
// settings_execute_line() does (`[key]value` is `$key=value`) and reports
// positions in inches while `13` is set (ProcessSettings.cpp L1209-L1240,
// L1080; Report.cpp L82-L84).
// https://github.com/bdring/FluidNC/blob/v4.0.3/FluidNC/src/ProcessSettings.cpp#L1209-L1240
import { vi } from 'vitest';
import type { ControllerKind } from '../../core/devices/device-profile';
import { createFakeSerialPort } from '../../__fixtures__/controllers/fake-serial-port';
import { useLaserStore } from './laser-store';
import { useStore } from './store';

const BANNER = "Grbl 4.0 [FluidNC v4.0.3 (wifi) '$' for help]";
const SETTINGS = ['$10=1', '$20=0', '$21=0', '$22=0', '$23=0', '$30=1000', '$32=1'];

export type FluidncBoard = {
  readonly port: ReturnType<typeof createFakeSerialPort>;
  readonly board: { inches: boolean };
};

/** The board at machine X100 Y100 Z-20, connected under `controllerKind`. */
export async function connectedFluidnc(
  controllerKind: ControllerKind = 'fluidnc',
): Promise<FluidncBoard> {
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
    project: { ...project, device: { ...project.device, controllerKind } },
  });
  await useLaserStore.getState().connect(port.adapter, { controllerKind, baudRate: 115200 });
  await vi.advanceTimersByTimeAsync(3000);
  return { port, board };
}

/** What KerfDesk wrote after `mark`, without the status polls. */
export function sentAfter(port: FluidncBoard['port'], mark: number): string[] {
  return port
    .outbound()
    .slice(mark)
    .filter((data) => data !== '?');
}
