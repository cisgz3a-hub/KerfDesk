// A lost link, then the first reconnect decides the restart (ADR-398
// Amendment 3, rolling audit 18-P2-1). Real laser-store, checkpoint tracker,
// recovery repository and restart line against the GRBL simulator with its
// stock 15-block planner. The cable goes while the planner is full. An
// Arduino-class board resets when the port reopens and greets with its banner,
// throwing away the acknowledged moves it had queued: the automatic restart
// must step back over them. A board that kept running answers without a
// banner, and the restart and Continue from where the head stopped stay as
// they were (ADR-341 Amendment 6). grblHAL greets every new Telnet client with
// the same banner while it keeps running, so a network reconnect cannot show
// a restart: nothing steps back, and the hint names the line that would
// (ADR-398 Amendment 4, controller audit D7-P2-1).

import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createGrblSimulator, type GrblSimulator } from '../../__fixtures__/controllers';
import { GRBL_PLANNER_BLOCKS } from '../../__fixtures__/controllers/grbl-sim-planner';
import { isSendableGcodeLine } from '../../core/controllers/grbl';
import { rawResumeLine } from '../../core/recovery';
import { isPlannerMotionLine } from '../../core/recovery/planner-backlog-restart';
import type { PlatformAdapter } from '../../platform/types';
import { useLaserStore } from '../state/laser-store';
import type { RecoveryCapsule, RecoveryRepository } from '../state/recovery';
import { automaticRecoveryRestart, automaticRestartHint } from './laser-recovery-automatic-restart';
import { recoveryHeadStop } from './laser-recovery-head-stop';
import {
  connectSimulator,
  drive,
  expectCapsuleFor,
  harness,
  installRecoveryStressHooks,
  startFramedJob,
  STRESS_TIMEOUT_MS,
  tick,
} from './recovery-stress-testing';

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
}));

installRecoveryStressHooks();

type LostRun = {
  readonly h: Awaited<ReturnType<typeof harness>>;
  readonly saved: RecoveryCapsule;
  readonly gcode: string;
  /** Planner blocks the simulator held when the cable went. */
  readonly queuedAtDrop: number;
};

async function loseLinkWithPlannerFull(): Promise<LostRun> {
  const h = await harness();
  const { runId, running } = await startFramedJob(h.repository);
  await tick(150);
  const queuedAtDrop = h.simulator.planner().blocks;
  expect(queuedAtDrop).toBeGreaterThan(0);
  h.simulator.yankCable();
  await tick(20);
  await drive(running);
  const saved = await expectCapsuleFor(h.repository, runId);
  if (saved.artifact.kind !== 'exact-execution') throw new Error('Expected an exact archive.');
  return { h, saved, gcode: saved.artifact.gcode, queuedAtDrop };
}

async function settledCapsule(repository: RecoveryRepository, before: RecoveryCapsule) {
  await vi.waitFor(() =>
    expect(repository.getSnapshot().recoveryCapsule?.revision).toBeGreaterThan(before.revision),
  );
  const capsule = repository.getSnapshot().recoveryCapsule;
  if (capsule === null) throw new Error('Expected the saved run.');
  return capsule;
}

/** 1-based raw line of the nth planner movement line of the program. */
function rawLineOfMove(gcode: string, move: number): number {
  let moves = 0;
  const lines = gcode.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (!isSendableGcodeLine(line) || !isPlannerMotionLine(line)) continue;
    moves += 1;
    if (moves === move) return index + 1;
  }
  throw new Error(`The program has no movement ${move}.`);
}

const GRBLHAL_BANNER = "GrblHAL 1.1f ['$' or '$HELP' for help]";

/** The simulator reached over a Wi-Fi Telnet session, as the desktop network
 * adapter reports one. */
function overTelnet(simulator: GrblSimulator): PlatformAdapter {
  const serial = simulator.adapter.serial;
  return {
    ...simulator.adapter,
    serial: {
      ...serial,
      transport: 'tcp',
      requestPort: async () => {
        const port = await serial.requestPort();
        return port === null ? null : { ...port, info: { transport: 'tcp' } };
      },
    },
  };
}

/** A grblHAL board that never reset, reached again over Telnet: it greets
 * the new client with its startup banner, then answers the status query. */
async function reconnectOverTelnet(): Promise<GrblSimulator> {
  const simulator = createGrblSimulator({
    plannerBlocks: GRBL_PLANNER_BLOCKS,
    motionMs: 25,
    firmwareBanner: GRBLHAL_BANNER,
  });
  await act(async () => {
    await useLaserStore.getState().connect(overTelnet(simulator));
  });
  await tick(1_200);
  const laser = useLaserStore.getState();
  expect(laser.serialPortInfo?.transport).toBe('tcp');
  expect(laser.detectedControllerKind).toBe('grblhal');
  expect(laser.statusReport?.state).toBe('Idle');
  return simulator;
}

/** Planner movement lines among the first `sendable` sendable lines. */
function movesWithin(gcode: string, sendable: number): number {
  let seen = 0;
  let moves = 0;
  for (const line of gcode.split('\n')) {
    if (seen >= sendable) break;
    if (!isSendableGcodeLine(line)) continue;
    seen += 1;
    if (isPlannerMotionLine(line)) moves += 1;
  }
  return moves;
}

describe('the first reconnect after a lost link', () => {
  it(
    'steps the automatic restart back over the planner when the controller greets with its banner',
    async () => {
      const { h, saved, gcode, queuedAtDrop } = await loseLinkWithPlannerFull();
      const firstUnacked = rawResumeLine(gcode, saved.ackedLines);
      expect(saved.interruption.kind).toBe('disconnect');
      expect(saved.interruption.plannerBacklogIfRestarted).toMatchObject({
        ackedAtStatus: saved.ackedLines,
        queuedBlocks: 15,
        bound: 'planner-size',
      });
      // Before the reconnect nothing is known, and the restart is unchanged.
      expect(automaticRecoveryRestart(saved)?.line).toBe(firstUnacked);

      // The board resets as the port reopens and prints its startup banner.
      h.simulator = await connectSimulator();
      const revised = await settledCapsule(h.repository, saved);
      expect(revised.interruption).toMatchObject({
        kind: 'disconnect',
        sentLines: saved.interruption.sentLines,
        plannerBacklog: saved.interruption.plannerBacklogIfRestarted,
      });
      expect(revised.interruption).not.toHaveProperty('plannerBacklogIfRestarted');
      expect(revised.interruption.message).toContain('startup banner');
      expect(revised.interruption.message).toMatch(/^The USB connection was lost/);

      const restart = automaticRecoveryRestart(revised);
      expect(restart?.plannerBacklogBasis).toBe('planner-size');
      expect(restart?.line).toBeLessThan(firstUnacked);
      // The reset threw away the moves still queued at the drop: the restart
      // begins at or before the first of them, so none is skipped.
      const ackedMoves = movesWithin(gcode, saved.ackedLines);
      const firstDiscarded = rawLineOfMove(gcode, ackedMoves - queuedAtDrop + 1);
      expect(restart?.line).toBeLessThanOrEqual(firstDiscarded);
      // The opt-in Continue from where the head stopped still reads the sent lines.
      expect(recoveryHeadStop(revised)?.sentLines).toBe(saved.interruption.sentLines);
    },
    STRESS_TIMEOUT_MS,
  );

  it(
    'keeps a quiet USB Idle reconnect unknown and names the backlog a restart discarded',
    async () => {
      const { h, saved, gcode } = await loseLinkWithPlannerFull();
      // This is a fresh controller with an empty planner, but its USB startup
      // banner was missed. Idle cannot distinguish it from one that finished.
      h.simulator = await connectSimulator({ emitBannerOnOpen: false });
      const revised = await settledCapsule(h.repository, saved);
      expect(revised.interruption).toMatchObject({
        kind: 'disconnect',
        unconfirmedPlannerBacklog: saved.interruption.plannerBacklogIfRestarted,
        sentLines: saved.interruption.sentLines,
      });
      expect(revised.interruption.message).toContain(
        'does not show whether the controller restarted',
      );
      expect(revised.interruption.message).not.toContain('It sent its startup banner');
      const restart = automaticRecoveryRestart(revised);
      expect(restart?.line).toBe(rawResumeLine(gcode, saved.ackedLines));
      expect(restart?.ifRestarted?.line).toBeLessThan(restart?.line ?? 0);
      expect(recoveryHeadStop(revised)).not.toBeNull();
    },
    STRESS_TIMEOUT_MS,
  );

  it(
    'does not step back on a Telnet greeting from a board that kept running, and names the line a restart would need',
    async () => {
      const { h, saved, gcode, queuedAtDrop } = await loseLinkWithPlannerFull();
      const firstUnacked = rawResumeLine(gcode, saved.ackedLines);
      h.simulator = await reconnectOverTelnet();
      const revised = await settledCapsule(h.repository, saved);
      expect(revised.interruption).toMatchObject({
        kind: 'disconnect',
        sentLines: saved.interruption.sentLines,
        unconfirmedPlannerBacklog: saved.interruption.plannerBacklogIfRestarted,
      });
      expect(revised.interruption).not.toHaveProperty('plannerBacklog');
      expect(revised.interruption).not.toHaveProperty('plannerBacklogIfRestarted');
      const message = revised.interruption.message;
      expect(message).toMatch(/^The network connection was lost/);
      expect(message).toContain('does not show whether the controller restarted');
      expect(message).not.toMatch(/USB|Arduino|had restarted/);

      // The automatic line stays where a board that kept running needs it.
      const restart = automaticRecoveryRestart(revised);
      expect(restart?.line).toBe(firstUnacked);
      expect(restart?.plannerBacklogBlocks).toBeUndefined();
      // The line a restart would need covers every move still queued at the drop.
      const ackedMoves = movesWithin(gcode, saved.ackedLines);
      const firstDiscarded = rawLineOfMove(gcode, ackedMoves - queuedAtDrop + 1);
      const ifRestarted = restart?.ifRestarted;
      expect(ifRestarted?.basis).toBe('planner-size');
      expect(ifRestarted?.line).toBeLessThanOrEqual(firstDiscarded);
      expect(automaticRestartHint(restart ?? null)).toContain(
        `restart from line ${ifRestarted?.line} to replay them`,
      );
      expect(recoveryHeadStop(revised)?.sentLines).toBe(saved.interruption.sentLines);
    },
    STRESS_TIMEOUT_MS,
  );
});
