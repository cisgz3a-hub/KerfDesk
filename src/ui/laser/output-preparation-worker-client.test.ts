// Transport behaviour of the shared preparation worker: one reused instance,
// responses matched to their own request id, and terminate reserved for fatal
// failures. Which projects route off-thread at all is covered by
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

const PREPARATION_FAILURE_MESSAGE = 'The output snapshot could not be prepared.';

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent<OutputPreparationResult>) => void) | null = null;
  onerror: (() => void) | null = null;
  posted: OutputPreparationEnvelope[] = [];
  terminated = false;

  constructor() {
    FakeWorker.instances.push(this);
  }

  postMessage(envelope: OutputPreparationEnvelope): void {
    this.posted.push(envelope);
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
    worker.respond({
      kind: 'save',
      result: { kind: 'emitted', gcode: 'G21\n', preflight: { ok: true, issues: [] } },
    });

    await expect(pending).resolves.toEqual({
      kind: 'emitted',
      gcode: 'G21\n',
      preflight: { ok: true, issues: [] },
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

  it('delivers each response to its own request when two are in flight', async () => {
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
    // Answer out of order: correlation must come from the id, not arrival order.
    worker.respond(emittedSave('SECOND\n'), 1);
    worker.respond(emittedSave('FIRST\n'), 0);

    await expect(first).resolves.toMatchObject({ gcode: 'FIRST\n' });
    await expect(second).resolves.toMatchObject({ gcode: 'SECOND\n' });
    expect(FakeWorker.instances).toHaveLength(1);
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
    result: { kind: 'emitted', gcode, preflight: { ok: true, issues: [] } },
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
