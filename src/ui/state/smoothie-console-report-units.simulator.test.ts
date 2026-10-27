// Rolling audit v3 G4-P1-2. After a Console G20, Smoothieware prints MPos and
// WPos in inches (Kernel.cpp L262-L287, Robot.h L52-L53 @ 91fe4286), and the
// jog's own G21 inside M120/M121 does not last (Robot.cpp L344-L365). KerfDesk
// read those reports as millimetres, so a point move to X60 Y60 from X100 Y100
// drove the head to X156.063 Y156.063. The Console now reads the units back
// with `$G` (SimpleShell.cpp L879-L892) before it shows another position.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSmoothieSimulator, type SmoothieSimulator } from '../../__fixtures__/controllers';
import type {
  PlatformAdapter,
  SerialConnection,
  SerialOpenRequest,
  SerialPortRef,
} from '../../platform/types';
import { disconnectOnTestClock } from './laser-disconnect-testing';
import { moveHeadToWorkPoint } from '../laser/laser-recovery-move';
import { useLaserStore } from './laser-store';
import { useStore } from './store';
import { resetStore } from './test-helpers';

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  await disconnectOnTestClock();
  resetStore();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

type InchBoard = {
  readonly adapter: PlatformAdapter;
  readonly written: string[];
};

/** The simulator with Smoothieware's inch mode around it: G20/G21 set it, M120
 *  saves it and M121 restores it, the status report divides MPos and WPos by
 *  25.4 in it (%1.4f), and `$G` names it. Motion stays the simulator's, in mm:
 *  the only moves sent here are jogs, which select G21 inside M120/M121. */
function inchBoard(sim: SmoothieSimulator, options: { readonly modalReport: boolean }): InchBoard {
  let inches = false;
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
  return { adapter, written };
}

async function connectedBoard(options = { modalReport: true }) {
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

async function moveTo(x: number, y: number): Promise<void> {
  const move = useLaserStore.getState().jogToMachinePosition(x, y, 3000);
  await vi.advanceTimersByTimeAsync(4000);
  await move;
}

async function consoleLine(line: string): Promise<void> {
  const sent = useLaserStore.getState().sendConsoleCommand(line);
  await vi.advanceTimersByTimeAsync(800);
  await sent;
  await vi.advanceTimersByTimeAsync(800);
}

function writtenAfter(board: InchBoard, mark: number): string[] {
  return board.written.slice(mark).filter((data) => data !== '?');
}

describe('Smoothieware Console units (rolling audit v3 G4-P1-2)', () => {
  it('reads the units back after a Console G20, so a point move lands on its target', async () => {
    const { sim, board } = await connectedBoard();
    const mark = board.written.length;
    await consoleLine('G20');
    expect(writtenAfter(board, mark).slice(0, 2)).toEqual(['G20\n', '$G\n']);
    const laser = useLaserStore.getState();
    expect(laser.controllerSettings?.reportInches).toBe(true);
    expect(laser.reportUnitsUnconfirmed).toBe(false);
    // The board itself now reports inches.
    expect(laser.statusReport?.mPos?.x).toBeCloseTo(100 / 25.4, 3);

    await moveTo(60, 60);
    expect(sim.state().pos.x).toBeCloseTo(60, 2);
    expect(sim.state().pos.y).toBeCloseTo(60, 2);
    await moveTo(100, 100);
    expect(sim.state().pos.x).toBeCloseTo(100, 2);
    expect(sim.state().pos.y).toBeCloseTo(100, 2);
  });

  it('reads millimetres again after a Console G21', async () => {
    const { sim } = await connectedBoard();
    await consoleLine('G20');
    await consoleLine('G21');
    expect(useLaserStore.getState().controllerSettings?.reportInches).toBe(false);
    await moveTo(60, 60);
    expect(sim.state().pos.x).toBeCloseTo(60, 2);
  });

  it('takes the recovery move target from the work offset in the units the board reports', async () => {
    const { sim } = await connectedBoard();
    await moveTo(50, 50);
    await consoleLine('G92 X0 Y0');
    // Off the origin: from on it, an inch offset and an inch position cancel.
    await moveTo(80, 80);
    await consoleLine('G20');
    await vi.advanceTimersByTimeAsync(1000);
    const move = moveHeadToWorkPoint({ x: 10, y: 10 });
    await vi.advanceTimersByTimeAsync(4000);
    await move;
    expect(sim.state().pos.x).toBeCloseTo(60, 2);
    expect(sim.state().pos.y).toBeCloseTo(60, 2);
  });

  it('keeps the position hidden and refuses a point move when $G names no units', async () => {
    const { sim } = await connectedBoard({ modalReport: false });
    await consoleLine('G20');
    const laser = useLaserStore.getState();
    expect(laser.reportUnitsUnconfirmed).toBe(true);
    expect(laser.statusReport?.mPos ?? null).toBeNull();
    expect(laser.wcoCache).toBeNull();
    expect(laser.transcript.map((entry) => entry.raw).join('\n')).toMatch(
      /G20 may have changed the units.*send \$G from the Console, or Frame/,
    );
    const move = useLaserStore.getState().jogToMachinePosition(60, 60, 3000);
    const refused = expect(move).rejects.toThrow(
      /does not know which units the controller reports positions in/,
    );
    await vi.advanceTimersByTimeAsync(2000);
    await refused;
    expect(sim.state().pos).toMatchObject({ x: 100, y: 100 });
  });

  it('control: a G21 while KerfDesk reads millimetres reads nothing back', async () => {
    const { board } = await connectedBoard();
    const mark = board.written.length;
    await consoleLine('G21');
    expect(writtenAfter(board, mark)).toEqual(['G21\n']);
    expect(useLaserStore.getState().reportUnitsUnconfirmed).toBe(false);
  });
});
