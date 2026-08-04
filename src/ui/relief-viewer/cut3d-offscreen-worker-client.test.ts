import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCut3DOffscreenCoordinator } from './cut3d-offscreen-worker-client';
import {
  dependencies,
  dispatchPointer,
  drain,
  emitReady,
  FakeWorker,
  MESH,
  offscreen,
  requestOfKind,
  transferableCanvas,
} from './cut3d-offscreen-worker-test-support';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('Cut 3D offscreen worker client', () => {
  it('transfers one canvas and one mesh exactly once across StrictMode lease replay', async () => {
    const worker = new FakeWorker();
    const microtasks: Array<() => void> = [];
    const transfer = vi.fn(() => offscreen());
    const canvas = transferableCanvas(transfer);
    const coordinator = createCut3DOffscreenCoordinator(MESH, 6, {
      canCreateWorker: () => true,
      createWorker: () => worker,
      scheduleMicrotask: (callback) => microtasks.push(callback),
    });
    const firstAbort = new AbortController();
    const first = coordinator.buildScene(canvas, firstAbort.signal, vi.fn());
    firstAbort.abort();
    const secondAbort = new AbortController();
    const second = coordinator.buildScene(canvas, secondAbort.signal, vi.fn());
    drain(microtasks);

    expect(transfer).toHaveBeenCalledOnce();
    expect(worker.requests.filter((request) => request.kind === 'init')).toHaveLength(1);
    expect(worker.transfers[0]).toEqual([
      expect.any(Object),
      MESH.positions.buffer,
      MESH.indices.buffer,
      MESH.normals.buffer,
    ]);
    expect(worker.terminate).not.toHaveBeenCalled();

    emitReady(worker);
    expect((await first).kind).toBe('ok');
    const outcome = await second;
    expect(outcome.kind).toBe('ok');
    if (outcome.kind === 'ok') outcome.handle.dispose();
    drain(microtasks);
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('bounds control and resize traffic until the worker presents each input', async () => {
    const worker = new FakeWorker();
    const canvas = transferableCanvas(() => offscreen());
    const coordinator = createCut3DOffscreenCoordinator(MESH, 6, dependencies(worker));
    const pending = coordinator.buildScene(canvas, new AbortController().signal, vi.fn());
    emitReady(worker);
    const outcome = await pending;
    expect(outcome.kind).toBe('ok');

    const firstResize = requestOfKind(worker, 'resize');
    dispatchPointer(canvas, 'pointerdown', { button: 2, pointerId: 7, clientX: 10, clientY: 10 });
    dispatchPointer(canvas, 'pointermove', { button: 2, pointerId: 7, clientX: 20, clientY: 12 });
    dispatchPointer(canvas, 'pointermove', { button: 2, pointerId: 7, clientX: 30, clientY: 15 });
    expect(worker.requests.filter((request) => request.kind === 'control')).toHaveLength(1);

    const firstControl = requestOfKind(worker, 'control');
    worker.emit({
      kind: 'presented',
      sessionId: 1,
      revision: 2,
      source: 'control',
      inputId: firstControl.inputId,
    });
    expect(worker.requests.filter((request) => request.kind === 'control')).toHaveLength(2);
    worker.emit({
      kind: 'presented',
      sessionId: 1,
      revision: 3,
      source: 'resize',
      inputId: firstResize.inputId,
    });
    expect(canvas.dataset.frameRevision).toBe('3');
  });

  it('surfaces startup and late worker errors without a main-thread fallback', async () => {
    const startupWorker = new FakeWorker();
    const startup = createCut3DOffscreenCoordinator(
      MESH,
      6,
      dependencies(startupWorker),
    ).buildScene(
      transferableCanvas(() => offscreen()),
      new AbortController().signal,
      vi.fn(),
    );
    startupWorker.error();
    await expect(startup).resolves.toEqual({
      kind: 'no-webgl',
      reason: 'The background 3D renderer stopped unexpectedly.',
    });
    expect(startupWorker.terminate).toHaveBeenCalledOnce();

    const readyWorker = new FakeWorker();
    const reportFailure = vi.fn();
    const readyCanvas = transferableCanvas(() => offscreen());
    const ready = createCut3DOffscreenCoordinator(MESH, 6, dependencies(readyWorker)).buildScene(
      readyCanvas,
      new AbortController().signal,
      reportFailure,
    );
    emitReady(readyWorker);
    await ready;
    readyWorker.emit({ kind: 'error', sessionId: 1, message: 'context lost' });
    expect(reportFailure).toHaveBeenCalledWith('context lost');
    expect(readyCanvas.dataset.sceneState).toBe('unavailable');
    expect(readyWorker.terminate).toHaveBeenCalledOnce();
  });

  it('settles unavailable and terminates on mismatched or invalid response identity', async () => {
    const mismatchedWorker = new FakeWorker();
    const mismatched = createCut3DOffscreenCoordinator(
      MESH,
      6,
      dependencies(mismatchedWorker),
    ).buildScene(
      transferableCanvas(() => offscreen()),
      new AbortController().signal,
      vi.fn(),
    );
    mismatchedWorker.emit({ kind: 'ready', sessionId: 2 });
    await expect(mismatched).resolves.toEqual({
      kind: 'no-webgl',
      reason: 'The background 3D renderer returned an unreadable response.',
    });
    expect(mismatchedWorker.terminate).toHaveBeenCalledOnce();

    const invalidWorker = new FakeWorker();
    const invalid = createCut3DOffscreenCoordinator(
      MESH,
      6,
      dependencies(invalidWorker),
    ).buildScene(
      transferableCanvas(() => offscreen()),
      new AbortController().signal,
      vi.fn(),
    );
    invalidWorker.emitUnknown({ kind: 'ready', sessionId: Number.NaN });
    await expect(invalid).resolves.toEqual({
      kind: 'no-webgl',
      reason: 'The background 3D renderer returned an unreadable response.',
    });
    expect(invalidWorker.terminate).toHaveBeenCalledOnce();
  });

  it('fails unavailable instead of wedging on incorrect control or resize acknowledgements', async () => {
    const controlWorker = new FakeWorker();
    const controlFailure = vi.fn();
    const controlCanvas = transferableCanvas(() => offscreen());
    const controlReady = createCut3DOffscreenCoordinator(
      MESH,
      6,
      dependencies(controlWorker),
    ).buildScene(controlCanvas, new AbortController().signal, controlFailure);
    emitReady(controlWorker);
    await controlReady;
    dispatchPointer(controlCanvas, 'pointerdown', {
      button: 2,
      pointerId: 7,
      clientX: 10,
      clientY: 10,
    });
    dispatchPointer(controlCanvas, 'pointermove', {
      button: 2,
      pointerId: 7,
      clientX: 20,
      clientY: 12,
    });
    const control = requestOfKind(controlWorker, 'control');
    controlWorker.emit({
      kind: 'presented',
      sessionId: 1,
      revision: 2,
      source: 'control',
      inputId: control.inputId + 1,
    });
    expect(controlFailure).toHaveBeenCalledWith(
      'The background 3D renderer returned an unreadable response.',
    );
    expect(controlWorker.terminate).toHaveBeenCalledOnce();

    const resizeWorker = new FakeWorker();
    const resizeFailure = vi.fn();
    const resizeReady = createCut3DOffscreenCoordinator(
      MESH,
      6,
      dependencies(resizeWorker),
    ).buildScene(
      transferableCanvas(() => offscreen()),
      new AbortController().signal,
      resizeFailure,
    );
    emitReady(resizeWorker);
    await resizeReady;
    const resize = requestOfKind(resizeWorker, 'resize');
    resizeWorker.emit({
      kind: 'presented',
      sessionId: 1,
      revision: 2,
      source: 'resize',
      inputId: resize.inputId + 1,
    });
    expect(resizeFailure).toHaveBeenCalledWith(
      'The background 3D renderer returned an unreadable response.',
    );
    expect(resizeWorker.terminate).toHaveBeenCalledOnce();
  });

  it('returns unavailable when OffscreenCanvas is unsupported and never creates a worker', async () => {
    const createWorker = vi.fn(() => new FakeWorker());
    const canvas = document.createElement('canvas');
    const outcome = await createCut3DOffscreenCoordinator(MESH, 6, {
      canCreateWorker: () => true,
      createWorker,
      scheduleMicrotask: queueMicrotask,
    }).buildScene(canvas, new AbortController().signal, vi.fn());
    expect(outcome.kind).toBe('no-webgl');
    expect(createWorker).not.toHaveBeenCalled();
  });

  it('uses a fresh transferred canvas and worker after a real unmount', async () => {
    const workers = [new FakeWorker(), new FakeWorker()];
    const microtasks: Array<() => void> = [];
    const coordinator = createCut3DOffscreenCoordinator(MESH, 6, {
      canCreateWorker: () => true,
      createWorker: () => workers.shift() ?? new FakeWorker(),
      scheduleMicrotask: (callback) => microtasks.push(callback),
    });
    const firstCanvas = transferableCanvas(() => offscreen());
    const firstAbort = new AbortController();
    void coordinator.buildScene(firstCanvas, firstAbort.signal, vi.fn());
    firstAbort.abort();
    drain(microtasks);
    const secondCanvas = transferableCanvas(() => offscreen());
    void coordinator.buildScene(secondCanvas, new AbortController().signal, vi.fn());
    expect(firstCanvas).not.toBe(secondCanvas);
    expect(workers).toHaveLength(0);
  });
});
