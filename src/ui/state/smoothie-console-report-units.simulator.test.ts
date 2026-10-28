// Rolling audit v3 G4-P1-2. After a Console G20, Smoothieware prints MPos and
// WPos in inches (Kernel.cpp L262-L287, Robot.h L52-L53 @ 91fe4286), and the
// jog's own G21 inside M120/M121 does not last (Robot.cpp L344-L365). KerfDesk
// read those reports as millimetres, so a point move to X60 Y60 from X100 Y100
// drove the head to X156.063 Y156.063. The Console now reads the units back
// with `$G` (SimpleShell.cpp L879-L892) before it shows another position.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { disconnectOnTestClock } from './laser-disconnect-testing';
import { moveHeadToWorkPoint } from '../laser/laser-recovery-move';
import { useLaserStore } from './laser-store';
import {
  connectedInchBoard as connectedBoard,
  consoleLine,
  moveTo,
  writtenAfter,
} from './smoothie-inch-board.test-support';
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
