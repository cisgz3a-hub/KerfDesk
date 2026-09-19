import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mixedCanvasCompilationProject } from '../../__fixtures__/mixed-canvas-compilation-project';
import { createProject } from '../../core/scene';
import { useStore } from '../state/store';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { useCameraStore } from '../state/camera-store';
import { resetStore } from '../state/test-helpers';
import { isCanvasCompilationBridgeConnection } from '../workspace/canvas-compilation-worker-protocol';
import { BACKGROUND_OUTPUT_PREPARATION_BUSY_MESSAGE } from './output-preparation-errors';
import {
  prepareOutputOffThread,
  prepareRdOutputOffThread,
  prepareSaveOutputOffThread,
  resetOutputPreparationWorkerForTests,
} from './output-preparation-worker-client';
import type {
  OutputPreparationEnvelope,
  OutputPreparationResponse,
  OutputPreparationResult,
} from './output-preparation-protocol';
import { prepareCurrentStartJob } from './start-job-source';
import { failedBackgroundSaveOutput } from './save-output-emission';

class ControlledWorker {
  static instances: ControlledWorker[] = [];
  onmessage: ((event: MessageEvent<OutputPreparationResult>) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  posted: OutputPreparationEnvelope[] = [];
  terminated = false;
  cloneFailure = false;
  constructor() {
    ControlledWorker.instances.push(this);
  }
  postMessage(value: unknown): void {
    if (isCanvasCompilationBridgeConnection(value)) return;
    if (this.cloneFailure) {
      this.cloneFailure = false;
      throw new DOMException('Cannot clone this request', 'DataCloneError');
    }
    this.posted.push(value as OutputPreparationEnvelope);
  }
  terminate(): void {
    this.terminated = true;
  }
  respond(response: OutputPreparationResponse, requestId = this.posted.at(-1)?.requestId): void {
    this.onmessage?.({ data: { requestId, response } } as MessageEvent<OutputPreparationResult>);
  }
}

const saved = (gcode: string): OutputPreparationResponse => ({
  kind: 'save',
  result: { kind: 'emitted', gcode, preflight: { ok: true, issues: [] }, cncVCarveDepths: [] },
});
const save = (signal?: AbortSignal) =>
  prepareSaveOutputOffThread(
    { kind: 'save', project: createProject(), options: {} },
    undefined,
    signal,
  )!;
const latest = () => ControlledWorker.instances.at(-1)!;

beforeEach(() => {
  resetStore();
  resetOutputPreparationWorkerForTests();
  ControlledWorker.instances = [];
  vi.stubGlobal('Worker', ControlledWorker);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  useLaserStore.setState(initialLaserState());
});
afterEach(() => {
  resetOutputPreparationWorkerForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('output preparation ownership and capacity (R1)', () => {
  it('reports healthy saturation accurately to real CNC Start and preserves queued work for retry', async () => {
    useStore.getState().setProject(mixedCanvasCompilationProject());
    const first = save();
    const second = save();
    const result = await prepareCurrentStartJob(
      useStore.getState(),
      useLaserStore.getState(),
      useCameraStore.getState(),
    );
    expect(result).toEqual({ ok: false, messages: [BACKGROUND_OUTPUT_PREPARATION_BUSY_MESSAGE] });
    expect(latest().terminated).toBe(false);
    expect(latest().posted).toHaveLength(1);
    latest().respond(saved('FIRST'));
    await expect(first).resolves.toMatchObject({ gcode: 'FIRST' });
    latest().respond(saved('SECOND'));
    await expect(second).resolves.toMatchObject({ gcode: 'SECOND' });
    const retry = save();
    latest().respond(saved('RETRY'));
    await expect(retry).resolves.toMatchObject({ gcode: 'RETRY' });
    expect(ControlledWorker.instances).toHaveLength(1);
  });

  it('retains capacity and compilation error kinds at the Save boundary', async () => {
    const first = save();
    const second = save();
    const failed = await save().catch((error: unknown) => failedBackgroundSaveOutput(error));
    expect(failed).toMatchObject({
      kind: 'preparation-busy',
      message: BACKGROUND_OUTPUT_PREPARATION_BUSY_MESSAGE,
    });
    latest().respond({ kind: 'error', message: 'Invalid V-bit included angle' });
    const compilation = await first.catch((error: unknown) => failedBackgroundSaveOutput(error));
    expect(compilation).toMatchObject({
      kind: 'preparation-error',
      message: 'Invalid V-bit included angle',
    });
    latest().respond(saved('SECOND'));
    await second;
    expect(latest().terminated).toBe(false);
  });

  it('ignores all late events from an aborted worker while the queued owner completes', async () => {
    const controller = new AbortController();
    const first = save(controller.signal);
    const second = save();
    const retired = latest();
    controller.abort();
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    const replacement = latest();
    retired.onerror?.();
    retired.onmessageerror?.();
    retired.respond(saved('STALE'), replacement.posted[0]!.requestId);
    expect(replacement.terminated).toBe(false);
    replacement.respond(saved('CURRENT'));
    await expect(second).resolves.toMatchObject({ gcode: 'CURRENT' });
  });

  it('rejects an uncloneable queued request without retiring healthy infrastructure', async () => {
    const first = save();
    const second = save();
    latest().cloneFailure = true;
    latest().respond(saved('FIRST'));
    await first;
    await expect(second).rejects.toMatchObject({
      kind: 'compilation',
      message: 'Cannot clone this request',
    });
    expect(latest().terminated).toBe(false);
    const retry = save();
    latest().respond(saved('RETRY'));
    await expect(retry).resolves.toMatchObject({ gcode: 'RETRY' });
  });

  it('cannot settle an undispatched request using a response carrying its id', async () => {
    const first = save();
    const second = save();
    const firstId = latest().posted[0]!.requestId;
    latest().respond(saved('OUT OF ORDER'), firstId + 1);
    expect(latest().posted).toHaveLength(1);
    latest().respond(saved('FIRST'), firstId);
    await first;
    latest().respond(saved('SECOND'));
    await expect(second).resolves.toMatchObject({ gcode: 'SECOND' });
  });

  it.each(['prepare', 'rd', 'start'] as const)(
    'owns cancellation at the %s entry point',
    async (kind) => {
      useStore.getState().setProject(mixedCanvasCompilationProject());
      const first = save();
      const controller = new AbortController();
      const request =
        kind === 'prepare'
          ? prepareOutputOffThread(
              { kind, project: createProject(), options: {} },
              undefined,
              controller.signal,
            )
          : kind === 'rd'
            ? prepareRdOutputOffThread(
                { kind, project: createProject(), options: {} },
                undefined,
                controller.signal,
              )
            : prepareCurrentStartJob(
                useStore.getState(),
                useLaserStore.getState(),
                useCameraStore.getState(),
                undefined,
                false,
                controller.signal,
              );
      controller.abort();
      await expect(request).rejects.toMatchObject({ name: 'AbortError' });
      expect(latest().posted).toHaveLength(1);
      latest().respond(saved('FIRST'));
      await first;
      expect(latest().posted).toHaveLength(1);
    },
  );
});
