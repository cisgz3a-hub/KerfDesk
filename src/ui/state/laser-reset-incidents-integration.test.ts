import { describe, expect, it, vi } from 'vitest';
import {
  connect,
  flush,
  installResetOwnershipFixtureHooks,
} from './laser-reset-response.test-support';
import { useLaserStore } from './laser-store';
import { startTestLaserJob } from './laser-test-start-helpers';

installResetOwnershipFixtureHooks();

const GCODE = Array.from({ length: 40 }, (_, index) => `G1 X${index + 1} F600 S100`).join('\n');

function resetIncidents() {
  return (useLaserStore.getState().incidentHistory ?? []).filter((entry) =>
    entry.raw.startsWith('[lf2] Controller reset '),
  );
}

describe('owned reset integration retains deadline diagnostics', () => {
  it('retains the reset-write deadline with original run facts after late acceptance, traffic and reconnect', async () => {
    const f = await connect();
    await startTestLaserJob(GCODE, { runId: 'retained-reset-deadline' });
    const previous = useLaserStore.getState();
    expect(previous.streamer?.total).toBe(40);
    expect(previous.streamer?.inFlight.length).toBeGreaterThan(0);
    f.controls.reset = 'hung';
    const abort = useLaserStore.getState().stopJob();
    const rejected = expect(abort).rejects.toThrow(
      'Serial write timed out during controller reset',
    );
    await flush();
    await vi.advanceTimersByTimeAsync(500);
    await rejected;
    await flush();
    const incidents = resetIncidents();
    expect(incidents).toHaveLength(2);
    expect(incidents.map((entry) => entry.raw)).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          'Controller reset information failed: The controller reset was not confirmed.',
        ),
        '[lf2] Controller reset write failed: Serial write timed out during controller reset.',
      ]),
    );
    const incident = incidents.find((entry) =>
      entry.raw.startsWith('[lf2] Controller reset write failed:'),
    );
    expect(incident).toMatchObject({
      incident: true,
      raw: '[lf2] Controller reset write failed: Serial write timed out during controller reset.',
      incidentContext: {
        controller: { connection: 'connected' },
        run: {
          id: 'retained-reset-deadline',
          streamerEpoch: previous.streamerEpoch,
          total: previous.streamer?.total,
          inFlightLines: previous.streamer?.inFlight.length,
        },
      },
    });
    const capturedContext = incident?.incidentContext;
    expect(capturedContext).toBeDefined();
    f.completeReset();
    await flush();
    for (let index = 0; index < 600; index++) f.emit('ok');
    f.status();
    await flush();
    expect(resetIncidents()).toEqual(incidents);
    f.drop();
    await flush();
    await connect();
    expect(resetIncidents()).toEqual(incidents);
    expect(resetIncidents().find((entry) => entry.id === incident?.id)?.incidentContext).toBe(
      capturedContext,
    );
    expect(useLaserStore.getState().controllerSessionEpoch).not.toBe(
      capturedContext?.controller.sessionEpoch,
    );
  });

  it('retains an unconfirmed reset boundary once while keeping response ownership fenced', async () => {
    const f = await connect();
    await startTestLaserJob(GCODE, { runId: 'retained-reset-boundary' });
    await useLaserStore.getState().stopJob();
    await vi.advanceTimersByTimeAsync(2100);
    await flush();
    const incidents = resetIncidents();
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({
      raw: expect.stringContaining(
        'Controller reset information failed: The controller reset was not confirmed.',
      ),
      incidentContext: { run: { id: 'retained-reset-boundary' } },
    });
    expect(useLaserStore.getState().controllerQualification.kind).toBe('failed');
    expect(useLaserStore.getState().controllerOperation).toMatchObject({
      kind: 'recovery',
      phase: 'reset',
    });
    expect(f.writes).not.toContain('$$\n');
    await vi.advanceTimersByTimeAsync(3000);
    await flush();
    expect(resetIncidents()).toEqual(incidents);
  });

  it('does not retain a stale reset timeout after its controller connection has been replaced', async () => {
    const f = await connect();
    await startTestLaserJob(GCODE, { runId: 'retired-reset' });
    f.controls.reset = 'hung';
    const abort = useLaserStore.getState().stopJob();
    const outcome = abort.then(
      () => ({ kind: 'resolved' as const }),
      (error: unknown) => ({ kind: 'rejected' as const, error }),
    );
    await flush();
    f.drop();
    await flush();
    await connect();
    await vi.advanceTimersByTimeAsync(500);
    expect(await outcome).toEqual({ kind: 'resolved' });
    await flush();
    expect(resetIncidents()).toEqual([]);
    expect(useLaserStore.getState().connection.kind).toBe('connected');
    expect(useLaserStore.getState().controllerQualification.kind).toBe('qualified');
    f.completeReset();
    await flush();
    expect(resetIncidents()).toEqual([]);
  });
});
