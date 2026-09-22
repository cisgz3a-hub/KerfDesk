// Stress characterization of ADR-341's first promise: a job interrupted by a
// cable loss is saved at exactly its acknowledged line, can be resumed from
// there after reconnecting, and only the resumed run offers a second pass.
// Cable yanks land at seeded pseudo-random moments of the real stream.

import { describe, expect, it, vi } from 'vitest';
import { jobAwareAlert } from '../state/job-aware-dialogs';
import { useLaserSecondPassUiStore } from '../state/laser-second-pass-ui-store';
import { useLaserStore } from '../state/laser-store';
import {
  drive,
  expectCapsuleFor,
  harness,
  installRecoveryStressHooks,
  mulberry32,
  recoverAndComplete,
  startFramedJob,
  STRESS_TIMEOUT_MS,
  tick,
} from './recovery-stress-testing';
import { openRetainedSecondPassSource } from './second-pass/second-pass-source';

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
}));

installRecoveryStressHooks();

describe('interrupted job recovery under randomized cable loss', () => {
  const seeds = Array.from({ length: 8 }, (_, index) => 1 + index * 7919);
  it.each(seeds)(
    'seed %i: saves the acknowledged line, resumes exactly there, then offers darkening once',
    async (seed) => {
      const random = mulberry32(seed);
      const h = await harness();
      const { runId, running } = await startFramedJob(h.repository);
      await tick(Math.floor(random() * 1_500));
      const beforeYank = useLaserStore.getState().streamer;
      if (beforeYank === null) throw new Error('Expected a live stream before the yank.');
      const completedAtYank = beforeYank.completed;
      h.simulator.yankCable();
      await tick(20);
      await drive(running);

      const capsule = await expectCapsuleFor(h.repository, runId);
      expect(capsule.interruption.kind).toBe('disconnect');
      expect(capsule.ackedLines).toBe(completedAtYank);
      expect(capsule.sendableLines).toBe(beforeYank.total);
      expect(h.repository.getSnapshot().lastCompletedReceipt?.runId).not.toBe(runId);
      expect(h.offered).not.toContain(runId);
      expect(h.promptShown()).toBe(false);

      const recoveryRunId = await recoverAndComplete(h, runId);
      expect(h.offered).toEqual([recoveryRunId]);
      expect(h.reportFailure).not.toHaveBeenCalled();
      // Painting after a recovered job offers the whole original engraving.
      const source = await openRetainedSecondPassSource(recoveryRunId, h.repository);
      expect(source.runId).toBe(runId);
    },
    STRESS_TIMEOUT_MS,
  );

  it(
    'treats a cable loss during post-job settle as an interruption, not a completion',
    async () => {
      const h = await harness();
      const { runId, running } = await startFramedJob(h.repository);
      for (let step = 0; step < 2_000; step += 1) {
        const state = useLaserStore.getState();
        if (
          state.streamer?.status === 'done' &&
          state.controllerOperation?.kind === 'post-job-settle'
        )
          break;
        await tick(5);
      }
      const state = useLaserStore.getState();
      expect(state.streamer?.status).toBe('done');
      expect(state.controllerOperation?.kind).toBe('post-job-settle');
      const total = state.streamer?.total ?? 0;
      h.simulator.yankCable();
      await tick(20);
      await drive(running);

      const capsule = await expectCapsuleFor(h.repository, runId);
      expect(capsule.ackedLines).toBe(total);
      expect(capsule.interruption.kind).toBe('disconnect');
      expect(h.repository.getSnapshot().lastCompletedReceipt).toBeNull();
      expect(h.offered).toEqual([]);
      expect(h.promptShown()).toBe(false);
      expect(h.reportFailure).not.toHaveBeenCalled();
    },
    STRESS_TIMEOUT_MS,
  );

  it(
    'keeps a completion that settled just before the cable was pulled',
    async () => {
      const h = await harness();
      const { runId, running } = await startFramedJob(h.repository);
      for (let step = 0; step < 4_000; step += 1) {
        if (useLaserStore.getState().streamer === null) break;
        await tick(5);
      }
      expect(useLaserStore.getState().streamer).toBeNull();
      h.simulator.yankCable();
      await tick(20);
      await drive(running);
      await vi.waitFor(() =>
        expect(h.repository.getSnapshot().lastCompletedReceipt?.runId).toBe(runId),
      );
      expect(h.repository.getSnapshot().recoveryCapsule).toBeNull();
      expect(h.offered).toEqual([runId]);
      // A disconnected idle machine is not mid-command, so the offer shows.
      await tick(50);
      expect(h.promptShown()).toBe(true);
      expect(h.reportFailure).not.toHaveBeenCalled();
    },
    STRESS_TIMEOUT_MS,
  );

  it(
    'survives five interrupt-recover-complete cycles in one session without leaking state',
    async () => {
      const random = mulberry32(424242);
      const h = await harness();
      const recovered: string[] = [];
      for (let cycle = 0; cycle < 5; cycle += 1) {
        const previous = recovered.at(-1);
        if (previous !== undefined)
          await tick(0).then(() =>
            useLaserSecondPassUiStore.getState().dismissCompletion(previous),
          );
        const { runId, running } = await startFramedJob(h.repository);
        await tick(100 + Math.floor(random() * 1_200));
        const completedAtYank = useLaserStore.getState().streamer?.completed ?? -1;
        h.simulator.yankCable();
        await tick(20);
        await drive(running);
        const capsule = await expectCapsuleFor(h.repository, runId);
        expect(capsule.ackedLines).toBe(completedAtYank);
        recovered.push(await recoverAndComplete(h, runId));
        expect(h.offered).toEqual(recovered);
        const history = h.repository.getSnapshot().executionHistory;
        expect(history.filter((record) => record.terminalKind === 'completed')).toHaveLength(
          cycle + 1,
        );
        expect(h.repository.getSnapshot().pendingStart).toBeNull();
        expect(h.repository.getSnapshot().recoveryCapsule).toBeNull();
        // The next cycle starts on the controller the recovery just finished on.
      }
      expect(h.reportFailure).not.toHaveBeenCalled();
      expect(jobAwareAlert).not.toHaveBeenCalled();
    },
    STRESS_TIMEOUT_MS,
  );
});
