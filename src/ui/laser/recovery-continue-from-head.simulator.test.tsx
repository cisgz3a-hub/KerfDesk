// Continue from where the head stopped (ADR-341 Amendment 6). A User Origin
// laser job loses its USB link; the controller runs what it had received and
// the head stays at the end of the last line sent. The controller then comes
// back reset, with its position zeroed where the head stands and no origin, as
// a machine without homing does. Setting the origin from the recorded stop
// point and continuing from the next line must finish the job where it would
// have ended. Real laser-store, recovery repository and recovery flow against
// the GRBL simulator; the reconnect is a fresh simulator, as a reset controller.

import { describe, expect, it, vi } from 'vitest';
import { totalWco } from '../../__fixtures__/controllers/grbl-sim-state';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import type { ExecutionArtifactV1 } from '../state/recovery';
import { recoveryHeadStop } from './laser-recovery-head-stop';
import { runLaserRecoveryCapsuleFlow } from './laser-recovery-flow';
import {
  connectSimulator,
  drive,
  expectCapsuleFor,
  harness,
  installRecoveryStressHooks,
  programLines,
  startFramedJob,
  STRESS_TIMEOUT_MS,
  tick,
} from './recovery-stress-testing';

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
}));

installRecoveryStressHooks();

const ORIGIN = { x: 20, y: 30 };

describe('Continue from where the head stopped after a lost link', () => {
  it(
    'records the stop, sets the origin from it, and ends the job where it would have',
    async () => {
      const h = await harness();
      useStore.setState({ jobPlacement: { startFrom: 'user-origin', anchor: 'front-left' } });
      await drive(useLaserStore.getState().jog({ dx: ORIGIN.x, dy: ORIGIN.y, feed: 1_000 }));
      await tick(1_500);
      await drive(useLaserStore.getState().setOriginHere());
      await tick(1_500);
      expect(totalWco(h.simulator.state())).toMatchObject(ORIGIN);

      const { runId, running } = await startFramedJob(h.repository);
      // Early, while lines are still waiting to be sent.
      await tick(150);
      const lostLink = h.simulator;
      lostLink.yankCable();
      await tick(20);
      await drive(running);
      const capsule = await expectCapsuleFor(h.repository, runId);
      const sent = capsule.interruption.sentLines;
      expect(capsule.interruption.kind).toBe('disconnect');
      expect(sent).toBeGreaterThanOrEqual(capsule.ackedLines);
      expect(sent).toBeLessThan(capsule.sendableLines);

      // The controller runs out what it had received, then stands still.
      await tick(5_000);
      const stop = recoveryHeadStop(capsule);
      if (stop === null) throw new Error('Expected a recorded head stop.');
      const head = lostLink.state().mpos;
      expect(head.x).toBeCloseTo(ORIGIN.x + stop.pointMm.x, 3);
      expect(head.y).toBeCloseTo(ORIGIN.y + stop.pointMm.y, 3);

      // The reset controller counts from where the head stands, with no origin.
      h.simulator = await connectSimulator();
      expect(useLaserStore.getState().workOriginActive).toBe(false);
      const before = h.simulator.outbound().length;
      const written = await drive(useLaserStore.getState().setOriginAtProgramPoint(stop.pointMm));
      expect(programLines(h.simulator, before)).toContain(
        `G54 G21 G92 X${stop.pointMm.x.toFixed(3)} Y${stop.pointMm.y.toFixed(3)}`,
      );
      expect(written.x).toBeCloseTo(-stop.pointMm.x, 3);
      expect(written.y).toBeCloseTo(-stop.pointMm.y, 3);
      expect(totalWco(h.simulator.state()).x).toBeCloseTo(written.x, 3);
      expect(h.simulator.state().mpos).toMatchObject({ x: 0, y: 0 });

      const resumed = runLaserRecoveryCapsuleFlow(capsule, h.repository, { fromLine: stop.line });
      expect(await drive(resumed)).toBe(true);
      await tick(8_000);
      expect(useLaserStore.getState().streamer).toBeNull();
      // Where the resumed job ends, measured from where the first controller
      // counted: the head's stop plus the second controller's travel.
      const end = lastProgramPoint((capsule.artifact as ExecutionArtifactV1).gcode);
      expect(head.x + h.simulator.state().mpos.x).toBeCloseTo(ORIGIN.x + end.x, 3);
      expect(head.y + h.simulator.state().mpos.y).toBeCloseTo(ORIGIN.y + end.y, 3);
    },
    STRESS_TIMEOUT_MS,
  );
});

/** The last X and Y a G90 program commands. */
function lastProgramPoint(gcode: string): { readonly x: number; readonly y: number } {
  let x = 0;
  let y = 0;
  for (const line of gcode.split('\n')) {
    const code = line.replace(/;.*$/, '').replace(/\(.*?\)/g, '');
    const xWord = /X(-?\d+(?:\.\d+)?)/i.exec(code);
    const yWord = /Y(-?\d+(?:\.\d+)?)/i.exec(code);
    if (xWord?.[1] !== undefined) x = Number(xWord[1]);
    if (yWord?.[1] !== undefined) y = Number(yWord[1]);
  }
  return { x, y };
}
