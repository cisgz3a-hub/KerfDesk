// A User Origin laser job whose controller reboots mid-job (ADR-341 Amendment
// 5). The reboot clears the G92 origin, so the recovery used to refuse with the
// ordinary Start advice, Click "Set origin here" first, which puts the origin
// wherever the head had stopped. Recovery now names the saved origin, and
// Restore saved origin writes it back so the rest of the job lands where the
// job ran. Real laser-store, recovery repository and recovery flow against the
// GRBL simulator; the reconnect is a fresh simulator, as a rebooted controller.

import { describe, expect, it, vi } from 'vitest';
import { totalWco } from '../../__fixtures__/controllers/grbl-sim-state';
import { useStore } from '../state';
import { jobAwareAlert } from '../state/job-aware-dialogs';
import { useLaserStore } from '../state/laser-store';
import type { ExecutionArtifactV1 } from '../state/recovery';
import { USER_ORIGIN_REQUIRED_MESSAGE } from '../job-placement';
import { runLaserRecoveryCapsuleFlow } from './laser-recovery-flow';
import { savedWorkOffsetMm } from './laser-recovery-origin';
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

describe('User Origin recovery after a controller reboot', () => {
  it(
    'names the saved origin, restores it, and resumes in the frame the job ran in',
    async () => {
      const h = await harness();
      useStore.setState({ jobPlacement: { startFrom: 'user-origin', anchor: 'front-left' } });
      await drive(useLaserStore.getState().jog({ dx: ORIGIN.x, dy: ORIGIN.y, feed: 1_000 }));
      await tick(1_500);
      await drive(useLaserStore.getState().setOriginHere());
      await tick(1_500);
      expect(totalWco(h.simulator.state())).toMatchObject(ORIGIN);

      const { runId, running } = await startFramedJob(h.repository);
      await tick(600);
      h.simulator.yankCable();
      await tick(20);
      await drive(running);
      const capsule = await expectCapsuleFor(h.repository, runId);
      const artifact = capsule.artifact as ExecutionArtifactV1;
      expect(capsule.ackedLines).toBeGreaterThan(0);
      expect(capsule.ackedLines).toBeLessThan(capsule.sendableLines);
      expect(savedWorkOffsetMm(artifact)).toMatchObject(ORIGIN);

      // The reboot: machine zero where it was (the first controller also
      // started there), no G92 origin.
      h.simulator = await connectSimulator();
      expect(useLaserStore.getState().workOriginActive).toBe(false);
      vi.mocked(jobAwareAlert).mockClear();
      expect(await drive(runLaserRecoveryCapsuleFlow(capsule, h.repository))).toBe(false);
      const refusal = String(vi.mocked(jobAwareAlert).mock.calls[0]?.[0]);
      expect(refusal).toContain('no longer has the work origin this job ran with');
      expect(refusal).toContain('X 20, Y 30 mm from machine zero');
      expect(refusal).toContain('Restore saved origin');
      expect(refusal).not.toContain(USER_ORIGIN_REQUIRED_MESSAGE);

      const before = h.simulator.outbound().length;
      await drive(useLaserStore.getState().restoreWorkOrigin(ORIGIN));
      expect(programLines(h.simulator, before)).toContain('G54 G21 G92 X-20.000 Y-30.000');
      expect(totalWco(h.simulator.state())).toMatchObject(ORIGIN);
      expect(useLaserStore.getState().workOriginActive).toBe(true);
      expect(h.simulator.state().mpos).toMatchObject({ x: 0, y: 0 });

      vi.mocked(jobAwareAlert).mockClear();
      expect(await drive(runLaserRecoveryCapsuleFlow(capsule, h.repository))).toBe(true);
      expect(jobAwareAlert).not.toHaveBeenCalled();
      await tick(8_000);
      expect(useLaserStore.getState().streamer).toBeNull();
      // The resumed program ends where the original does, in the saved frame.
      const end = lastProgramPoint(artifact.gcode);
      expect(h.simulator.state().mpos.x).toBeCloseTo(end.x + ORIGIN.x, 3);
      expect(h.simulator.state().mpos.y).toBeCloseTo(end.y + ORIGIN.y, 3);
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
