import { describe, expect, it } from 'vitest';
import type { VectorSceneObject } from '../../core/geometry';
import { offsetShapes, type OffsetShapesOptions } from '../../core/geometry/offset-shapes';
import { unpackSceneObjectsMessage } from '../packed-scene-objects-transfer';
import { createVectorOpSession } from './vector-op-worker-client';
import type { VectorOpRequest, VectorOpResponse, VectorOpTask } from './vector-op-worker-protocol';
import { vectorOpResponse } from './vector-op-worker-runtime';
import { parityObjects } from './vector-op-worker.test-fixture';

// Answers like the real worker, but only when the test delivers the reply.
class FakeWorker {
  onmessage: ((event: MessageEvent<VectorOpResponse>) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  readonly requests: VectorOpRequest[] = [];
  terminated = false;
  private sources: ReadonlyArray<VectorSceneObject> = [];

  postMessage(request: VectorOpRequest, transfer: Transferable[] = []): void {
    const received = structuredClone(request, { transfer });
    if (received.sources !== undefined) this.sources = unpackSceneObjectsMessage(received.sources);
    this.requests.push(received);
  }

  reply(index = this.requests.length - 1): void {
    const request = this.requests[index];
    if (request === undefined) throw new Error('no request to answer');
    const { response, transfer } = vectorOpResponse(request.id, this.sources, request.task);
    this.onmessage?.({
      data: structuredClone(response, { transfer }),
    } as MessageEvent<VectorOpResponse>);
  }

  send(response: VectorOpResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<VectorOpResponse>);
  }

  terminate(): void {
    this.terminated = true;
  }
}

function harness() {
  const workers: FakeWorker[] = [];
  const session = createVectorOpSession(() => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker as unknown as Worker;
  });
  return { session, workers };
}

const IDS = { outward: 'offset-paths', inward: 'offset-inward-paths' };
const options = (distanceMm: number): OffsetShapesOptions => ({
  distanceMm,
  direction: 'outward',
  cornerStyle: 'round',
  outerShapesOnly: false,
});
const offset = (distanceMm: number): VectorOpTask => ({
  kind: 'offset-shapes',
  options: options(distanceMm),
  ids: IDS,
});

describe('vector worker session (ADR-606)', () => {
  it('posts the selection once and then only the options', async () => {
    const { session, workers } = harness();
    const sources = parityObjects();
    const first = session.run(sources, offset(1));
    workers[0]!.reply();
    await expect(first).resolves.toMatchObject({ kind: 'done' });
    const second = session.run(sources, offset(2));
    workers[0]!.reply();
    const outcome = await second;
    expect(workers).toHaveLength(1);
    expect(workers[0]!.requests[0]!.sources).toBeDefined();
    expect(workers[0]!.requests[1]!.sources).toBeUndefined();
    expect(outcome).toStrictEqual({ kind: 'done', result: offsetShapes(sources, options(2), IDS) });
  });

  it('terminates busy work when a newer request supersedes it', async () => {
    const { session, workers } = harness();
    const sources = parityObjects();
    const stale = session.run(sources, offset(1));
    const fresh = session.run(sources, offset(2));
    await expect(stale).resolves.toStrictEqual({ kind: 'superseded' });
    expect(workers[0]!.terminated).toBe(true);
    expect(workers[0]!.onmessage).toBeNull();
    expect(workers[1]!.requests[0]!.sources).toBeDefined();
    workers[1]!.reply();
    await expect(fresh).resolves.toMatchObject({ kind: 'done' });
  });

  it('ignores a reply for an older request id', async () => {
    const { session, workers } = harness();
    const sources = parityObjects();
    const first = session.run(sources, offset(1));
    workers[0]!.reply();
    await first;
    const pending = session.run(sources, offset(2));
    workers[0]!.reply(0);
    workers[0]!.send({ id: 99, kind: 'fatal', message: 'stale' });
    workers[0]!.reply(1);
    await expect(pending).resolves.toMatchObject({ kind: 'done' });
  });

  it('release cancels running work and the next run starts a fresh worker', async () => {
    const { session, workers } = harness();
    const sources = parityObjects();
    const running = session.run(sources, offset(1));
    session.release();
    await expect(running).resolves.toStrictEqual({ kind: 'superseded' });
    expect(workers[0]!.terminated).toBe(true);
    const next = session.run(sources, offset(1));
    expect(workers[1]!.requests[0]!.sources).toBeDefined();
    workers[1]!.reply();
    await expect(next).resolves.toMatchObject({ kind: 'done' });
  });

  it('reports a failed task as unavailable and keeps the healthy worker', async () => {
    const { session, workers } = harness();
    const sources = parityObjects();
    const failed = session.run(sources, offset(1));
    workers[0]!.send({ id: 1, kind: 'fatal', message: 'Out of memory.' });
    await expect(failed).resolves.toStrictEqual({ kind: 'unavailable', message: 'Out of memory.' });
    const next = session.run(sources, offset(1));
    expect(workers).toHaveLength(1);
    expect(workers[0]!.requests[1]!.sources).toBeUndefined();
    workers[0]!.reply();
    await expect(next).resolves.toMatchObject({ kind: 'done' });
  });

  it('retires a worker that errors', async () => {
    const { session, workers } = harness();
    const running = session.run(parityObjects(), offset(1));
    workers[0]!.onerror?.();
    await expect(running).resolves.toMatchObject({ kind: 'unavailable' });
    expect(workers[0]!.terminated).toBe(true);
  });

  it('computes in process only where no Worker runtime exists (Vitest)', async () => {
    const session = createVectorOpSession(() => null);
    const sources = parityObjects();
    await expect(session.run(sources, offset(1))).resolves.toMatchObject({ kind: 'done' });
  });
});
