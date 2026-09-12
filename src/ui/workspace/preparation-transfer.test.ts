import { describe, expect, it } from 'vitest';
import type { ToolpathStep } from '../../core/job';
import type { LargeJobPreparation } from './large-job-preparation';
import type { PreparationWorkerResponse } from './preparation-worker-protocol';
import { PreparationTransferAssembler } from './preparation-transfer-assembler';
import { PreparationTransferSender } from './preparation-transfer-sender';
import {
  PREPARATION_TRANSFER_STEP_CHUNK,
  type PreparationTransferResponse,
} from './preparation-transfer-protocol';

const richSteps: ReadonlyArray<ToolpathStep> = [
  {
    kind: 'travel',
    from: { x: -0, y: 1 / 3 },
    to: { x: 17.12345678901234, y: -19 },
    length: Math.PI,
    motion: 'feed',
    z: { from: 3, to: 7 },
  },
  {
    kind: 'cut',
    color: '#abcdef',
    polyline: [
      { x: 1e-13, y: -8 },
      { x: 7, y: 4 },
      { x: 9, y: 12 },
    ],
    length: 27.1234567890123,
    source: {
      kind: 'raster',
      objectId: 'artwork-β',
      source: 'photo.png',
      passIndex: 2,
      rowIndex: 919,
      spanIndex: 38,
      pixelStartX: 900,
      pixelEndX: 944,
    },
    z: { from: -3, to: -4 },
    zs: [-3, -8, -4],
    groupId: 'cut-group',
    toolId: 'vee-bit',
    passIndex: 3,
  },
  { kind: 'plunge', at: { x: 6, y: 9 }, fromZ: 4, toZ: -3, length: 7, toolId: 'endmill' },
];

function fixture(withPlan: boolean): LargeJobPreparation {
  return {
    estimate: { kind: 'empty' },
    jobOriginOffset: { x: -37.25, y: 18.125 },
    toolpath: {
      totalLength: 1204738.91234567,
      steps: Array.from(
        { length: PREPARATION_TRANSFER_STEP_CHUNK + 7 },
        (_, index) => richSteps[index % richSteps.length]!,
      ),
      previewIssue: { kind: 'preparation-failed', messages: ['transport-only header fixture'] },
      ...(withPlan
        ? {
            executablePlanPreview: {
              source: 'executable-plan' as const,
              schema: 'curvedesk.executable-plan' as const,
              schemaVersion: 1 as const,
              toolpath: {
                totalLength: 123456.789,
                steps: Array.from(
                  { length: PREPARATION_TRANSFER_STEP_CHUNK + 3 },
                  (_, index) => richSteps[(index + 1) % richSteps.length]!,
                ),
              },
            },
          }
        : {}),
    },
  };
}

describe('acknowledged preparation transfer', () => {
  it('releases only acknowledged worker-owned slots while keeping the delivered records exact', async () => {
    const owned = fixture(false);
    const before = structuredClone(owned);
    const packets: PreparationWorkerResponse[] = [];
    const sender = new PreparationTransferSender((packet) => packets.push(structuredClone(packet)));
    const done = sender.sendOwned(71, owned);
    expect(owned).toEqual(before);
    sender.acceptAcknowledgement({ kind: 'transfer-ack', id: 71, sequence: 0 });
    await Promise.resolve();
    expect(packets).toHaveLength(2);
    expect(owned).toEqual(before); // The first chunk was posted, but not ACKed.
    sender.acceptAcknowledgement({ kind: 'transfer-ack', id: 71, sequence: 99 });
    await Promise.resolve();
    expect(owned).toEqual(before);
    sender.acceptAcknowledgement({ kind: 'transfer-ack', id: 71, sequence: 1 });
    await Promise.resolve();
    expect(owned.toolpath.steps.slice(0, PREPARATION_TRANSFER_STEP_CHUNK)).toEqual(
      new Array(PREPARATION_TRANSFER_STEP_CHUNK).fill(undefined),
    );
    expect(owned.toolpath.steps.slice(PREPARATION_TRANSFER_STEP_CHUNK)).toEqual(
      before.toolpath.steps.slice(PREPARATION_TRANSFER_STEP_CHUNK),
    );
    const reconstructed = await receiveClonedPackets(sender, packets);
    await done;
    expect(reconstructed).toEqual(before);
    expect(owned.toolpath.steps).toEqual(new Array(before.toolpath.steps.length).fill(undefined));
  });

  it.each([false, true])(
    'consumes distinct or aliased plan arrays without changing either delivered route (alias %s)',
    async (alias) => {
      const owned = fixture(true);
      const plan = owned.toolpath.executablePlanPreview;
      if (plan === undefined) throw new Error('missing fixture plan');
      const preparation = alias
        ? {
            ...owned,
            toolpath: {
              ...owned.toolpath,
              executablePlanPreview: {
                ...plan,
                toolpath: { ...plan.toolpath, steps: owned.toolpath.steps },
              },
            },
          }
        : owned;
      const before = structuredClone(preparation);
      const packets: PreparationWorkerResponse[] = [];
      const sender = new PreparationTransferSender((packet) =>
        packets.push(structuredClone(packet)),
      );
      const done = sender.sendOwned(71, preparation);
      expect(await receiveClonedPackets(sender, packets)).toEqual(before);
      await done;
      expect(preparation.toolpath.steps).toEqual(
        new Array(before.toolpath.steps.length).fill(undefined),
      );
      expect(preparation.toolpath.executablePlanPreview?.toolpath.steps).toEqual(
        new Array(before.toolpath.executablePlanPreview?.toolpath.steps.length).fill(undefined),
      );
    },
  );

  it.each([false, true])(
    'round-trips every numeric, source, optional and placement field (plan %s)',
    async (withPlan) => {
      const original = fixture(withPlan);
      const before = structuredClone(original);
      const packets: PreparationWorkerResponse[] = [];
      const sender = new PreparationTransferSender((packet) =>
        packets.push(structuredClone(packet)),
      );
      const done = sender.send(71, original);
      await Promise.resolve();
      expect(packets).toHaveLength(1); // The header itself requires acknowledgement.
      sender.acceptAcknowledgement({ kind: 'transfer-ack', id: 72, sequence: 0 });
      sender.acceptAcknowledgement({ kind: 'transfer-ack', id: 71, sequence: 1 });
      await Promise.resolve();
      expect(packets).toHaveLength(1);
      let assembled: LargeJobPreparation | null = null;
      let receiver: PreparationTransferAssembler | undefined;
      let index = 0;
      while (assembled === null) {
        const packet = packets[index];
        if (packet?.kind === 'transfer-start') receiver = new PreparationTransferAssembler(packet);
        else if (packet?.kind === 'transfer-chunk' || packet?.kind === 'transfer-complete') {
          if (receiver === undefined) throw new Error('missing header');
          if (packet.kind === 'transfer-chunk')
            expect(packet.steps.length).toBeLessThanOrEqual(PREPARATION_TRANSFER_STEP_CHUNK);
          assembled = receiver.accept(packet);
        } else throw new Error('unexpected response');
        await Promise.resolve();
        expect(packets).toHaveLength(index + 1); // No second packet is in flight.
        sender.acceptAcknowledgement({
          kind: 'transfer-ack',
          id: packet.id,
          sequence: packet.sequence,
        });
        await Promise.resolve();
        index += 1;
      }
      await done;
      expect(assembled).toEqual(before);
      expect(original).toEqual(before);
      expect(packets.at(-1)?.kind).toBe('transfer-complete');
      expect(packets.filter((packet) => packet.kind === 'transfer-chunk')).toHaveLength(
        withPlan ? 4 : 2,
      );
    },
  );

  it('preserves the one-message API for a small complete preparation', async () => {
    const response: LargeJobPreparation = {
      estimate: { kind: 'empty' },
      toolpath: { totalLength: 8, steps: richSteps },
    };
    const packets: PreparationWorkerResponse[] = [];
    await new PreparationTransferSender((packet) => packets.push(structuredClone(packet))).send(
      4,
      response,
    );
    expect(packets).toEqual([{ id: 4, kind: 'ok', ...response }]);
  });

  it('rejects a native send error without leaving an acknowledgement wait behind', async () => {
    let fail = true;
    const sender = new PreparationTransferSender(() => {
      if (fail) throw new Error('native clone failed');
    });
    await expect(sender.send(3, fixture(false))).rejects.toThrow('native clone failed');
    fail = false;
    await expect(
      sender.send(4, { estimate: { kind: 'empty' }, toolpath: { steps: [], totalLength: 0 } }),
    ).resolves.toBeUndefined();
  });
});

async function receiveClonedPackets(
  sender: PreparationTransferSender,
  packets: ReadonlyArray<PreparationWorkerResponse>,
): Promise<LargeJobPreparation> {
  const first = packets[0];
  if (first?.kind !== 'transfer-start') throw new Error('missing header');
  const receiver = new PreparationTransferAssembler(first);
  sender.acceptAcknowledgement({ kind: 'transfer-ack', id: first.id, sequence: first.sequence });
  await Promise.resolve();
  for (let index = 1; ; index += 1) {
    const packet = packets[index];
    if (packet?.kind !== 'transfer-chunk' && packet?.kind !== 'transfer-complete')
      throw new Error('unexpected packet');
    const result = receiver.accept(packet);
    sender.acceptAcknowledgement({
      kind: 'transfer-ack',
      id: packet.id,
      sequence: packet.sequence,
    });
    await Promise.resolve();
    if (result !== null) return result;
  }
}

const start: Extract<PreparationTransferResponse, { kind: 'transfer-start' }> = {
  id: 5,
  sequence: 0,
  kind: 'transfer-start',
  header: { estimate: { kind: 'empty' }, toolpath: { totalLength: 3 }, stepCount: 2 },
};
const chunk: Extract<PreparationTransferResponse, { kind: 'transfer-chunk' }> = {
  id: 5,
  sequence: 1,
  kind: 'transfer-chunk',
  route: 'legacy',
  offset: 0,
  steps: [richSteps[0]!],
};

describe('preparation transfer validation', () => {
  it.each([-1, 0.5, Number.NaN, 0x100000000])(
    'rejects an impossible declared count %s',
    (stepCount) => {
      expect(
        () =>
          new PreparationTransferAssembler({ ...start, header: { ...start.header, stepCount } }),
      ).toThrow('invalid preparation transfer header');
    },
  );

  it.each([
    { ...chunk, id: 6 },
    { ...chunk, sequence: 2 },
    { ...chunk, offset: 1 },
    { ...chunk, route: 'executable-plan' as const },
    { ...chunk, steps: [] },
    { ...chunk, steps: [...richSteps] },
  ])('rejects mismatched order, route, offset or count (%j)', (packet) => {
    expect(() => new PreparationTransferAssembler(start).accept(packet)).toThrow();
  });

  it('never exposes a partially filled preallocated route', () => {
    const receiver = new PreparationTransferAssembler(start);
    expect(receiver.accept(chunk)).toBeNull();
    expect(() => receiver.accept({ id: 5, sequence: 2, kind: 'transfer-complete' })).toThrow(
      'incomplete preparation transfer',
    );
  });

  it('rejects an oversized chunk even when it would fit the declared route count', () => {
    const count = PREPARATION_TRANSFER_STEP_CHUNK + 1;
    const receiver = new PreparationTransferAssembler({
      ...start,
      header: { ...start.header, stepCount: count },
    });
    expect(() =>
      receiver.accept({ ...chunk, steps: new Array<ToolpathStep>(count).fill(richSteps[0]!) }),
    ).toThrow('invalid preparation transfer chunk');
  });
});
