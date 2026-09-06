import { expect, it } from 'vitest';
import { grblDriver } from '../../core/controllers';
import { parseStatusReport } from '../../core/controllers/grbl';
import {
  cancelFreshControllerStatusWait,
  observeFreshControllerStatus,
  waitForFreshControllerStatus,
} from './laser-controller-status-wait';
import { startMotionOperation } from './laser-motion-operation';
import { settleOwnedMotionPhase } from './laser-owned-motion-settlement';
import { useLaserStore, type LiveRefs } from './laser-store';

it('does not let a superseded safe-Z phase reject a newly installed status confirmation', async () => {
  const operation = startMotionOperation('jog');
  const state = {
    ...useLaserStore.getState(),
    motionOperation: operation,
    pendingUntrackedAcks: 0,
    pendingTransportWrites: 0,
  };
  const refs = { driver: grblDriver, controllerStatusWait: null } as LiveRefs;
  let releaseOldQuery!: () => void;
  const phase = settleOwnedMotionPhase(
    () => state,
    refs,
    async () => {
      await new Promise<void>((resolve) => {
        releaseOldQuery = resolve;
      });
    },
    operation.operationId,
    'CNC safe-Z retract',
  ).catch((error: unknown) => error);
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
  expect(refs.controllerStatusWait).not.toBeNull();

  // Superseding the old proof rejects its promise, but its async catch has
  // not run yet. A new owner may install its waiter in this same turn.
  cancelFreshControllerStatusWait(refs, 'Motion settlement was superseded by Cancel.');
  const replacement = waitForFreshControllerStatus(refs, {
    after: { sessionEpoch: state.controllerSessionEpoch, sequence: state.statusSequence },
    accept: (report) => report.state === 'Idle',
    timeoutMessage: 'Replacement Idle was not confirmed.',
  }).catch((error: unknown) => error);
  const replacementWait = refs.controllerStatusWait;
  try {
    expect(await phase).toBeInstanceOf(Error);
    expect(refs.controllerStatusWait).toBe(replacementWait);
    const report = parseStatusReport('<Idle|MPos:0.000,0.000,3.810|FS:0,0>');
    if (report === null) throw new Error('Invalid test Idle report.');
    observeFreshControllerStatus(
      refs,
      { sessionEpoch: state.controllerSessionEpoch, sequence: state.statusSequence + 1 },
      report,
    );
    await expect(replacement).resolves.toEqual(report);
  } finally {
    releaseOldQuery();
    cancelFreshControllerStatusWait(refs, 'Test complete.');
  }
});
