import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

type AnimationFrameApi = Pick<typeof globalThis, 'requestAnimationFrame' | 'cancelAnimationFrame'>;
type RenderChangeEvents = Pick<OrbitControls, 'addEventListener' | 'removeEventListener'>;

type Viewer3dRenderSchedulerArgs = {
  readonly render: () => void;
  readonly renderChangeEvents?: RenderChangeEvents;
  readonly frameApi?: AnimationFrameApi;
};

/** Coalesced next-frame rendering with synchronous capture and explicit disposal. */
export type Viewer3dRenderScheduler = {
  readonly requestRender: () => void;
  readonly renderNow: () => void;
  readonly dispose: () => void;
};

/** Coalesces scene mutations from one browser task into a single animation-frame render. */
export function createViewer3dRenderScheduler(
  args: Viewer3dRenderSchedulerArgs,
): Viewer3dRenderScheduler {
  const { render, renderChangeEvents, frameApi = globalThis } = args;
  let frameId: number | null = null;
  const cancelPending = (): void => {
    if (frameId === null) return;
    frameApi.cancelAnimationFrame(frameId);
    frameId = null;
  };
  const requestRender = (): void => {
    if (frameId !== null) return;
    frameId = frameApi.requestAnimationFrame(() => {
      frameId = null;
      render();
    });
  };
  renderChangeEvents?.removeEventListener('change', render);
  renderChangeEvents?.addEventListener('change', requestRender);
  return {
    requestRender,
    renderNow: () => {
      cancelPending();
      render();
    },
    dispose: () => {
      renderChangeEvents?.removeEventListener('change', requestRender);
      cancelPending();
    },
  };
}
