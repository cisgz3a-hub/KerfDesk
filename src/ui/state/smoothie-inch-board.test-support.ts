// Smoothieware's inch mode around the repo's Smoothieware simulator. G20 and
// G21 set it (Robot.cpp L601-L602), M120 saves it and M121 restores it
// (push_state/pop_state, L344-L365), the status report divides MPos and WPos
// by 25.4 in it (Kernel.cpp L262-L287, %1.4f), and `$G` names it
// (SimpleShell.cpp L879-L892). Motion stays the simulator's, in mm: the moves
// sent through it are jogs, which select G21 inside M120/M121, and G92 writes
// made after a G21.
// https://github.com/Smoothieware/Smoothieware/blob/91fe4286e8ee19f062260abf094b315f9cf6bedf/src/modules/robot/Robot.cpp#L344-L365
import { vi, expect } from 'vitest';
import { createSmoothieSimulator, type SmoothieSimulator } from '../../__fixtures__/controllers';
import type {
  PlatformAdapter,
  SerialConnection,
  SerialOpenRequest,
  SerialPortRef,
} from '../../platform/types';
import { useLaserStore } from './laser-store';
import { useStore } from './store';

export type InchBoard = {
  readonly adapter: PlatformAdapter;
  readonly written: string[];
  readonly inches: () => boolean;
};

export type InchBoardOptions = {
  /** Whether `$G` names the units. */
  readonly modalReport: boolean;
  /** A board left in G20 by an earlier program or session. */
  readonly startsInInches?: boolean;
};

export function inchBoard(sim: SmoothieSimulator, options: InchBoardOptions): InchBoard {
  let inches = options.startsInInches === true;
  const saved: boolean[] = [];
  const written: string[] = [];
  const track = (data: string): void => {
    for (const [, letter, code] of data.matchAll(/([GM])\s*0*(\d+)(?![\d.])/gi)) {
      const word = `${(letter ?? '').toUpperCase()}${code ?? ''}`;
      if (word === 'G20') inches = true;
      else if (word === 'G21') inches = false;
      else if (word === 'M120') saved.push(inches);
      else if (word === 'M121') inches = saved.pop() ?? inches;
    }
  };
  const inbound = (line: string): string | null => {
    if (line.startsWith('[GC:')) {
      return options.modalReport ? line.replace(/\bG2[01]\b/, inches ? 'G20' : 'G21') : null;
    }
    if (!inches || !line.startsWith('<')) return line;
    return line.replace(/(MPos|WPos):([-\d.]+),([-\d.]+),([-\d.]+)/g, (_match, field, ...axes) => {
      const values = (axes.slice(0, 3) as string[]).map((value) =>
        (Number(value) / 25.4).toFixed(4),
      );
      return `${String(field)}:${values.join(',')}`;
    });
  };
  const wrap = (connection: SerialConnection): SerialConnection => ({
    ...connection,
    write: async (data) => {
      written.push(data);
      track(data);
      await connection.write(data);
    },
    onLine: (handler) =>
      connection.onLine((line) => {
        const shown = inbound(line);
        if (shown !== null) handler(shown);
      }),
  });
  const serial = sim.adapter.serial;
  const adapter: PlatformAdapter = {
    ...sim.adapter,
    serial: {
      ...serial,
      requestPort: async () => {
        const port = await serial.requestPort();
        if (port === null) return null;
        const wrapped: SerialPortRef = {
          ...port,
          open: async (request: SerialOpenRequest) => wrap(await port.open(request)),
        };
        return wrapped;
      },
    },
  };
  return { adapter, written, inches: () => inches };
}

/** A Smoothieware board connected and jogged to machine X100 Y100. */
export async function connectedInchBoard(
  options: InchBoardOptions = { modalReport: true },
): Promise<{ readonly sim: SmoothieSimulator; readonly board: InchBoard }> {
  const sim = createSmoothieSimulator({ motionMs: 50 });
  const board = inchBoard(sim, options);
  useStore.getState().updateDeviceProfile({ controllerKind: 'smoothieware' });
  await useLaserStore
    .getState()
    .connect(board.adapter, { controllerKind: 'smoothieware', baudRate: 115200 });
  await vi.advanceTimersByTimeAsync(1200);
  await moveTo(100, 100);
  expect(sim.state().pos).toMatchObject({ x: 100, y: 100 });
  return { sim, board };
}

export async function moveTo(x: number, y: number): Promise<void> {
  const move = useLaserStore.getState().jogToMachinePosition(x, y, 3000);
  await vi.advanceTimersByTimeAsync(4000);
  await move;
}

export async function consoleLine(line: string): Promise<void> {
  const sent = useLaserStore.getState().sendConsoleCommand(line);
  await vi.advanceTimersByTimeAsync(800);
  await sent;
  await vi.advanceTimersByTimeAsync(800);
}

/** What KerfDesk wrote after `mark`, without the status polls. */
export function writtenAfter(board: InchBoard, mark: number): string[] {
  return board.written.slice(mark).filter((data) => data !== '?');
}
