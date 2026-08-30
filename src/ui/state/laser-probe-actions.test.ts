import { afterEach, describe, expect, it } from 'vitest';
import { buildZProbeLines } from '../../core/controllers/grbl';
import type { ProbeRequest } from '../../core/controllers/grbl/probe';
import { useLaserStore } from './laser-store';
import { connectWith, makeConnection } from './laser-store-console.test-support';

const Z_REQUEST = {
  kind: 'z',
  params: {
    plateThicknessMm: 15,
    seekFeedMmPerMin: 150,
    probeFeedMmPerMin: 25,
    maxTravelMm: 25,
    retractMm: 5,
  },
} satisfies ProbeRequest;

async function flush(): Promise<void> {
  for (let index = 0; index < 48; index += 1) await Promise.resolve();
}

afterEach(async () => {
  if (useLaserStore.getState().connection.kind !== 'disconnected') {
    await useLaserStore.getState().disconnect();
  }
  useLaserStore.setState({
    statusReport: null,
    lastWriteError: null,
    safetyNotice: null,
    probeBusy: false,
    controllerOperation: null,
    pendingUntrackedAcks: 0,
    workZZeroEvidence: null,
    workZReferenceEpoch: 0,
  });
});

describe('laser probe wire ownership', () => {
  it('does not establish work-Z evidence when MPG takes ownership during final Idle proof', async () => {
    const writes: string[] = [];
    const connection = makeConnection(async (data) => {
      writes.push(data);
    });
    await connectWith(connection);
    writes.length = 0;

    const probe = useLaserStore.getState().probe(Z_REQUEST);
    await flush();
    const expectedSequence = ['M5', 'M9', ...buildZProbeLines(Z_REQUEST.params), 'G4 P0.01'];
    for (let index = 0; index < expectedSequence.length; index += 1) {
      expect(writes[index]).toBe(`${expectedSequence[index]}\n`);
      connection.emitLine('ok');
      await flush();
    }
    expect(useLaserStore.getState().controllerOperation).toMatchObject({
      kind: 'probe',
      phase: 'awaiting-idle',
    });

    connection.emitLine('<Idle|MPos:0.000,0.000,5.000|FS:0,0|MPG:1>');
    connection.emitLine('<Idle|MPos:0.000,0.000,5.000|FS:0,0|MPG:1>');
    await flush();

    expect(useLaserStore.getState().workZZeroEvidence).toBeNull();
    expect(writes).toContain('\x18');

    connection.emitLine('Grbl 1.1f');
    await flush();
    connection.emitLine('<Idle|MPos:0.000,0.000,5.000|FS:0,0|MPG:0>');
    connection.emitLine('<Idle|MPos:0.000,0.000,5.000|FS:0,0|MPG:0>');
    await expect(probe).resolves.toMatchObject({
      kind: 'preflight-failed',
      reason: expect.stringMatching(/MPG|pulse generator/i),
    });
    expect(useLaserStore.getState().workZZeroEvidence).toBeNull();
    expect(useLaserStore.getState().probeBusy).toBe(false);
  });
});
