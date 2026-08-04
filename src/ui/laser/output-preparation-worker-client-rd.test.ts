import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../../core/scene';
import { isCanvasCompilationBridgeConnection } from '../workspace/canvas-compilation-worker-protocol';
import {
  prepareRdOutputOffThread,
  resetOutputPreparationWorkerForTests,
} from './output-preparation-worker-client';
import type {
  OutputPreparationEnvelope,
  OutputPreparationResult,
} from './output-preparation-protocol';

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent<OutputPreparationResult>) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  posted: OutputPreparationEnvelope[] = [];
  terminated = false;

  constructor() {
    FakeWorker.instances.push(this);
  }

  postMessage(message: unknown): void {
    if (!isCanvasCompilationBridgeConnection(message)) {
      this.posted.push(message as OutputPreparationEnvelope);
    }
  }

  terminate(): void {
    this.terminated = true;
  }
}

beforeEach(() => {
  resetOutputPreparationWorkerForTests();
  FakeWorker.instances = [];
  vi.stubGlobal('Worker', FakeWorker);
});

afterEach(() => {
  resetOutputPreparationWorkerForTests();
  vi.unstubAllGlobals();
});

describe('Ruida output preparation worker client', () => {
  it('sends and resolves the typed rd request/result', async () => {
    const pending = prepareRdOutputOffThread({
      kind: 'rd',
      project: createProject(),
      options: {},
    });
    if (pending === null) throw new Error('worker unavailable');
    const worker = FakeWorker.instances[0];
    const envelope = worker?.posted[0];
    if (worker === undefined || envelope === undefined) throw new Error('request not posted');
    expect(envelope.request.kind).toBe('rd');

    worker.onmessage?.({
      data: {
        requestId: envelope.requestId,
        response: {
          kind: 'rd',
          result: { ok: true, bytes: new Uint8Array([7, 8]), advisories: [] },
        },
      },
    } as unknown as MessageEvent<OutputPreparationResult>);

    await expect(pending).resolves.toEqual({
      ok: true,
      bytes: new Uint8Array([7, 8]),
      advisories: [],
    });
  });
});
