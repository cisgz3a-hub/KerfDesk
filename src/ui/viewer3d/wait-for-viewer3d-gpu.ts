import type { Viewer3dRenderScheduler } from './create-viewer3d-render-scheduler';

const POLL_INTERVAL_MS = 16;
const GPU_READY_TIMEOUT_MS = 30_000;

/** Owns cancellation for every preparation using this scene's context. */
export function createViewer3dFramePreparation(
  gl: WebGL2RenderingContext | WebGLRenderingContext,
  scheduler: Viewer3dRenderScheduler,
): { prepareToShow: (signal?: AbortSignal) => Promise<void>; dispose: () => void } {
  const lifetime = new AbortController();
  return {
    prepareToShow: (signal) => {
      if (!('fenceSync' in gl)) {
        return Promise.reject(new Error('Preparing the 3D graphics frame requires WebGL 2.'));
      }
      return prepareViewer3dFrame(
        gl,
        scheduler,
        signal ? [lifetime.signal, signal] : [lifetime.signal],
      );
    },
    dispose: () => lifetime.abort(),
  };
}

/** Includes mutations and resize requests arriving while the GPU is working. */
export async function prepareViewer3dFrame(
  gl: WebGL2RenderingContext,
  scheduler: Viewer3dRenderScheduler,
  signals: readonly AbortSignal[],
): Promise<void> {
  const deadline = performance.now() + GPU_READY_TIMEOUT_MS;
  let revision: number;
  do {
    if (signals.some((signal) => signal.aborted)) {
      throw new DOMException('3D preparation cancelled', 'AbortError');
    }
    if (performance.now() >= deadline)
      throw new Error('The 3D graphics frame did not finish in time.');
    revision = scheduler.getRevision();
    scheduler.renderNow();
    await waitForViewer3dGpu(gl, signals, deadline);
  } while (revision !== scheduler.getRevision());
}

/** Waits without blocking the UI before a hidden canvas is presented. */
export function waitForViewer3dGpu(
  gl: WebGL2RenderingContext,
  signals: readonly AbortSignal[] = [],
  deadline = performance.now() + GPU_READY_TIMEOUT_MS,
): Promise<void> {
  if (signals.some((signal) => signal.aborted)) {
    return Promise.reject(new DOMException('3D preparation cancelled', 'AbortError'));
  }
  if (gl.isContextLost()) return Promise.reject(new Error('The 3D graphics context was lost.'));
  const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  if (sync === null) return Promise.reject(new Error('Could not prepare the 3D graphics frame.'));
  return new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      for (const signal of signals) signal.removeEventListener('abort', abort);
      gl.deleteSync(sync);
      if (error === undefined) resolve();
      else reject(error);
    };
    const abort = (): void => finish(new DOMException('3D preparation cancelled', 'AbortError'));
    const poll = (): void => {
      try {
        if (gl.isContextLost()) throw new Error('The 3D graphics context was lost.');
        if (performance.now() >= deadline)
          throw new Error('The 3D graphics frame did not finish in time.');
        const status = gl.clientWaitSync(sync, 0, 0);
        if (status === gl.ALREADY_SIGNALED || status === gl.CONDITION_SATISFIED) {
          finish();
        } else if (status === gl.WAIT_FAILED) {
          finish(new Error('Could not complete the 3D graphics frame.'));
        } else {
          timer = setTimeout(poll, POLL_INTERVAL_MS);
        }
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    };
    for (const signal of signals) signal.addEventListener('abort', abort, { once: true });
    try {
      gl.flush();
      timer = setTimeout(poll, POLL_INTERVAL_MS);
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
