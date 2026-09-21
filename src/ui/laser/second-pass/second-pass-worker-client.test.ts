import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SecondPassWorkerClient } from './second-pass-worker-client';
import type { LaserSecondPassSelection } from '../../../core/laser-second-pass';
import { createCurrentTestExecutionArtifact } from '../../state/recovery/testing/execution-artifact-test-fixture';

class WorkerHarness {
  static instances: WorkerHarness[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  posted: { id: number }[] = [];
  terminated = false;
  constructor() {
    WorkerHarness.instances.push(this);
  }
  postMessage(value: { id: number }): void {
    this.posted.push(value);
  }
  terminate(): void {
    this.terminated = true;
  }
}
const selection: LaserSecondPassSelection = { version: 1, maxPowerS: 1000, strokes: [] };
beforeEach(() => {
  WorkerHarness.instances = [];
  vi.stubGlobal('Worker', WorkerHarness);
});
afterEach(() => vi.unstubAllGlobals());

describe('second-pass worker ownership', () => {
  it('rejects outstanding work on close and ignores a stale response', async () => {
    const { client, worker } = await openClient();
    const pending = client.compile(selection);
    const rejection = expect(pending).rejects.toThrow(/closed/);
    const id = worker.posted.at(-1)!.id;
    client.close();
    worker.onmessage?.({ data: { id, value: 'late' } } as MessageEvent);
    await rejection;
    expect(worker.terminated).toBe(true);
    await expect(client.compile(selection)).rejects.toThrow(/closed/);
  });
  it.each(['onerror', 'onmessageerror'] as const)(
    'retires the worker on %s rather than leaving preparation pending',
    async (event) => {
      const { client, worker } = await openClient();
      const pending = client.compile(selection);
      const rejection = expect(pending).rejects.toThrow(/Reopen/);
      worker[event]?.();
      await rejection;
      expect(worker.terminated).toBe(true);
    },
  );
  it('cancels source verification when the workbench closes before opening finishes', async () => {
    const source = await createCurrentTestExecutionArtifact({ runId: 'opening-second-pass' });
    const client = new SecondPassWorkerClient();
    const pending = client.open(source);
    const rejection = expect(pending).rejects.toThrow(/closed/);
    client.close();
    await rejection;
    expect(WorkerHarness.instances[0]?.terminated).toBe(true);
  });
});

async function openClient() {
  const source = await createCurrentTestExecutionArtifact({ runId: 'verified-second-pass' });
  const client = new SecondPassWorkerClient();
  const worker = WorkerHarness.instances[0]!;
  const opened = client.open(source);
  worker.onmessage?.({
    data: {
      id: worker.posted[0]!.id,
      value: {
        segments: new Float64Array(),
        chunkBounds: new Float64Array(),
        bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      },
    },
  } as MessageEvent);
  await opened;
  return { client, worker };
}
