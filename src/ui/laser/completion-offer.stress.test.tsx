// Stress characterization of ADR-341's second promise: a job that settles
// cleanly offers "darken selected areas" exactly once, the offer yields to the
// next run and to open dialogs, and it never appears before the controller
// has settled. Runs the real store, tracker, repository and prompt against
// the GRBL simulator.

import { describe, expect, it, vi } from 'vitest';
import { jobAwareAlert } from '../state/job-aware-dialogs';
import { useLaserSecondPassUiStore } from '../state/laser-second-pass-ui-store';
import { useLaserStore } from '../state/laser-store';
import { useUiStore } from '../state/ui-store';
import {
  drive,
  frameUntilPermit,
  harness,
  installRecoveryStressHooks,
  startFramedJob,
  STRESS_TIMEOUT_MS,
  tick,
  type StressHarness,
} from './recovery-stress-testing';
import { openRetainedSecondPassSource } from './second-pass/second-pass-source';
import { runCompletedJobAgainFlow } from './start-job-flow';

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
}));

installRecoveryStressHooks();

async function completeFramedJob(h: StressHarness): Promise<string> {
  const { runId, running } = await startFramedJob(h.repository);
  await tick(8_000);
  await drive(running);
  expect(useLaserStore.getState().streamer).toBeNull();
  await vi.waitFor(() =>
    expect(h.repository.getSnapshot().lastCompletedReceipt?.runId).toBe(runId),
  );
  await tick(50);
  return runId;
}

describe('completion offer under repeated runs', () => {
  it(
    'offers once per completion, drops the offer when the next run starts, and re-offers for that run',
    async () => {
      const h = await harness();
      const first = await completeFramedJob(h);
      expect(h.offered).toEqual([first]);
      expect(h.promptShown()).toBe(true);
      // Trailing status polls must not re-present or duplicate the prompt.
      await tick(3_000);
      expect(h.dialogCount()).toBe(1);

      const receipt = h.repository.getSnapshot().lastCompletedReceipt;
      if (receipt === null) throw new Error('Expected the first receipt.');
      // Run again needs a fresh Frame, like Start (ADR-372 Amendment 1).
      await frameUntilPermit();
      const again = runCompletedJobAgainFlow(receipt, h.repository);
      for (let step = 0; step < 600 && useLaserStore.getState().streamer === null; step += 1) {
        await tick(5);
      }
      const second = useLaserStore.getState().activeRunId;
      if (second === null || second === first) throw new Error('Expected a fresh replay run.');
      await tick(20);
      expect(h.promptShown()).toBe(false);
      expect(useLaserSecondPassUiStore.getState().completionRunId).toBeNull();
      await tick(8_000);
      await drive(again);
      await vi.waitFor(() =>
        expect(h.repository.getSnapshot().lastCompletedReceipt?.runId).toBe(second),
      );
      await tick(50);
      expect(h.offered).toEqual([first, second]);
      expect(h.promptShown()).toBe(true);
      expect(h.dialogCount()).toBe(1);

      await h.clickButton('Darken selected areas…');
      expect(useLaserSecondPassUiStore.getState().editorRequest?.runId).toBe(second);
      expect(h.promptShown()).toBe(false);
      const source = await openRetainedSecondPassSource(second, h.repository);
      expect(source.runId).toBe(second);
      expect(h.reportFailure).not.toHaveBeenCalled();
      expect(jobAwareAlert).not.toHaveBeenCalled();
    },
    STRESS_TIMEOUT_MS,
  );

  it(
    'waits behind an open modal and shows as soon as it closes, once',
    async () => {
      const h = await harness();
      useUiStore.setState({ modalDepth: 1 });
      const runId = await completeFramedJob(h);
      expect(h.offered).toEqual([runId]);
      expect(h.promptShown()).toBe(false);
      await tick(2_000);
      expect(h.promptShown()).toBe(false);
      await tick(0).then(() => useUiStore.setState({ modalDepth: 0 }));
      await tick(20);
      expect(h.promptShown()).toBe(true);
      expect(h.dialogCount()).toBe(1);
      await h.clickButton('Not now');
      expect(h.promptShown()).toBe(false);
      await tick(3_000);
      expect(h.promptShown()).toBe(false);
      expect(useLaserSecondPassUiStore.getState().lastOfferedRunId).toBe(runId);
    },
    STRESS_TIMEOUT_MS,
  );

  it(
    'never offers while the final line is merely acknowledged and the controller has not settled',
    async () => {
      const h = await harness();
      const { runId, running } = await startFramedJob(h.repository);
      for (let step = 0; step < 2_000; step += 1) {
        if (useLaserStore.getState().streamer?.status === 'done') break;
        await tick(5);
      }
      expect(useLaserStore.getState().streamer?.status).toBe('done');
      expect(h.offered).toEqual([]);
      expect(h.promptShown()).toBe(false);
      await tick(8_000);
      await drive(running);
      await vi.waitFor(() =>
        expect(h.repository.getSnapshot().lastCompletedReceipt?.runId).toBe(runId),
      );
      await tick(50);
      expect(h.offered).toEqual([runId]);
      expect(h.promptShown()).toBe(true);
    },
    STRESS_TIMEOUT_MS,
  );
});
