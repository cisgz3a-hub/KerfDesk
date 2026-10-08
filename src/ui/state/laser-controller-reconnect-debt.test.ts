import { describe, expect, it, vi } from 'vitest';
import {
  connect,
  flush,
  installResetOwnershipFixtureHooks,
} from './laser-reset-response.test-support';
import { useLaserStore } from './laser-store';
import { startTestLaserJob } from './laser-test-start-helpers';

installResetOwnershipFixtureHooks();

describe('explicit Reconnect after bounded cleanup reply debt', () => {
  it('closes the old port, qualifies a new connection and excludes old replies', async () => {
    const old = await connect();
    await startTestLaserJob('G1 X1 S100\nG1 X2 S100');
    const jobWrites = old.writes.filter((line) => line.includes('G1 X'));
    old.controls.cleanupAck = false;
    await useLaserStore.getState().stopJob();
    old.emit('Grbl 1.1f');
    old.status();
    await flush();
    await vi.advanceTimersByTimeAsync(9_000);
    expect(useLaserStore.getState().controllerQualification.kind).toBe('failed');
    expect(useLaserStore.getState().getControllerReconnectRecommended()).toBe(true);
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(2);
    const retained = (useLaserStore.getState().incidentHistory ?? []).filter((entry) =>
      entry.raw.startsWith('[lf2] Controller information refresh timed out:'),
    );
    expect(retained).toHaveLength(1);
    expect(retained[0]).toMatchObject({
      incident: true,
      incidentContext: { run: { pendingUntrackedAcks: 2 } },
    });
    const recordedContext = retained[0]?.incidentContext;
    expect(recordedContext).toBeDefined();
    await vi.advanceTimersByTimeAsync(1000);
    expect(
      (useLaserStore.getState().incidentHistory ?? []).filter((entry) =>
        entry.raw.startsWith('[lf2] Controller information refresh timed out:'),
      ),
    ).toEqual(retained);

    const reconnect = connect();
    await flush();
    old.emit('Grbl 1.1f');
    await flush();
    const replacement = await reconnect;
    const epoch = useLaserStore.getState().controllerSessionEpoch;
    expect(old.close).toHaveBeenCalledOnce();
    expect(replacement.close).not.toHaveBeenCalled();
    expect(useLaserStore.getState().controllerQualification.kind).toBe('qualified');
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);
    expect(useLaserStore.getState().getControllerReconnectRecommended()).toBe(false);
    expect(useLaserStore.getState().controllerSettingsObservation?.sessionEpoch).toBe(epoch);
    old.emit('ok');
    old.status();
    await flush();
    expect(useLaserStore.getState().controllerSessionEpoch).toBe(epoch);
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);
    expect(useLaserStore.getState().controllerQualification.kind).toBe('qualified');
    expect(old.writes.filter((line) => line.includes('G1 X'))).toEqual(jobWrites);
    expect(useLaserStore.getState().incidentHistory).toEqual(expect.arrayContaining(retained));
    expect(
      useLaserStore.getState().incidentHistory?.find((entry) => entry.id === retained[0]?.id)
        ?.incidentContext,
    ).toBe(recordedContext);
  });
});
