import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../../core/scene';
import { prepareSaveOutputOffThread } from './output-preparation-worker-client';
import type {
  OutputPreparationRequest,
  OutputPreparationResponse,
} from './output-preparation-protocol';

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent<OutputPreparationResponse>) => void) | null = null;
  onerror: (() => void) | null = null;
  posted: OutputPreparationRequest[] = [];
  terminated = false;

  constructor() {
    FakeWorker.instances.push(this);
  }

  postMessage(request: OutputPreparationRequest): void {
    this.posted.push(request);
  }

  terminate(): void {
    this.terminated = true;
  }

  respond(response: OutputPreparationResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<OutputPreparationResponse>);
  }
}

beforeEach(() => vi.stubGlobal('Worker', FakeWorker));
afterEach(() => vi.unstubAllGlobals());

describe('output preparation worker client', () => {
  it('returns null without Worker support', () => {
    vi.unstubAllGlobals();
    expect(
      prepareSaveOutputOffThread({ kind: 'save', project: createProject(), options: {} }),
    ).toBeNull();
  });

  it('resolves a Save result and terminates the one-shot worker', async () => {
    const pending = prepareSaveOutputOffThread({
      kind: 'save',
      project: createProject(),
      options: {},
    });
    if (pending === null) throw new Error('worker unavailable');
    const worker = FakeWorker.instances.at(-1);
    if (worker === undefined) throw new Error('worker missing');
    worker.respond({
      kind: 'save',
      result: { gcode: 'G21\n', preflight: { ok: true, issues: [] } },
    });

    await expect(pending).resolves.toEqual({
      gcode: 'G21\n',
      preflight: { ok: true, issues: [] },
    });
    expect(worker.terminated).toBe(true);
  });
});
