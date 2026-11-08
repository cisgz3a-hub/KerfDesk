// Rolling audit v10 V3-P2-1, against the GRBL simulator with the real store:
// the toolbar's Reconnect now (and step 1's reconnect, which shares the guard)
// is refused while a job runs, so the soft reset that closing the port sends
// cannot end the burn. Once the job is over the same reconnect switches the
// driver (ADR-637 Amendments 6 and 8).

import { describe, expect, it, vi } from 'vitest';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { isActiveJob } from '../state/laser-store-helpers';
import { reconnectWithSavedProfile, RECONNECT_JOB_RUNNING_REASON } from './reconnect-job-guard';
import {
  drive,
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

const SOFT_RESET = String.fromCharCode(0x18);

function saveProfileAsGrblHal(): void {
  const project = useStore.getState().project;
  useStore.setState({
    project: { ...project, device: { ...project.device, controllerKind: 'grblhal' } },
  });
}

describe('V3-P2-1: Reconnect now during a job', () => {
  it(
    'is refused while the job streams, and switches the driver once it is over',
    async () => {
      const h = await harness();
      useStore.setState({ jobPlacement: { startFrom: 'absolute', anchor: 'front-left' } });
      const { running } = await startFramedJob(h.repository);
      await tick(400);
      saveProfileAsGrblHal();
      expect(isActiveJob(useLaserStore.getState().streamer)).toBe(true);
      const before = h.simulator.outbound().length;

      await expect(drive(reconnectWithSavedProfile(h.simulator.adapter))).rejects.toThrow(
        RECONNECT_JOB_RUNNING_REASON,
      );
      // No reset reached the controller and the job keeps streaming.
      expect(h.simulator.outbound().slice(before).join('')).not.toContain(SOFT_RESET);
      expect(useLaserStore.getState()).toMatchObject({
        connection: { kind: 'connected' },
        activeControllerKind: 'grbl-v1.1',
      });
      expect(isActiveJob(useLaserStore.getState().streamer)).toBe(true);

      await drive(running, 60_000);
      for (let step = 0; step < 200 && useLaserStore.getState().streamer !== null; step += 1) {
        await tick(50);
      }
      expect(isActiveJob(useLaserStore.getState().streamer)).toBe(false);
      await drive(reconnectWithSavedProfile(h.simulator.adapter), 30_000);
      await tick(1_500);
      expect(useLaserStore.getState()).toMatchObject({
        connection: { kind: 'connected' },
        activeControllerKind: 'grblhal',
      });
    },
    STRESS_TIMEOUT_MS,
  );
});
