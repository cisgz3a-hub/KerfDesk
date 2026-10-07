import { describe, expect, it, vi } from 'vitest';
import {
  connect,
  flush,
  installResetOwnershipFixtureHooks,
} from './laser-reset-response.test-support';
import { useLaserStore } from './laser-store';
import { pendingTransportWriteCount } from './laser-start-queue-fence';
import { startTestLaserJob } from './laser-test-start-helpers';

installResetOwnershipFixtureHooks();

async function failHeldStatusTransport() {
  const f = await connect();
  await useLaserStore.getState().stopJob();
  f.emit('Grbl 1.1f');
  f.status();
  await flush();
  const epoch = useLaserStore.getState().controllerSessionEpoch;
  f.holdStatusWrites();
  const statusRequest = useLaserStore.getState().requestControllerStatus();
  await flush();
  expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);
  expect(useLaserStore.getState().pendingTransportWrites).toBeGreaterThan(0);
  expect(useLaserStore.getState().controllerOperation).toBeNull();
  const reads = f.writes.filter((write) => write === '$$\n').length;

  for (let response = 0; response < 18; response += 1) {
    f.status();
    await vi.advanceTimersByTimeAsync(500);
  }
  return { f, epoch, reads, statusRequest };
}

describe('bounded recovery while a realtime write remains in transport', () => {
  it('offers explicit Reconnect without inventing ACK debt, and resumes after actual transport settlement', async () => {
    const { f, epoch, reads, statusRequest } = await failHeldStatusTransport();
    const failed = useLaserStore.getState();
    expect(failed.statusResponseObservation).toMatchObject({ sessionEpoch: epoch });
    expect(Date.now() - (failed.statusResponseObservation?.observedAt ?? 0)).toBeLessThan(1_000);
    expect(failed.pendingUntrackedAcks).toBe(0);
    expect(failed.pendingTransportWrites).toBeGreaterThan(0);
    expect(failed.controllerQualification.kind).toBe('failed');
    const block = failed.getMachineSettingsReadBlockReason();
    expect(block).not.toBeNull();
    await expect(failed.retryControllerQualification()).rejects.toThrow(block ?? '');
    expect(f.writes.filter((write) => write === '$$\n')).toHaveLength(reads);
    const message =
      failed.controllerQualification.kind === 'failed'
        ? failed.controllerQualification.message
        : '';
    expect({ reconnect: failed.getControllerReconnectRecommended(), message }).toMatchObject({
      reconnect: true,
      message: expect.stringContaining('still in transport'),
    });
    expect(message).not.toContain('acknowledgement');

    f.settleStatusWrites();
    await statusRequest;
    await flush();
    f.status();
    await vi.advanceTimersByTimeAsync(250);
    expect(useLaserStore.getState().pendingTransportWrites).toBe(0);
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);
    expect(useLaserStore.getState().controllerQualification.kind).toBe('qualified');
    expect(useLaserStore.getState().getControllerReconnectRecommended()).toBe(false);
    expect(useLaserStore.getState().controllerSessionEpoch).toBe(epoch);
    expect(f.writes.filter((write) => write === '$$\n')).toHaveLength(reads + 1);
    expect(f.close).not.toHaveBeenCalled();
    expect(useLaserStore.getState().frameVerification).toBeNull();
  });

  it('replaces a failed held-write session and ignores its late transport settlement and replies', async () => {
    const { f: old } = await failHeldStatusTransport();
    expect(useLaserStore.getState().controllerQualification.kind).toBe('failed');
    expect(useLaserStore.getState().getControllerReconnectRecommended()).toBe(true);
    const replacing = connect();
    await flush();
    old.emit('Grbl 1.1f');
    await flush();
    const replacement = await replacing;
    const epoch = useLaserStore.getState().controllerSessionEpoch;
    expect(old.close).toHaveBeenCalledOnce();
    expect(replacement.close).not.toHaveBeenCalled();
    expect(useLaserStore.getState().controllerQualification.kind).toBe('qualified');
    expect(useLaserStore.getState().pendingTransportWrites).toBe(0);
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);
    old.settleStatusWrites();
    old.emit('ok');
    old.status();
    await flush();
    expect(useLaserStore.getState().controllerSessionEpoch).toBe(epoch);
    expect(useLaserStore.getState().pendingTransportWrites).toBe(0);
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);
    expect(useLaserStore.getState().controllerQualification.kind).toBe('qualified');
    expect(useLaserStore.getState().getControllerReconnectRecommended()).toBe(false);
  });

  it.each(['streaming', 'paused'])(
    'retains a genuine %s job with an earlier failed information read and an ordinary in-transport refill',
    async (lifecycle) => {
      const f = await connect();
      f.controls.emptySettings = true;
      await useLaserStore.getState().readMachineSettings();
      f.controls.emptySettings = false;
      expect(useLaserStore.getState().controllerQualification.kind).toBe('failed');
      const gcode = Array.from({ length: 40 }, (_, index) => `G1 X${index + 1} F600 S100`).join(
        '\n',
      );
      await startTestLaserJob(gcode);
      expect(useLaserStore.getState().controllerOperation).toBeNull();
      f.holdJobWrites();
      f.emit('ok');
      await flush();
      expect(pendingTransportWriteCount(useLaserStore.getState())).toBeGreaterThan(0);
      if (lifecycle === 'paused') {
        const pause = useLaserStore.getState().pauseJob();
        await flush();
        f.controls.state = 'Door:0';
        f.emit('<Door:0|MPos:0,0,0|FS:0,0|A:>');
        await pause;
      }
      const active = useLaserStore.getState();
      expect(active.streamer?.status).toBe(lifecycle);
      expect(active.controllerOperation).toBeNull();
      expect(active.controllerQualification.kind).toBe('failed');
      expect(pendingTransportWriteCount(active)).toBeGreaterThan(0);
      expect(active.getControllerReconnectRecommended()).toBe(false);
      expect(f.close).not.toHaveBeenCalled();
      f.settleJobWrites();
      await flush();
    },
  );
});
