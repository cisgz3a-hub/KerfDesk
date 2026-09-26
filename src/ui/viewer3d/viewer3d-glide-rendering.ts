// On-demand rendering for a view whose orbit controls glide (ADR-426).
//
// With damping on, the camera keeps moving for a moment after the pointer is
// released, and OrbitControls only advances it inside update(). Each frame
// therefore calls update() before drawing; while the glide lasts, update()
// reports a change, which asks for the next frame. A still view draws nothing.

import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createViewer3dRenderScheduler } from './create-viewer3d-render-scheduler';

export type Viewer3dGlideRendering = {
  /** Draws now: owners call it after a content, size or camera change. */
  readonly render: () => void;
  /** Draws on the next animation frame, once however often it is asked. */
  readonly requestRender: () => void;
  readonly dispose: () => void;
};

export function createViewer3dGlideRendering(
  controls: Pick<OrbitControls, 'addEventListener' | 'removeEventListener' | 'update'>,
  draw: () => void,
): Viewer3dGlideRendering {
  const render = (): void => {
    controls.update();
    draw();
  };
  const scheduler = createViewer3dRenderScheduler({ render, renderChangeEvents: controls });
  return {
    render: scheduler.renderNow,
    requestRender: scheduler.requestRender,
    dispose: scheduler.dispose,
  };
}
