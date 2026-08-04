import { describe, expect, it } from 'vitest';
import { BoundedCompilationBridgeClient } from './bounded-compilation-bridge-client';
import { BOUNDED_COMPILATION_BRIDGE_CHANNEL } from './bounded-compilation-bridge-protocol';
import type { BoundedCompilationBridgePort } from './bounded-compilation-bridge-protocol';
import { BoundedCompilationMainBridge } from './bounded-compilation-main-bridge';
import type {
  BoundedCompilationWorkerLike,
  BoundedCompilationWorkerRequest,
} from './bounded-compilation-worker-pool-protocol';

type Payload = { readonly value: string };
type Result = { readonly value: string };

class FakePort implements BoundedCompilationBridgePort {
  onmessage: ((event: { readonly data: unknown }) => void) | null = null;
  onmessageerror: ((event: unknown) => void) | null = null;
  peer: FakePort | null = null;
  closed = false;

  postMessage(message: unknown): void {
    if (this.closed) throw new Error('fake bridge port closed');
    this.peer?.onmessage?.({ data: message });
  }

  start(): void {
    return;
  }

  close(): void {
    this.closed = true;
    this.onmessage = null;
    this.onmessageerror = null;
  }
}

class FakeWorker implements BoundedCompilationWorkerLike<Payload> {
  onmessage: ((event: { readonly data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onmessageerror: ((event: unknown) => void) | null = null;
  current: BoundedCompilationWorkerRequest<Payload> | null = null;
  readonly posted: Array<BoundedCompilationWorkerRequest<Payload>> = [];
  terminated = false;

  constructor(private readonly harness: WorkerHarness) {}

  postMessage(message: BoundedCompilationWorkerRequest<Payload>): void {
    if (this.terminated) throw new Error('fake worker terminated');
    if (this.current !== null) throw new Error('fake worker received concurrent tasks');
    this.current = message;
    this.posted.push(message);
  }

  terminate(): void {
    if (!this.terminated) this.harness.active -= 1;
    this.terminated = true;
    this.current = null;
  }

  respond(value: string): void {
    const request = this.takeCurrent();
    this.onmessage?.({
      data: {
        kind: 'ok',
        submissionId: request.submissionId,
        jobId: request.jobId,
        taskId: request.taskId,
        result: { value },
      },
    });
  }

  runtimeError(): void {
    this.takeCurrent();
    this.onerror?.(new Error('fake worker runtime error'));
  }

  private takeCurrent(): BoundedCompilationWorkerRequest<Payload> {
    const request = this.current;
    if (request === null) throw new Error('fake worker has no active task');
    this.current = null;
    return request;
  }
}

class WorkerHarness {
  readonly workers: FakeWorker[] = [];
  active = 0;
  maximumActive = 0;
  failConstructionAt = Number.POSITIVE_INFINITY;

  create = (): FakeWorker => {
    if (this.workers.length + 1 === this.failConstructionAt) {
      throw new Error('fake worker unavailable');
    }
    const worker = new FakeWorker(this);
    this.workers.push(worker);
    this.active += 1;
    this.maximumActive = Math.max(this.maximumActive, this.active);
    return worker;
  };
}

describe('BoundedCompilationMainBridge', () => {
  it('shares two fair pool slots across independent outer-worker ports', async () => {
    const harness = new WorkerHarness();
    const bridge = createBridge(harness);
    const a = connect(bridge);
    const b = connect(bridge);
    const progress: string[] = [];

    const aResult = a.client.submit({
      jobId: 'outer-a',
      tasks: tasks('a', 3),
      onProgress: (value) => progress.push(`${value.jobId}:${value.completed}`),
    });
    const bResult = b.client.submit({ jobId: 'outer-b', tasks: tasks('b', 2) });

    expect(harness.workers).toHaveLength(2);
    expect(activeTaskIds(harness)).toEqual(['a-1', 'a-2']);
    harness.workers[1]?.respond('A2');
    expect(harness.workers[1]?.current?.taskId).toBe('a-3');
    harness.workers[0]?.respond('A1');
    expect(harness.workers[0]?.current?.taskId).toBe('b-1');
    harness.workers[1]?.respond('A3');
    expect(harness.workers[1]?.current?.taskId).toBe('b-2');
    harness.workers[1]?.respond('B2');
    harness.workers[0]?.respond('B1');

    await expect(aResult).resolves.toEqual([{ value: 'A1' }, { value: 'A2' }, { value: 'A3' }]);
    await expect(bResult).resolves.toEqual([{ value: 'B1' }, { value: 'B2' }]);
    expect(progress).toContain('outer-a:3');
    expect(harness.maximumActive).toBe(2);
    cleanup(bridge, a, b);
  });

  it('uses the bounded parallel lanes for single-task jobs', async () => {
    const harness = new WorkerHarness();
    const bridge = createBridge(harness);
    const a = connect(bridge);
    const b = connect(bridge);

    const aResult = a.client.submit({ jobId: 'single-a', tasks: tasks('a', 1) });
    const bResult = b.client.submit({ jobId: 'single-b', tasks: tasks('b', 1) });
    expect(harness.workers).toHaveLength(2);
    expect(harness.workers[0]?.current?.taskId).toBe('a-1');
    expect(harness.workers[1]?.current?.taskId).toBe('b-1');
    harness.workers[0]?.respond('A1');
    harness.workers[1]?.respond('B1');

    await expect(aResult).resolves.toEqual([{ value: 'A1' }]);
    await expect(bResult).resolves.toEqual([{ value: 'B1' }]);
    expect(harness.maximumActive).toBe(2);
    cleanup(bridge, a, b);
  });

  it('discards a partial generation and serially reruns every task after worker failure', async () => {
    const harness = new WorkerHarness();
    const bridge = createBridge(harness);
    const connection = connect(bridge);
    const phases: string[] = [];

    const result = connection.client.submit({
      jobId: 'fallback',
      tasks: tasks('f', 2),
      onProgress: (progress) => phases.push(progress.phase),
    });
    harness.workers[0]?.respond('discarded-partial');
    harness.workers[1]?.runtimeError();
    await flush();

    const serial = harness.workers[2];
    expect(serial?.current?.taskId).toBe('f-1');
    serial?.respond('F1');
    expect(serial?.current?.taskId).toBe('f-2');
    serial?.respond('F2');

    await expect(result).resolves.toEqual([{ value: 'F1' }, { value: 'F2' }]);
    expect(phases).toContain('sequential-fallback');
    expect(harness.maximumActive).toBeLessThanOrEqual(2);
    cleanup(bridge, connection);
  });

  it('rejects instead of evaluating fallback in the main realm when a dedicated worker is unavailable', async () => {
    const harness = new WorkerHarness();
    harness.failConstructionAt = 3;
    const bridge = createBridge(harness);
    const connection = connect(bridge);
    const result = connection.client.submit({ jobId: 'unavailable', tasks: tasks('u', 2) });

    harness.workers[0]?.respond('discarded');
    harness.workers[1]?.runtimeError();

    await expect(result).rejects.toThrow('fake worker unavailable');
    cleanup(bridge, connection);
  });

  it('cancels only the aborted outer job and preserves another source worker', async () => {
    const harness = new WorkerHarness();
    const bridge = createBridge(harness);
    const a = connect(bridge);
    const b = connect(bridge);
    const controller = new AbortController();
    const aResult = a.client.submit({
      jobId: 'abort-a',
      tasks: tasks('a', 3),
      signal: controller.signal,
    });
    const bResult = b.client.submit({ jobId: 'keep-b', tasks: tasks('b', 2) });

    const aWorker = workerAt(harness, 0);
    const bWorker = workerAt(harness, 1);
    aWorker.respond('A1');
    bWorker.respond('A2');
    expect(aWorker.current?.taskId).toBe('a-3');
    expect(bWorker.current?.taskId).toBe('b-1');
    controller.abort();

    await expect(aResult).rejects.toMatchObject({ name: 'AbortError' });
    expect(aWorker.terminated).toBe(true);
    expect(bWorker.terminated).toBe(false);
    const replacement = workerAt(harness, 2);
    expect(replacement.current?.taskId).toBe('b-2');
    replacement.respond('B2');
    bWorker.respond('B1');
    await expect(bResult).resolves.toEqual([{ value: 'B1' }, { value: 'B2' }]);
    cleanup(bridge, a, b);
  });

  it('ignores cancellation with a mismatched public job identity', async () => {
    const harness = new WorkerHarness();
    const bridge = createBridge(harness);
    const connection = connect(bridge);
    const result = connection.client.submit({ jobId: 'current-job', tasks: tasks('c', 2) });

    connection.clientPort.postMessage({
      channel: BOUNDED_COMPILATION_BRIDGE_CHANNEL,
      kind: 'cancel',
      requestId: 1,
      jobId: 'stale-job',
    });

    expect(harness.workers.every((worker) => !worker.terminated)).toBe(true);
    harness.workers[0]?.respond('C1');
    harness.workers[1]?.respond('C2');
    await expect(result).resolves.toEqual([{ value: 'C1' }, { value: 'C2' }]);
    cleanup(bridge, connection);
  });

  it('retires only work owned by a disconnected outer-worker port', async () => {
    const harness = new WorkerHarness();
    const bridge = createBridge(harness);
    const a = connect(bridge);
    const b = connect(bridge);
    const aResult = a.client.submit({ jobId: 'retire-a', tasks: tasks('a', 3) });
    const bResult = b.client.submit({ jobId: 'survive-b', tasks: tasks('b', 2) });

    harness.workers[0]?.respond('A1');
    harness.workers[1]?.respond('A2');
    const aWorker = harness.workers[0];
    const bWorker = harness.workers[1];
    a.detach();
    a.client.dispose(new Error('outer worker retired'));

    await expect(aResult).rejects.toThrow('outer worker retired');
    expect(aWorker?.terminated).toBe(true);
    expect(bWorker?.terminated).toBe(false);
    const replacement = harness.workers[2];
    replacement?.respond('B2');
    bWorker?.respond('B1');
    await expect(bResult).resolves.toEqual([{ value: 'B1' }, { value: 'B2' }]);
    cleanup(bridge, b);
  });

  it('rejects an exact-request response carrying the wrong public job identity', async () => {
    const [server, clientPort] = portPair();
    const client = new BoundedCompilationBridgeClient<Payload, Result>(clientPort);
    let requestId = 0;
    server.onmessage = (event) => {
      const request = event.data as { readonly kind: string; readonly requestId: number };
      if (request.kind === 'submit') requestId = request.requestId;
    };
    const result = client.submit({ jobId: 'expected', tasks: tasks('x', 2) });

    server.postMessage({
      channel: BOUNDED_COMPILATION_BRIDGE_CHANNEL,
      kind: 'result',
      requestId,
      jobId: 'wrong',
      results: [{ value: 'X1' }, { value: 'X2' }],
    });

    await expect(result).rejects.toThrow('identity mismatch');
    client.dispose();
    server.close();
  });

  it('terminally disposes on fatal response, cancels server work, and rejects later submits', async () => {
    const harness = new WorkerHarness();
    const bridge = createBridge(harness);
    const connection = connect(bridge);
    const result = connection.client.submit({ jobId: 'fatal', tasks: tasks('f', 2) });

    connection.mainPort.postMessage({
      channel: BOUNDED_COMPILATION_BRIDGE_CHANNEL,
      kind: 'fatal',
      message: 'bridge failed closed',
    });

    await expect(result).rejects.toThrow('bridge failed closed');
    expect(harness.workers.every((worker) => worker.terminated)).toBe(true);
    await expect(
      connection.client.submit({ jobId: 'after-fatal', tasks: tasks('x', 2) }),
    ).rejects.toThrow('client disposed');
    connection.detach();
    bridge.dispose();
  });

  it('terminally disposes on messageerror and cancels the matching server job', async () => {
    const harness = new WorkerHarness();
    const bridge = createBridge(harness);
    const connection = connect(bridge);
    const result = connection.client.submit({ jobId: 'messageerror', tasks: tasks('m', 2) });

    connection.clientPort.onmessageerror?.(new Error('not cloneable'));

    await expect(result).rejects.toThrow('response was not cloneable');
    expect(harness.workers.every((worker) => worker.terminated)).toBe(true);
    await expect(
      connection.client.submit({ jobId: 'after-messageerror', tasks: tasks('x', 2) }),
    ).rejects.toThrow('client disposed');
    connection.detach();
    bridge.dispose();
  });

  it('terminally disposes on an invalid response and cancels the matching server job', async () => {
    const harness = new WorkerHarness();
    const bridge = createBridge(harness);
    const connection = connect(bridge);
    const result = connection.client.submit({ jobId: 'invalid', tasks: tasks('i', 2) });

    connection.mainPort.postMessage({
      channel: BOUNDED_COMPILATION_BRIDGE_CHANNEL,
      kind: 'result',
      requestId: 'not-an-integer',
    });

    await expect(result).rejects.toThrow('invalid bounded compilation bridge response');
    expect(harness.workers.every((worker) => worker.terminated)).toBe(true);
    await expect(
      connection.client.submit({ jobId: 'after-invalid', tasks: tasks('x', 2) }),
    ).rejects.toThrow('client disposed');
    connection.detach();
    bridge.dispose();
  });

  it('dispose cancels server work, closes the client, and rejects later submits', async () => {
    const harness = new WorkerHarness();
    const bridge = createBridge(harness);
    const connection = connect(bridge);
    const result = connection.client.submit({ jobId: 'dispose', tasks: tasks('d', 2) });

    connection.client.dispose(new Error('outer worker disposed'));

    await expect(result).rejects.toThrow('outer worker disposed');
    expect(harness.workers.every((worker) => worker.terminated)).toBe(true);
    await expect(
      connection.client.submit({ jobId: 'after-dispose', tasks: tasks('x', 2) }),
    ).rejects.toThrow('client disposed');
    connection.detach();
    bridge.dispose();
  });

  it('bounds both per-client pending jobs and main-bridge global admission', async () => {
    const harness = new WorkerHarness();
    const bridge = new BoundedCompilationMainBridge<Payload, Result>({
      concurrency: 2,
      maxSources: 2,
      maxActiveJobs: 1,
      createWorker: harness.create,
    });
    const a = connect(bridge);
    const b = connect(bridge);
    const active = a.client.submit({ jobId: 'active', tasks: tasks('a', 2) });

    await expect(
      a.client.submit({ jobId: 'same-client-overflow', tasks: tasks('x', 2) }),
    ).rejects.toThrow('client is at capacity');
    await expect(
      b.client.submit({ jobId: 'global-overflow', tasks: tasks('b', 2) }),
    ).rejects.toThrow('job capacity unavailable');
    expect(harness.workers).toHaveLength(2);
    harness.workers[0]?.respond('A1');
    harness.workers[1]?.respond('A2');
    await expect(active).resolves.toEqual([{ value: 'A1' }, { value: 'A2' }]);

    const [extraMain] = portPair();
    expect(() => bridge.attach(extraMain)).toThrow('source capacity unavailable');
    cleanup(bridge, a, b);
  });
});

function createBridge(harness: WorkerHarness): BoundedCompilationMainBridge<Payload, Result> {
  return new BoundedCompilationMainBridge({
    concurrency: 2,
    maxSources: 4,
    maxActiveJobs: 4,
    createWorker: harness.create,
  });
}

function connect(bridge: BoundedCompilationMainBridge<Payload, Result>) {
  const [mainPort, clientPort] = portPair();
  const detach = bridge.attach(mainPort);
  const client = new BoundedCompilationBridgeClient<Payload, Result>(clientPort);
  return { client, detach, mainPort, clientPort };
}

function portPair(): [FakePort, FakePort] {
  const first = new FakePort();
  const second = new FakePort();
  first.peer = second;
  second.peer = first;
  return [first, second];
}

function tasks(prefix: string, count: number) {
  return Array.from({ length: count }, (_, index) => ({
    taskId: `${prefix}-${index + 1}`,
    payload: { value: `${prefix}${index + 1}` },
  }));
}

function activeTaskIds(harness: WorkerHarness): string[] {
  return harness.workers.flatMap((worker) =>
    worker.current === null ? [] : [String(worker.current.taskId)],
  );
}

function workerAt(harness: WorkerHarness, index: number): FakeWorker {
  const worker = harness.workers[index];
  if (worker === undefined) throw new Error(`fake worker ${index} was not created`);
  return worker;
}

function cleanup(
  bridge: BoundedCompilationMainBridge<Payload, Result>,
  ...connections: ReadonlyArray<ReturnType<typeof connect>>
): void {
  for (const connection of connections) {
    connection.detach();
    connection.client.dispose();
  }
  bridge.dispose();
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
