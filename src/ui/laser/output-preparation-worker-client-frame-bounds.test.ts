import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject, DEFAULT_OUTPUT_SCOPE } from '../../core/scene';
import { resetStore } from '../state/test-helpers';
import { isCanvasCompilationBridgeConnection } from '../workspace/canvas-compilation-worker-protocol';
import type { FrameBoundsPreview } from './frame-bounds-preview';
import type {
  OutputPreparationEnvelope,
  OutputPreparationResponse,
  OutputPreparationResult,
  StartOutputPreparationRequest,
} from './output-preparation-protocol';
import {
  prepareStartOutputOffThread,
  resetOutputPreparationWorkerForTests,
} from './output-preparation-worker-client';

// The client relays a Start request's early outline to its own caller and only
// its own caller, and a listener that throws can neither settle nor lose the
// exact program that follows (ADR-353).

class ControlledWorker {
  static instances: ControlledWorker[] = [];
  onmessage: ((event: MessageEvent<OutputPreparationResult>) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  posted: OutputPreparationEnvelope[] = [];
  terminated = false;
  constructor() {
    ControlledWorker.instances.push(this);
  }
  postMessage(value: unknown): void {
    if (isCanvasCompilationBridgeConnection(value)) return;
    this.posted.push(value as OutputPreparationEnvelope);
  }
  terminate(): void {
    this.terminated = true;
  }
  reportFrameBounds(frameBounds: FrameBoundsPreview, requestId = this.posted.at(-1)?.requestId) {
    this.onmessage?.({ data: { requestId, frameBounds } } as MessageEvent<OutputPreparationResult>);
  }
  respond(response: OutputPreparationResponse, requestId = this.posted.at(-1)?.requestId): void {
    this.onmessage?.({ data: { requestId, response } } as MessageEvent<OutputPreparationResult>);
  }
}

const preview: FrameBoundsPreview = {
  frameJobBounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
  frameMotionBounds: { minX: -2, minY: 0, maxX: 12, maxY: 10 },
  retentionKey: 'retention-key',
};

const refused: OutputPreparationResponse = {
  kind: 'start',
  result: { ok: false, messages: ['refused in this test'] },
};

function startRequest(): StartOutputPreparationRequest {
  return {
    kind: 'start',
    project: createProject(),
    controllerSettings: null,
    machine: { statusReport: null, alarmCode: null, hasActiveStreamer: false },
    jobPlacement: { startFrom: 'absolute', anchor: 'front-left' },
    outputScope: DEFAULT_OUTPUT_SCOPE,
    requireFrame: false,
  };
}

const latest = () => ControlledWorker.instances.at(-1)!;

beforeEach(() => {
  resetStore();
  resetOutputPreparationWorkerForTests();
  ControlledWorker.instances = [];
  vi.stubGlobal('Worker', ControlledWorker);
});

afterEach(() => {
  resetOutputPreparationWorkerForTests();
  vi.unstubAllGlobals();
});

describe('prepareStartOutputOffThread early outline relay', () => {
  it('delivers the outline to the requesting caller before the program settles', async () => {
    const seen: FrameBoundsPreview[] = [];
    const pending = prepareStartOutputOffThread(startRequest(), undefined, undefined, (p) =>
      seen.push(p),
    );
    if (pending === null) throw new Error('Worker support is stubbed in this test');
    let settled = false;
    void pending.then(() => {
      settled = true;
    });

    latest().reportFrameBounds(preview);
    await Promise.resolve();
    expect(seen).toEqual([preview]);
    expect(settled).toBe(false);

    latest().respond(refused);
    await expect(pending).resolves.toEqual(refused.result);
  });

  it('drops an outline addressed to a request that is no longer pending', async () => {
    const seen: FrameBoundsPreview[] = [];
    const pending = prepareStartOutputOffThread(startRequest(), undefined, undefined, (p) =>
      seen.push(p),
    );
    if (pending === null) throw new Error('Worker support is stubbed in this test');

    latest().reportFrameBounds(preview, 9_999);
    latest().respond(refused);
    await expect(pending).resolves.toEqual(refused.result);
    latest().reportFrameBounds(preview);

    expect(seen).toEqual([]);
  });

  it('keeps the exact program when the outline listener throws', async () => {
    const pending = prepareStartOutputOffThread(startRequest(), undefined, undefined, () => {
      throw new Error('listener failure');
    });
    if (pending === null) throw new Error('Worker support is stubbed in this test');

    expect(() => latest().reportFrameBounds(preview)).not.toThrow();
    latest().respond(refused);

    await expect(pending).resolves.toEqual(refused.result);
  });
});
