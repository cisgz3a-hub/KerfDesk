// CNC audit v3 N5-P3-3 (ADR-398 Amendment 10): a job send that fails on a
// port that stays open is contained with a reset and a disconnect. When the
// off lines after its reset then fail too, the safety notice became "The
// software Abort command was not written" or "The disconnect command was not
// written", hiding that the job's send failed and that the reset stopped it. The real store, Frame and
// Start on the GRBL simulator; the fake port refuses every later program line.

import { describe, expect, it, vi } from 'vitest';
import { useLaserStore } from './laser-store';
import { writeFailedMessage } from './laser-safety-notice';
import {
  harness,
  installRecoveryStressHooks,
  startFramedJob,
  STRESS_TIMEOUT_MS,
  tick,
} from '../laser/recovery-stress-testing';

vi.mock('./job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
  jobAwarePrompt: vi.fn(() => null),
}));
vi.mock('./app-dialogs', () => ({ appConfirm: vi.fn(async () => true) }));

installRecoveryStressHooks();

describe('a mid-job write failure whose disconnect fails too', () => {
  it(
    "keeps the job's own notice and adds the failed off lines to it",
    async () => {
      const h = await harness();
      const { running } = await startFramedJob(h.repository);
      void running.catch(() => undefined);
      await tick(150);
      // Letters only: the realtime reset byte and `?` still go out.
      h.simulator.port.failWrites((data) => /[A-Z]/.test(data) && !data.startsWith('?'));
      await tick(10_000);
      h.simulator.port.failWrites(null);

      const notice = useLaserStore.getState().safetyNotice;
      expect(notice?.message).toContain(writeFailedMessage('stream'));
      // The reset's banner came back, so the reset is proven: only the off lines after it failed.
      expect(notice?.message).toContain(writeFailedMessage('stop-cleanup'));
      expect(notice?.message).not.toContain('The disconnect command was not written');
      expect(notice?.message).not.toContain('The software Abort command was not written');
    },
    STRESS_TIMEOUT_MS,
  );
});
