// Probe preflight on controllers that report feed only (`F:` instead of
// `FS:`): GRBL 1.1 built without VARIABLE_SPINDLE, grblHAL with an on/off
// spindle. Their spindle speed is never reported, but `A:` rides with `Ov:`
// and names S/C while the spindle turns (gnea/grbl and grblHAL report.c), so
// an Ov frame without A:S/A:C proves the spindle is off. The oracle is the
// wire: a qualified probe cycle starts by writing M5.

import { afterEach, describe, expect, it } from 'vitest';
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
    accessoryCache: null,
    workZZeroEvidence: null,
    workZReferenceEpoch: 0,
  });
});

async function probeAfterStatus(statusLines: ReadonlyArray<string>): Promise<{
  readonly writes: ReadonlyArray<string>;
  readonly outcome: unknown;
}> {
  const writes: string[] = [];
  const connection = makeConnection(async (data) => {
    writes.push(data);
  });
  await connectWith(connection);
  for (const line of statusLines) connection.emitLine(line);
  await flush();
  writes.length = 0;
  let outcome: unknown = 'pending';
  void useLaserStore
    .getState()
    .probe(Z_REQUEST)
    .then((result) => {
      outcome = result;
    });
  await flush();
  return { writes: [...writes], outcome };
}

describe('probe preflight with feed-only (F:) status reports', () => {
  it.each([
    ['an Ov: frame without A:', '<Idle|MPos:0.000,0.000,5.000|F:0|Ov:100,100,100>'],
    ['an explicit empty A: (grblHAL after a switch-off)', '<Idle|MPos:0.000,0.000,5.000|F:0|Ov:100,100,100|A:>'],
    ['coolant only (M9 leads the probe cycle)', '<Idle|MPos:0.000,0.000,5.000|F:0|Ov:100,100,100|A:F>'],
  ])('starts the probe cycle when %s proves the spindle off', async (_label, proof) => {
    const { writes, outcome } = await probeAfterStatus([
      proof,
      '<Idle|MPos:0.000,0.000,5.000|F:0>',
    ]);
    expect(outcome).toBe('pending');
    expect(writes[0]).toBe('M5\n');
  });

  it('refuses while the accessory report shows the spindle turning', async () => {
    const { writes, outcome } = await probeAfterStatus([
      '<Idle|MPos:0.000,0.000,5.000|F:0|Ov:100,100,100|A:S>',
      '<Idle|MPos:0.000,0.000,5.000|F:0>',
    ]);
    expect(outcome).toEqual({ kind: 'preflight-failed', reason: 'Spindle must be off before probing.' });
    expect(writes).toEqual([]);
  });

  it('refuses, naming the missing evidence, before any accessory report arrives', async () => {
    const { writes, outcome } = await probeAfterStatus(['<Idle|MPos:0.000,0.000,5.000|F:0>']);
    expect(outcome).toMatchObject({
      kind: 'preflight-failed',
      reason: expect.stringMatching(/FS: spindle speed of 0, or an Ov: override field/),
    });
    expect(writes).toEqual([]);
  });

  it('keeps refusing a nonzero FS: spindle speed regardless of the accessory cache', async () => {
    const { writes, outcome } = await probeAfterStatus([
      '<Idle|MPos:0.000,0.000,5.000|FS:0,0|Ov:100,100,100>',
      '<Idle|MPos:0.000,0.000,5.000|FS:0,12000>',
    ]);
    expect(outcome).toEqual({ kind: 'preflight-failed', reason: 'Spindle must be off before probing.' });
    expect(writes).toEqual([]);
  });
});
