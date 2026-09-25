import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareViewer3dFrame, waitForViewer3dGpu } from './wait-for-viewer3d-gpu';

function gpu() {
  const sync = {} as WebGLSync;
  const gl = {
    SYNC_GPU_COMMANDS_COMPLETE: 37143,
    ALREADY_SIGNALED: 37146,
    TIMEOUT_EXPIRED: 37147,
    CONDITION_SATISFIED: 37148,
    WAIT_FAILED: 37149,
    isContextLost: vi.fn(() => false),
    fenceSync: vi.fn((): WebGLSync | null => sync),
    clientWaitSync: vi.fn(() => 37147),
    deleteSync: vi.fn(),
    flush: vi.fn(),
  };
  return { gl, sync, context: gl as unknown as WebGL2RenderingContext };
}

afterEach(() => vi.useRealTimers());

describe('waitForViewer3dGpu', () => {
  it('bounds the whole preparation even when completed frames keep being replaced', async () => {
    vi.useFakeTimers();
    const { gl, context } = gpu();
    gl.clientWaitSync.mockReturnValue(gl.ALREADY_SIGNALED);
    let revision = 0;
    const scheduler = {
      getRevision: () => revision,
      renderNow: () => {
        revision += 1;
      },
      requestRender: vi.fn(),
      dispose: vi.fn(),
    };
    const rejected = expect(prepareViewer3dFrame(context, scheduler, [])).rejects.toThrow(
      'in time',
    );
    await vi.advanceTimersByTimeAsync(30_016);
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
    expect(gl.deleteSync).toHaveBeenCalledTimes(gl.fenceSync.mock.calls.length);
  });

  it('waits again when a resize or mutation arrives during preparation', async () => {
    vi.useFakeTimers();
    const { gl, context } = gpu();
    let revision = 0;
    const scheduler = {
      getRevision: () => revision,
      renderNow: vi.fn(),
      requestRender: vi.fn(),
      dispose: vi.fn(),
    };
    const done = vi.fn();
    const pending = prepareViewer3dFrame(context, scheduler, []).then(done);
    revision += 1;
    gl.clientWaitSync.mockReturnValue(gl.CONDITION_SATISFIED);
    await vi.advanceTimersByTimeAsync(16);
    expect(scheduler.renderNow).toHaveBeenCalledTimes(2);
    expect(done).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(16);
    await pending;
    expect(gl.deleteSync).toHaveBeenCalledTimes(2);
  });

  it('yields between zero-timeout polls and resolves only after GPU completion', async () => {
    vi.useFakeTimers();
    const { gl, sync, context } = gpu();
    const done = vi.fn();
    const pending = waitForViewer3dGpu(context).then(done);
    expect(gl.flush).toHaveBeenCalledOnce();
    expect(gl.clientWaitSync).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(16);
    expect(gl.clientWaitSync).toHaveBeenCalledWith(sync, 0, 0);
    expect(done).not.toHaveBeenCalled();
    gl.clientWaitSync.mockReturnValue(gl.CONDITION_SATISFIED);
    await vi.advanceTimersByTimeAsync(16);
    await pending;
    expect(done).toHaveBeenCalledOnce();
    expect(gl.deleteSync).toHaveBeenCalledExactlyOnceWith(sync);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels and releases the sync immediately on scene disposal or replacement', async () => {
    vi.useFakeTimers();
    const { gl, context } = gpu();
    const lifetime = new AbortController();
    const replacement = new AbortController();
    const pending = waitForViewer3dGpu(context, [lifetime.signal, replacement.signal]);
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    replacement.abort();
    lifetime.abort();
    await rejected;
    expect(gl.deleteSync).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['lost', 'failed', 'timeout'] as const)(
    'reports %s without leaking a poll',
    async (kind) => {
      vi.useFakeTimers();
      const { gl, context } = gpu();
      const pending = waitForViewer3dGpu(context);
      const rejected = expect(pending).rejects.toThrow(/3D graphics/);
      if (kind === 'lost') gl.isContextLost.mockReturnValue(true);
      if (kind === 'failed') gl.clientWaitSync.mockReturnValue(gl.WAIT_FAILED);
      await vi.advanceTimersByTimeAsync(kind === 'timeout' ? 30_016 : 16);
      await rejected;
      expect(gl.deleteSync).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('rejects null fences and already-aborted requests without starting a timer', async () => {
    vi.useFakeTimers();
    const { gl, context } = gpu();
    const controller = new AbortController();
    controller.abort();
    await expect(waitForViewer3dGpu(context, [controller.signal])).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(gl.fenceSync).not.toHaveBeenCalled();
    gl.fenceSync.mockReturnValue(null);
    await expect(waitForViewer3dGpu(context)).rejects.toThrow('Could not prepare');
    expect(gl.deleteSync).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
