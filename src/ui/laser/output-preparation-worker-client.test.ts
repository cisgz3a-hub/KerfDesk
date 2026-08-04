// Transport behaviour of the shared preparation worker: one reused instance,
// responses matched to their own request id, and active aborts replaced on a
// fresh Worker. Which projects route off-thread at all is covered by
// output-preparation-worker-client-routing.test.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../../core/scene';
import {
  prepareSaveOutputOffThread,
  resetOutputPreparationWorkerForTests,
} from './output-preparation-worker-client';
import type {
  OutputPreparationEnvelope,
  OutputPreparationResponse,
  OutputPreparationResult,
} from './output-preparation-protocol';
import { isCanvasCompilationBridgeConnection } from '../workspace/canvas-compilation-worker-protocol';

const PREPARATION_FAILURE_MESSAGE = 'The output snapshot could not be prepared.';

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent<OutputPreparationResult>) => void) | null = null;
  onerror: (() => void) | null = null;
  posted: OutputPreparationEnvelope[] = [];
  terminated = false;
  bridgeConnected = false;

  constructor() {
    FakeWorker.instances.push(this);
  }

  postMessage(envelope: unknown): void {
    if (isCanvasCompilationBridgeConnection(envelope)) {
      this.bridgeConnected = true;
      return;
    }
    this.posted.push(envelope as OutputPreparationEnvelope);
  }

  terminate(): void {
    this.terminated = true;
  }

  /** Answers the nth posted envelope (default: the most recent one). */
  respond(response: OutputPreparationResponse, postedIndex = this.posted.length - 1): void {
    const envelope = this.posted[postedIndex];
    if (envelope === undefined) throw new Error('nothing posted to respond to');
    this.onmessage?.({
      data: { requestId: envelope.requestId, response },
    } as MessageEvent<OutputPreparationResult>);
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

describe('output preparation worker client', () => {
  it('returns null without Worker support', () => {
    vi.unstubAllGlobals();
    expect(
      prepareSaveOutputOffThread({ kind: 'save', project: createProject(), options: {} }),
    ).toBeNull();
  });

  it('reuses one worker across preparations instead of spawning per request', async () => {
    await settledSave('G21\n');
    await settledSave('G90\n');

    expect(FakeWorker.instances).toHaveLength(1);
  });

  it('resolves a Save result and keeps the shared worker alive', async () => {
    const pending = prepareSaveOutputOffThread({
      kind: 'save',
      project: createProject(),
      options: {},
    });
    if (pending === null) throw new Error('worker unavailable');
    const worker = latestWorker();
    expect(worker.bridgeConnected).toBe(true);
    worker.respond({
      kind: 'save',
      result: {
        kind: 'emitted',
        gcode: 'G21\n',
        preflight: { ok: true, issues: [] },
        cncVCarveDepths: [{ layerId: 'flowing-v-layer', depthMm: 5.499 }],
      },
    });

    await expect(pending).resolves.toEqual({
      kind: 'emitted',
      gcode: 'G21\n',
      preflight: { ok: true, issues: [] },
      cncVCarveDepths: [{ layerId: 'flowing-v-layer', depthMm: 5.499 }],
    });
    expect(worker.terminated).toBe(false);
  });

  it('preserves a failed Save result and keeps the shared worker alive', async () => {
    const pending = prepareSaveOutputOffThread({
      kind: 'save',
      project: createProject(),
      options: {},
    });
    if (pending === null) throw new Error('worker unavailable');
    const worker = latestWorker();
    worker.respond({
      kind: 'save',
      result: {
        kind: 'preparation-failed',
        gcode: '',
        preflight: {
          ok: false,
          issues: [
            {
              code: 'variable-evaluation-failed',
              message: PREPARATION_FAILURE_MESSAGE,
            },
          ],
        },
      },
    });

    await expect(pending).resolves.toEqual({
      kind: 'preparation-failed',
      gcode: '',
      preflight: {
        ok: false,
        issues: [
          {
            code: 'variable-evaluation-failed',
            message: PREPARATION_FAILURE_MESSAGE,
          },
        ],
      },
    });
    expect(worker.terminated).toBe(false);
  });

  it('holds a second request until the active outer-worker preparation settles', async () => {
    const first = prepareSaveOutputOffThread({
      kind: 'save',
      project: createProject(),
      options: {},
    });
    const second = prepareSaveOutputOffThread({
      kind: 'save',
      project: createProject(),
      options: {},
    });
    if (first === null || second === null) throw new Error('worker unavailable');
    const worker = latestWorker();
    expect(worker.posted).toHaveLength(1);
    worker.respond(emittedSave('FIRST\n'), 0);
    await expect(first).resolves.toMatchObject({ gcode: 'FIRST\n' });
    expect(worker.posted).toHaveLength(2);
    worker.respond(emittedSave('SECOND\n'), 1);
    await expect(second).resolves.toMatchObject({ gcode: 'SECOND\n' });
    expect(FakeWorker.instances).toHaveLength(1);
  });

  it('terminates an active outer worker and dispatches the queued request on a fresh worker', async () => {
    const controller = new AbortController();
    const first = prepareSaveOutputOffThread(
      { kind: 'save', project: createProject(), options: {} },
      undefined,
      controller.signal,
    );
    const second = prepareSaveOutputOffThread({
      kind: 'save',
      project: createProject(),
      options: {},
    });
    if (first === null || second === null) throw new Error('worker unavailable');
    const worker = latestWorker();

    controller.abort();

    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    expect(worker.terminated).toBe(true);
    expect(worker.posted).toHaveLength(1);
    expect(FakeWorker.instances).toHaveLength(2);
    const replacement = latestWorker();
    expect(replacement).not.toBe(worker);
    expect(replacement.posted).toHaveLength(1);
    replacement.respond(emittedSave('SECOND\n'));
    await expect(second).resolves.toMatchObject({ gcode: 'SECOND\n' });
  });

  it('removes a cancelled queued request without posting it to the worker', async () => {
    const first = prepareSaveOutputOffThread({
      kind: 'save',
      project: createProject(),
      options: {},
    });
    const controller = new AbortController();
    const queued = prepareSaveOutputOffThread(
      { kind: 'save', project: createProject(), options: {} },
      undefined,
      controller.signal,
    );
    if (first === null || queued === null) throw new Error('worker unavailable');
    controller.abort();

    await expect(queued).rejects.toMatchObject({ name: 'AbortError' });
    const worker = latestWorker();
    expect(worker.posted).toHaveLength(1);
    worker.respond(emittedSave('FIRST\n'), 0);
    await expect(first).resolves.toMatchObject({ gcode: 'FIRST\n' });
    expect(worker.posted).toHaveLength(1);
  });

  it('keeps the caller-bound snapshot timestamp unchanged while queued', async () => {
    const first = prepareSaveOutputOffThread({
      kind: 'save',
      project: createProject(),
      options: {},
    });
    const second = prepareSaveOutputOffThread({
      kind: 'save',
      project: createProject(),
      options: {},
      snapshot: { evaluatedAtIso: '2026-08-04T01:02:03.000Z' },
    });
    if (first === null || second === null) throw new Error('worker unavailable');
    const worker = latestWorker();
    worker.respond(emittedSave('FIRST\n'), 0);
    await first;
    const queuedEnvelope = worker.posted[1];
    if (queuedEnvelope?.kind !== 'prepare') throw new Error('queued request missing');
    expect(queuedEnvelope.request).toMatchObject({
      kind: 'save',
      snapshot: { evaluatedAtIso: '2026-08-04T01:02:03.000Z' },
    });
    worker.respond(emittedSave('SECOND\n'), 1);
    await second;
  });

  it('rejects a third request instead of growing the outer-worker queue', async () => {
    const first = prepareSaveOutputOffThread({
      kind: 'save',
      project: createProject(),
      options: {},
    });
    const second = prepareSaveOutputOffThread({
      kind: 'save',
      project: createProject(),
      options: {},
    });
    const third = prepareSaveOutputOffThread({
      kind: 'save',
      project: createProject(),
      options: {},
    });
    if (first === null || second === null || third === null) throw new Error('worker unavailable');

    await expect(third).rejects.toThrow('queue is full');
    const worker = latestWorker();
    worker.respond(emittedSave('FIRST\n'));
    await expect(first).resolves.toMatchObject({ gcode: 'FIRST\n' });
    worker.respond(emittedSave('SECOND\n'));
    await expect(second).resolves.toMatchObject({ gcode: 'SECOND\n' });
  });

  it('retires the worker on a fatal error so the next request gets a fresh one', async () => {
    const pending = prepareSaveOutputOffThread({
      kind: 'save',
      project: createProject(),
      options: {},
    });
    if (pending === null) throw new Error('worker unavailable');
    const failed = latestWorker();
    failed.onerror?.();

    await expect(pending).rejects.toThrow('Background output preparation worker errored.');
    expect(failed.terminated).toBe(true);

    await settledSave('G21\n');
    expect(FakeWorker.instances).toHaveLength(2);
  });
});

function emittedSave(gcode: string): OutputPreparationResponse {
  return {
    kind: 'save',
    result: { kind: 'emitted', gcode, preflight: { ok: true, issues: [] }, cncVCarveDepths: [] },
  };
}

function latestWorker(): FakeWorker {
  const worker = FakeWorker.instances.at(-1);
  if (worker === undefined) throw new Error('worker missing');
  return worker;
}

async function settledSave(gcode: string): Promise<void> {
  const pending = prepareSaveOutputOffThread({
    kind: 'save',
    project: createProject(),
    options: {},
  });
  if (pending === null) throw new Error('worker unavailable');
  latestWorker().respond(emittedSave(gcode));
  await pending;
}
