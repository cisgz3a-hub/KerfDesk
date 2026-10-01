import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { grblDriver } from '../../core/controllers';
import { useStore } from '../state';
import { LASER_START_OVERRIDE_RESET } from '../state/laser-start-override-reset';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import type { FakeConnection } from '../state/laser-store-motion-operation.test-support';
import { resetStore } from '../state/test-helpers';
import { installAutoJobReview, useJobReviewStore } from './job-review';
import {
  installResetBoundaryState,
  resetBoundaryRecoveryFixture,
} from './reset-before-program-recovery.test-support';
import { installConnectedFramedRun } from './start-job-framed-permit-claim.test-support';
import { runStartJobFlow } from './start-job-flow';

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
}));

const originalStartJob = useLaserStore.getState().startJob;
const IDLE = '<Idle|MPos:0.000,0.000,0.000|WCO:0.000,0.000,0.000|FS:0,0|Ov:100,100,100>';
let uninstallReview = (): void => undefined;

beforeEach(() => {
  localStorage.clear();
  resetStore();
  installResetBoundaryState();
  uninstallReview = installAutoJobReview('confirm');
});

afterEach(async () => {
  uninstallReview();
  useJobReviewStore.getState().close();
  await useLaserStore.getState().disconnect();
  useLaserStore.setState({ ...initialLaserState(), startJob: originalStartJob });
  vi.restoreAllMocks();
});

describe('ordinary reset-only Start preserves older execution ownership', () => {
  it.each(['interrupted', 'completed'] as const)(
    'keeps the %s source without attempting program bytes and quarantines the failed port',
    async (previousKind) => {
      const { project, artifact, repository } = await resetBoundaryRecoveryFixture();
      if (previousKind === 'completed') {
        await repository.activateFreshRun(artifact.runId);
        await repository.completeRun(artifact.runId);
      }
      const before = repository.getSnapshot();
      useStore.setState({ project, jobPlacement: { startFrom: 'absolute', anchor: 'front-left' } });
      const writes: string[] = [];
      const port: { connection?: FakeConnection } = {};
      const connected = await installConnectedFramedRun(async (data) => {
        writes.push(data);
        if (data === LASER_START_OVERRIDE_RESET) throw new Error('Reset transport rejected.');
        // The required stamp follows the status write's resolution; answer on
        // the next task, not inside that write's own promise continuations.
        if (data === '?') setTimeout(() => port.connection?.emitLine(IDLE), 0);
        if (data === grblDriver.realtime.softReset)
          queueMicrotask(() => port.connection?.emitLine('Grbl 1.1f'));
        if (data === 'M5\n' || data === 'M9\n')
          queueMicrotask(() => port.connection?.emitLine('ok'));
      });
      const connection = connected.connection;
      port.connection = connection;
      const close = vi.spyOn(connection, 'close');
      const stage = vi.spyOn(repository, 'stageArtifact');
      writes.length = 0;

      await runStartJobFlow(repository);

      expect(writes.filter((data) => data !== '?').slice(0, 2)).toEqual([
        `${grblDriver.commands.settleDwell}\n`,
        LASER_START_OVERRIDE_RESET,
      ]);
      expect(writes).not.toContain('G21\n');
      expect(writes.join('')).not.toMatch(/G1\s|M[34]\s/);
      expect(stage).not.toHaveBeenCalled();
      expect(repository.getSnapshot().recoveryCapsule).toEqual(before.recoveryCapsule);
      expect(repository.getSnapshot().lastCompletedReceipt).toEqual(before.lastCompletedReceipt);
      expect(repository.getSnapshot().executionHistory).toEqual(before.executionHistory);
      expect(repository.getSnapshot().pendingStart).toBeNull();
      expect(repository.getSnapshot().activeRun).toBeNull();
      await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
      expect(useLaserStore.getState().connection.kind).toBe('disconnected');
      expect(useLaserStore.getState().safetyNotice?.kind).toBe('write-failed');
    },
  );
});
