// A route already in columnar buffers crosses the ADR-244 boundary as one
// message whose buffers are transferred, not as thousands of acknowledged
// chunks of cloned step objects. Nothing else about the preparation changes,
// and a route that could not be packed keeps the chunk protocol.

import { describe, expect, it } from 'vitest';
import type { ToolpathStep } from '../../core/job';
import { packedToolpathSteps } from '../../core/job/packed-toolpath-steps';
import type { LargeJobPreparation } from './large-job-preparation';
import { PreparationTransferSender } from './preparation-transfer-sender';
import { PREPARATION_TRANSFER_STEP_CHUNK } from './preparation-transfer-protocol';
import type { PreparationWorkerResponse } from './preparation-worker-protocol';

function fillSteps(count: number): ToolpathStep[] {
  const steps: ToolpathStep[] = [];
  for (let index = 0; index < count; index += 1) {
    const y = index * 0.1;
    steps.push({ kind: 'travel', from: { x: 0, y }, to: { x: 1, y }, length: 1, motion: 'rapid' });
    steps.push({
      kind: 'cut',
      color: '#123456',
      polyline: [
        { x: 1, y },
        { x: 9, y },
      ],
      length: 8,
    });
  }
  return steps;
}

function preparationOf(steps: ToolpathStep[], packed: boolean): LargeJobPreparation {
  return {
    estimate: { kind: 'empty' },
    jobOriginOffset: { x: 2.5, y: -7.25 },
    toolpath: {
      steps: packed ? packedToolpathSteps(steps) : steps,
      totalLength: steps.reduce((sum, step) => sum + step.length, 0),
    },
  };
}

type Posted = {
  readonly response: PreparationWorkerResponse;
  readonly transfer: ReadonlyArray<ArrayBuffer> | undefined;
};

describe('packed preparation transfer', () => {
  it('sends one message whose buffers are transferred, and reads the route back', async () => {
    const steps = fillSteps(PREPARATION_TRANSFER_STEP_CHUNK);
    const posted: Posted[] = [];
    const sender = new PreparationTransferSender((response, transfer) => {
      posted.push({ response, transfer });
    });

    await sender.sendOwned(9, preparationOf(steps, true));

    expect(posted).toHaveLength(1);
    const only = posted[0];
    if (only?.response.kind !== 'packed') throw new Error('expected a packed response');
    expect(only.response.id).toBe(9);
    expect(only.response.estimate).toEqual({ kind: 'empty' });
    expect(only.response.jobOriginOffset).toEqual({ x: 2.5, y: -7.25 });
    expect(only.response.toolpath.totalLength).toBeCloseTo(steps.length * 4.5, 6);
    // Every buffer of the route is handed over, so neither side keeps a copy.
    expect(only.transfer).toHaveLength(6);
    expect(only.transfer?.every((buffer) => buffer instanceof ArrayBuffer)).toBe(true);
    expect(new Set(only.transfer).size).toBe(6);

    // The receiving side reads the same route out of those buffers.
    const received = packedToolpathSteps(steps);
    expect(received.length).toBe(steps.length);
    expect([...received]).toStrictEqual(steps);
  });

  it('keeps the acknowledged chunk protocol for a route that could not be packed', async () => {
    // Per-vertex Z has no packed column, so this route stays step objects.
    const steps: ToolpathStep[] = [
      ...fillSteps(PREPARATION_TRANSFER_STEP_CHUNK),
      {
        kind: 'cut',
        color: '#000000',
        polyline: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
        ],
        length: 1,
        zs: [0, -1],
      },
    ];
    const posted: Posted[] = [];
    const sender = new PreparationTransferSender((response, transfer) => {
      posted.push({ response, transfer });
      if (
        response.kind === 'transfer-start' ||
        response.kind === 'transfer-chunk' ||
        response.kind === 'transfer-complete'
      ) {
        const ack = { id: response.id, sequence: response.sequence, kind: 'transfer-ack' as const };
        queueMicrotask(() => sender.acceptAcknowledgement(ack));
      }
    });

    await sender.sendOwned(10, preparationOf(steps, true));

    expect(posted.some(({ response }) => response.kind === 'packed')).toBe(false);
    expect(posted[0]?.response.kind).toBe('transfer-start');
    expect(posted.at(-1)?.response.kind).toBe('transfer-complete');
    expect(posted.every(({ transfer }) => transfer === undefined)).toBe(true);
  });
});
