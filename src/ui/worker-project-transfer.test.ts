import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createLayer,
  createProject,
  DEFAULT_OUTPUT_SCOPE,
  IDENTITY_TRANSFORM,
  polylineToCurveSubpath,
  type Project,
} from '../core/scene';
import { designCarveSource } from './design-studio/preview3d/design-carve-source';
import {
  packProjectMessage,
  isPackedProjectMessage,
  unpackProjectMessage,
} from './packed-project-transfer';
import {
  prepareSaveOutputOffThread,
  resetOutputPreparationWorkerForTests,
} from './laser/output-preparation-worker-client';
import type {
  OutputPreparationWireEnvelope,
  OutputPreparationResult,
} from './laser/output-preparation-protocol';
import { prepareOutputRequest } from './laser/output-preparation';
import {
  computeDesignSceneSourceOffThread,
  simulateDesignCarveOffThread,
  resetDesignSceneWorkerForTests,
} from './workspace/design-scene-worker-client';
import type { DesignSceneWorkerRequest } from './workspace/design-scene-worker-protocol';
import { isCanvasCompilationBridgeConnection } from './workspace/canvas-compilation-worker-protocol';

const SNAPSHOT = { evaluatedAtIso: '2026-10-14T00:00:00.000Z' };
type Request = OutputPreparationWireEnvelope | DesignSceneWorkerRequest;

class TransferWorker {
  static instances: TransferWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  received: Request[] = [];
  sentBuffers: ArrayBuffer[] = [];
  constructor() {
    TransferWorker.instances.push(this);
  }
  postMessage(message: unknown, transfer: Transferable[] = []): void {
    if (isCanvasCompilationBridgeConnection(message)) return;
    this.sentBuffers.push(
      ...transfer.filter((item): item is ArrayBuffer => item instanceof ArrayBuffer),
    );
    this.received.push(structuredClone(message, { transfer }) as Request);
  }
  terminate(): void {
    this.onmessage = null;
  }
  reply(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent);
  }
}

function denseProject(): Project {
  const base = createProject();
  const polyline = {
    closed: false,
    points: Array.from({ length: 3001 }, (_, index) => ({
      x: index / 100,
      y: 10 + (index % 2) / 10,
    })),
  };
  const color = '#000000';
  return {
    ...base,
    scene: {
      ...base.scene,
      layers: [createLayer({ id: color, color, mode: 'line' })],
      objects: [
        {
          kind: 'imported-svg',
          id: 'dense',
          source: 'dense.svg',
          transform: IDENTITY_TRANSFORM,
          bounds: { minX: 0, minY: 10, maxX: 30, maxY: 10.1 },
          paths: [{ color, polylines: [polyline], curves: [polylineToCurveSubpath(polyline)] }],
        },
      ],
    },
  };
}

beforeEach(() => {
  TransferWorker.instances = [];
  vi.stubGlobal('Worker', TransferWorker);
});
afterEach(() => {
  resetOutputPreparationWorkerForTests();
  resetDesignSceneWorkerForTests();
  vi.unstubAllGlobals();
});

describe('actual client project transfers', () => {
  it('packs output only when dispatched, preserves snapshot inputs and sends fresh buffers on reuse', async () => {
    const project = denseProject();
    const first = prepareSaveOutputOffThread({
      kind: 'save',
      project,
      options: {},
      snapshot: SNAPSHOT,
    });
    const second = prepareSaveOutputOffThread({
      kind: 'save',
      project,
      options: {},
      snapshot: SNAPSHOT,
    });
    const worker = TransferWorker.instances[0]!;
    expect(worker.received).toHaveLength(1);
    for (let index = 0; index < 2; index += 1) {
      const envelope = worker.received[index] as OutputPreparationWireEnvelope;
      expect(isPackedProjectMessage(envelope.request.project)).toBe(true);
      expect(unpackProjectMessage(envelope.request.project)).toEqual(project);
      expect(envelope.request).toMatchObject({ kind: 'save', options: {}, snapshot: SNAPSHOT });
      expect(worker.sentBuffers.length).toBeGreaterThan(0);
      expect(worker.sentBuffers.every((buffer) => buffer.byteLength === 0)).toBe(true);
      worker.reply({
        requestId: envelope.requestId,
        response: {
          kind: 'save',
          result: { kind: 'emitted', gcode: 'G21\n', preflight: { ok: true, issues: [] } },
        },
      });
    }
    await expect(first).resolves.toMatchObject({ gcode: 'G21\n' });
    await expect(second).resolves.toMatchObject({ gcode: 'G21\n' });
    expect(project).toEqual(denseProject());
  });

  it.each(['scene', 'simulation'] as const)(
    'packs %s requests and preserves the complete project',
    async (kind) => {
      const project = denseProject();
      const source = designCarveSource(project);
      const pending =
        kind === 'scene'
          ? computeDesignSceneSourceOffThread(project, DEFAULT_OUTPUT_SCOPE)
          : simulateDesignCarveOffThread(project, source);
      const worker = TransferWorker.instances[0]!;
      const request = worker.received[0] as DesignSceneWorkerRequest;
      expect(isPackedProjectMessage(request.project)).toBe(true);
      expect(unpackProjectMessage(request.project)).toEqual(project);
      expect(worker.sentBuffers.every((buffer) => buffer.byteLength === 0)).toBe(true);
      if (request.kind === 'simulation') expect(request.source).toEqual(source);
      else expect(request.outputScope).toEqual(DEFAULT_OUTPUT_SCOPE);
      worker.reply(
        kind === 'scene'
          ? { id: request.id, kind, source: null }
          : { id: request.id, kind, result: { kind: 'empty', reason: 'fixture' } },
      );
      await pending;
      expect(project).toEqual(denseProject());
    },
  );

  it('keeps small requests cloneable without transfer buffers', async () => {
    const project = createProject();
    const pending = computeDesignSceneSourceOffThread(project, DEFAULT_OUTPUT_SCOPE);
    const worker = TransferWorker.instances[0]!;
    const request = worker.received[0] as DesignSceneWorkerRequest;
    expect(isPackedProjectMessage(request.project)).toBe(false);
    expect(request.project).toEqual(project);
    expect(worker.sentBuffers).toEqual([]);
    worker.reply({ id: request.id, kind: 'scene', source: null });
    await pending;
  });
});

describe('output worker unpacking', () => {
  it('emits identical G-code and review results from packed and original snapshots', async () => {
    const replies: OutputPreparationResult[] = [];
    const scope = {
      onmessage: null as ((event: MessageEvent<OutputPreparationWireEnvelope>) => void) | null,
      postMessage: (value: OutputPreparationResult): void => {
        replies.push(value);
      },
    };
    vi.stubGlobal('self', scope);
    await import('./laser/output-preparation-worker');
    const request = {
      kind: 'save' as const,
      project: denseProject(),
      options: {},
      snapshot: SNAPSHOT,
    };
    const expected = await prepareOutputRequest(request);
    expect(expected).toMatchObject({ kind: 'save', result: { kind: 'emitted' } });
    const { message, transfer } = packProjectMessage(request.project);
    const envelope: OutputPreparationWireEnvelope = {
      kind: 'prepare',
      requestId: 41,
      request: { ...request, project: message },
    };
    scope.onmessage?.({
      data: structuredClone(envelope, { transfer }),
    } as MessageEvent<OutputPreparationWireEnvelope>);
    await vi.waitFor(() => expect(replies.some((reply) => 'response' in reply)).toBe(true));
    expect(replies.find((reply) => 'response' in reply)).toEqual({
      requestId: 41,
      response: expected,
    });
  });
});
