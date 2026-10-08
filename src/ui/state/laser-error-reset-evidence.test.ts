import { describe, expect, it, vi } from 'vitest';
import { useLaserStore } from './laser-store';
import { startTestLaserJob } from './laser-test-start-helpers';
import { currentStreamResetMayLosePosition } from './job-stop-request';
import { connect, installResetOwnershipFixtureHooks } from './laser-reset-response.test-support';

installResetOwnershipFixtureHooks();

describe('controller rejection publishes reset cause before terminal archival', () => {
  it('records possible position loss on the first errored observation before transmitting reset', async () => {
    const f = await connect();
    await startTestLaserJob('G1 X1 S100\nG1 X2 S100');
    f.writes.length = 0;
    const samples: Array<{ positionLost: boolean; resetSent: boolean; inFlight: number }> = [];
    const unsubscribe = useLaserStore.subscribe((state) => {
      if (state.streamer?.status === 'errored')
        samples.push({
          positionLost: currentStreamResetMayLosePosition(state),
          resetSent: f.writes.includes('\x18'),
          inFlight: state.streamer.inFlight.length,
        });
    });
    f.emit('error:7');
    unsubscribe();
    expect(samples[0]).toEqual({ positionLost: true, resetSent: false, inFlight: 1 });
    expect(f.writes.filter((line) => line === '\x18')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(600);
    expect(useLaserStore.getState().streamer?.status).toBe('errored');
    expect(useLaserStore.getState().controllerOperation).toMatchObject({
      kind: 'recovery',
      phase: 'reset',
    });
    expect(currentStreamResetMayLosePosition(useLaserStore.getState())).toBe(true);
  });
});
