// Rolling audit v5 J7-P1-1. Since ADR-375 Amendment 7, KerfDesk reads a
// Smoothieware board's reports in inches after a Console G20, or when the board
// was left in G20 at connect. Restore saved origin, Place Board's corner origin
// and Continue from where the head stopped then wrote a plain G21 before their
// G92, which put the board back in millimetres (Robot.cpp L601-L602 @ 91fe4286)
// while KerfDesk went on reading inches: Move to position X60 from X100 sent
// `G0 X-2480.000 Y-2480.000`, and Go to work zero drove the head to X-1170.
// KerfDesk now records the millimetres its own G21 selects, as Frame does.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { disconnectOnTestClock } from './laser-disconnect-testing';
import { moveHeadToWorkPoint } from '../laser/laser-recovery-move';
import { reportedWorkOffsetMm } from './infer-machine-position';
import { useLaserStore } from './laser-store';
import {
  connectedInchBoard,
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

async function settle<T>(action: Promise<T>): Promise<T> {
  await vi.advanceTimersByTimeAsync(5000);
  return action;
}

function transcript(): string {
  return useLaserStore
    .getState()
    .transcript.map((entry) => entry.raw)
    .join('\n');
}

function expectMillimetreReports(board: { readonly inches: () => boolean }): void {
  const laser = useLaserStore.getState();
  expect(board.inches()).toBe(false);
  // Never recorded reads as millimetres.
  expect(laser.controllerSettings?.reportInches ?? false).toBe(false);
  expect(laser.reportUnitsUnconfirmed).toBe(false);
}

async function goToWorkZero(): Promise<void> {
  const laser = useLaserStore.getState();
  // As the Go to work zero button reads it (OriginRow.tsx).
  const offset = reportedWorkOffsetMm(
    laser.wcoCache,
    laser.controllerSettings?.reportInches === true,
  );
  expect(offset).not.toBeNull();
  await moveTo(offset?.x ?? Number.NaN, offset?.y ?? Number.NaN);
}

describe('KerfDesk-owned G21 on Smoothieware (rolling audit v5 J7-P1-1)', () => {
  it("records Place Board's corner origin G21 after a Console G20, so the next point moves land", async () => {
    const { sim, board } = await connectedInchBoard();
    await consoleLine('G20');
    expect(useLaserStore.getState().controllerSettings?.reportInches).toBe(true);
    const mark = board.written.length;
    await settle(useLaserStore.getState().setOriginAtMachinePoint({ x: 50, y: 50 }));
    expect(writtenAfter(board, mark)).toEqual(['G21\n', 'G92 X50.000 Y50.000\n']);
    expectMillimetreReports(board);
    expect(transcript()).toMatch(
      /Set board origin selected millimetres \(G21\), so the controller now reports positions in millimetres/,
    );
    await moveTo(60, 60);
    expect(sim.state().pos.x).toBeCloseTo(60, 2);
    expect(sim.state().pos.y).toBeCloseTo(60, 2);
    await goToWorkZero();
    expect(sim.state().pos.x).toBeCloseTo(50, 2);
    expect(sim.state().pos.y).toBeCloseTo(50, 2);
  });

  it('records Restore saved origin on a board left in G20, so the point and recovery moves land', async () => {
    const { sim, board } = await connectedInchBoard({ modalReport: true, startsInInches: true });
    expect(useLaserStore.getState().controllerSettings?.reportInches).toBe(true);
    await settle(useLaserStore.getState().restoreWorkOrigin({ x: 50, y: 50 }));
    expectMillimetreReports(board);
    await moveTo(60, 60);
    expect(sim.state().pos.x).toBeCloseTo(60, 2);
    const recovery = moveHeadToWorkPoint({ x: 10, y: 10 });
    await vi.advanceTimersByTimeAsync(4000);
    await recovery;
    expect(sim.state().pos.x).toBeCloseTo(60, 2);
    expect(sim.state().pos.y).toBeCloseTo(60, 2);
    // A second press writes the same offset again, not one 25.4 times off.
    const mark = board.written.length;
    await settle(useLaserStore.getState().restoreWorkOrigin({ x: 50, y: 50 }));
    expect(writtenAfter(board, mark)).toEqual(['G21\n', 'G92 X10.000 Y10.000\n']);
  });

  it('confirms Continue from where the head stopped in G20, and the next point move lands', async () => {
    const { sim, board } = await connectedInchBoard({ modalReport: true, startsInInches: true });
    const offset = await settle(useLaserStore.getState().setOriginAtProgramPoint({ x: 40, y: 40 }));
    expect(offset.x).toBeCloseTo(60, 3);
    expectMillimetreReports(board);
    await moveTo(60, 60);
    expect(sim.state().pos.x).toBeCloseTo(60, 2);
    await goToWorkZero();
    expect(sim.state().pos.x).toBeCloseTo(60, 2);
  });

  it("records Auto-focus's setup G21 after a Console G20, so the next point move lands", async () => {
    const { sim, board } = await connectedInchBoard();
    await consoleLine('G20');
    const mark = board.written.length;
    const focus = useLaserStore.getState().autofocus('G38.2 Z-10 F100');
    await vi.advanceTimersByTimeAsync(3000);
    expect(await focus).toEqual({ kind: 'ok' });
    expect(writtenAfter(board, mark)).toEqual(['G21\n', 'G90\n', 'G38.2 Z-10 F100\n']);
    expectMillimetreReports(board);
    await moveTo(60, 60);
    expect(sim.state().pos.x).toBeCloseTo(60, 2);
  });

  it('control: an owned G21 while KerfDesk reads millimetres changes nothing and says nothing', async () => {
    const { sim, board } = await connectedInchBoard();
    const before = transcript();
    await settle(useLaserStore.getState().setOriginAtMachinePoint({ x: 50, y: 50 }));
    expectMillimetreReports(board);
    expect(transcript().slice(before.length)).not.toMatch(/selected millimetres/);
    await moveTo(60, 60);
    expect(sim.state().pos.x).toBeCloseTo(60, 2);
  });
});
