// The Combine Shapes dialog's Weld runs its absorbed-shapes check in the vector
// worker, never on the UI thread (ADR-609 Amendment 2, performance audit S6-P2-1).

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VectorSceneObject } from '../../core/geometry';
import type * as WeldChangeModule from '../../core/geometry/vector-path-weld-change';
import { createLayer, createProject, IDENTITY_TRANSFORM, type ImportedSvg } from '../../core/scene';
import { unpackSceneObjectsMessage } from '../packed-scene-objects-transfer';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { BooleanDialogHost } from './BooleanDialogHost';
import { openBooleanDialog, useBooleanDialogStore } from './boolean-dialog-store';
import type { VectorOpMessage, VectorOpRequest } from './vector-op-worker-protocol';
import { vectorOpResponse } from './vector-op-worker-runtime';

const checks = vi.hoisted(() => ({ inWorker: false, calls: [] as boolean[] }));

vi.mock('../../core/geometry/vector-path-weld-change', async (importOriginal) => {
  const actual = await importOriginal<typeof WeldChangeModule>();
  return {
    ...actual,
    describeWeldChange: (...args: Parameters<typeof actual.describeWeldChange>) => {
      checks.calls.push(checks.inWorker);
      return actual.describeWeldChange(...args);
    },
  };
});

const workers: FakeWorker[] = [];

// Answers like the real worker, but only when the test delivers the reply.
class FakeWorker {
  onmessage: ((event: MessageEvent<VectorOpMessage>) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  readonly requests: VectorOpRequest[] = [];
  private sources: ReadonlyArray<VectorSceneObject> = [];

  constructor() {
    workers.push(this);
  }

  postMessage(request: VectorOpRequest, transfer: Transferable[] = []): void {
    const received = structuredClone(request, { transfer });
    if (received.sources !== undefined) this.sources = unpackSceneObjectsMessage(received.sources);
    this.requests.push(received);
  }

  reply(): void {
    const request = this.requests.at(-1);
    if (request === undefined) throw new Error('no request to answer');
    checks.inWorker = true;
    try {
      const { response, transfer } = vectorOpResponse(request.id, this.sources, request.task);
      this.onmessage?.({
        data: structuredClone(response, { transfer }),
      } as MessageEvent<VectorOpMessage>);
    } finally {
      checks.inWorker = false;
    }
  }

  terminated = false;

  terminate(): void {
    this.terminated = true;
  }
}

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  resetStore();
  useBooleanDialogStore.setState({ session: null });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('Worker', FakeWorker);
  workers.length = 0;
  checks.calls.length = 0;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function square(id: string, name: string, x: number, size: number): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    name,
    source: `${id}.svg`,
    transform: { ...IDENTITY_TRANSFORM, x, y: x },
    bounds: { minX: 0, minY: 0, maxX: size, maxY: size },
    operationIds: ['cut'],
    paths: [
      {
        color: '#000000',
        polylines: [
          {
            closed: true,
            points: [
              { x: 0, y: 0 },
              { x: size, y: 0 },
              { x: size, y: size },
              { x: 0, y: size },
            ],
          },
        ],
      },
    ],
  };
}

function setScene(): void {
  useStore.setState({
    project: {
      ...createProject(),
      scene: {
        objects: [square('frame', 'Frame', 0, 40), square('inner', 'JOHANN', 15, 10)],
        layers: [createLayer({ id: 'cut', color: '#000000' })],
        groups: [],
      },
    },
    selectedObjectId: 'frame',
    additionalSelectedIds: new Set(['inner']),
  });
}

function button(label: string): HTMLButtonElement {
  return [...document.querySelectorAll('button')].find((entry) => entry.textContent === label)!;
}

describe('Combine Shapes Weld review in the vector worker', () => {
  it('names the absorbed shape from the worker reply, with no check on the UI thread', async () => {
    setScene();
    await act(async () => {
      root.render(<BooleanDialogHost />);
      openBooleanDialog('weld');
    });
    const worker = workers[0]!;
    expect(worker.requests.map((request) => request.task.kind)).toStrictEqual(['weld-review']);
    expect(document.querySelector('[role="status"]')?.textContent).toBe('Updating preview…');
    expect(checks.calls).toStrictEqual([]);

    await act(async () => worker.reply());
    expect(checks.calls).toStrictEqual([true]);
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      '“JOHANN” lies entirely inside another shape in the same operation, so Weld removes it.',
    );
    expect(button('Apply').disabled).toBe(false);
  });

  it('applies the worker union as the in-thread Weld would', async () => {
    setScene();
    useStore.getState().weldSelection();
    const inThread = JSON.stringify(useStore.getState().project.scene);
    expect(useStore.getState().project.scene.objects.map((object) => object.kind)).toStrictEqual([
      'imported-svg',
    ]);

    resetStore();
    setScene();
    await act(async () => {
      root.render(<BooleanDialogHost />);
      openBooleanDialog('weld');
    });
    await act(async () => workers[0]!.reply());
    await act(async () => button('Apply').click());
    expect(JSON.stringify(useStore.getState().project.scene)).toBe(inThread);
    expect(checks.calls).toStrictEqual([true]);
  });
});
