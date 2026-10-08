import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QuickNestDialogHost } from './QuickNestDialogHost';
import { useStore } from '../state';
import { createLayer, createProject, IDENTITY_TRANSFORM } from '../../core/scene';
import { layoutNest } from '../../core/nesting/layout-nest';
import type { NestingWorkerRequest, NestingWorkerResponse } from './nesting-worker-protocol';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
class FakeWorker {
  static last: FakeWorker;
  input: NestingWorkerRequest | null = null;
  onmessage: ((event: MessageEvent<NestingWorkerResponse>) => void) | null = null;
  terminate = vi.fn();
  constructor() {
    FakeWorker.last = this;
  }
  postMessage(input: NestingWorkerRequest): void {
    this.input = input;
  }
  send(data: NestingWorkerResponse): void {
    this.onmessage?.({ data } as MessageEvent<NestingWorkerResponse>);
  }
}
let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.unstubAllGlobals();
});

describe('nesting draft host', () => {
  it('keeps worker progress and cancellation separate from the single accepted scene mutation', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const object = {
      kind: 'shape' as const,
      id: 'part',
      spec: { kind: 'rect' as const, widthMm: 20, heightMm: 10, cornerRadiusMm: 0 },
      bounds: { minX: 0, minY: 0, maxX: 20, maxY: 10 },
      transform: { ...IDENTITY_TRANSFORM, x: 75, y: 70 },
      color: '#000000',
      paths: [],
    };
    const project = {
      ...createProject(),
      scene: {
        objects: [object],
        layers: [createLayer({ id: '#000000', color: '#000000' })],
        groups: [],
      },
    };
    useStore.setState({
      project,
      selectedObjectId: object.id,
      additionalSelectedIds: new Set(),
      undoStack: [],
      redoStack: [],
      dirty: false,
    });
    const close = vi.fn();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root?.render(<QuickNestDialogHost onClose={close} />));
    await act(async () => Simulate.submit(host!.querySelector('form')!));
    expect(useStore.getState().project).toBe(project);
    const worker = FakeWorker.last;
    if (worker.input?.kind !== 'search') throw new Error('Expected a selection nesting request.');
    const best = layoutNest(worker.input.input)!;
    await act(async () =>
      worker.send({ kind: 'progress', progress: { attempted: 1, total: 24, best } }),
    );
    expect(useStore.getState().project).toBe(project);
    const stop = Array.from(host.querySelectorAll('button')).find(
      (button) => button.textContent === 'Stop search',
    )!;
    await act(async () => Simulate.click(stop));
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(useStore.getState().project).toBe(project);
    const accept = Array.from(host.querySelectorAll('button')).find(
      (button) => button.textContent === 'Accept best valid layout',
    )!;
    await act(async () => Simulate.click(accept));
    expect(useStore.getState().project).not.toBe(project);
    expect(useStore.getState().undoStack).toEqual([project]);
    expect(useStore.getState().project.scene.objects[0]!.id).toBe(object.id);
    expect(close).toHaveBeenCalledOnce();
  });
});
