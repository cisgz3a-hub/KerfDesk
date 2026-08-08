import { describe, expect, it, vi } from 'vitest';
import { createViewer3dRenderScheduler } from './create-viewer3d-render-scheduler';

const FRAME_ID = 17;
const FRAME_TIME_MS = 20;
const NO_PENDING_FRAME_ERROR = 'No animation frame is pending';

function frameHarness(): {
  readonly api: Pick<typeof globalThis, 'requestAnimationFrame' | 'cancelAnimationFrame'>;
  readonly requestFrame: ReturnType<typeof vi.fn>;
  readonly cancelFrame: ReturnType<typeof vi.fn>;
  readonly runFrame: () => void;
} {
  let callback: FrameRequestCallback | null = null;
  const requestFrame = vi.fn((next: FrameRequestCallback) => {
    callback = next;
    return FRAME_ID;
  });
  const cancelFrame = vi.fn();
  return {
    api: { requestAnimationFrame: requestFrame, cancelAnimationFrame: cancelFrame },
    requestFrame,
    cancelFrame,
    runFrame: () => {
      const next = callback;
      callback = null;
      if (next === null) throw new Error(NO_PENDING_FRAME_ERROR);
      next(FRAME_TIME_MS);
    },
  };
}

describe('createViewer3dRenderScheduler', () => {
  it('coalesces scene mutations into one animation-frame render', () => {
    const frame = frameHarness();
    const render = vi.fn();
    const scheduler = createViewer3dRenderScheduler({ render, frameApi: frame.api });

    scheduler.requestRender();
    scheduler.requestRender();

    expect(frame.requestFrame).toHaveBeenCalledTimes(1);
    frame.runFrame();
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('renders captures synchronously and cancels the stale scheduled frame', () => {
    const frame = frameHarness();
    const render = vi.fn();
    const scheduler = createViewer3dRenderScheduler({ render, frameApi: frame.api });

    scheduler.requestRender();
    scheduler.renderNow();

    expect(frame.cancelFrame).toHaveBeenCalledWith(FRAME_ID);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('cancels a pending frame on disposal', () => {
    const frame = frameHarness();
    const scheduler = createViewer3dRenderScheduler({ render: vi.fn(), frameApi: frame.api });

    scheduler.requestRender();
    scheduler.dispose();

    expect(frame.cancelFrame).toHaveBeenCalledWith(FRAME_ID);
  });

  it('replaces and removes the controls direct-render listener', () => {
    const render = vi.fn();
    const renderChangeEvents = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    const scheduler = createViewer3dRenderScheduler({ render, renderChangeEvents });

    expect(renderChangeEvents.removeEventListener).toHaveBeenCalledWith('change', render);
    expect(renderChangeEvents.addEventListener).toHaveBeenCalledWith(
      'change',
      scheduler.requestRender,
    );
    scheduler.dispose();
    expect(renderChangeEvents.removeEventListener).toHaveBeenLastCalledWith(
      'change',
      scheduler.requestRender,
    );
  });
});
