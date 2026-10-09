// Releasing a 3D view's WebGL context (ADR-426). Browsers cap live contexts
// at a handful per page and only reclaim a dropped one when it is garbage
// collected, so opening and closing a view repeatedly could exhaust them and
// blank the next one. A view whose canvas has left the page gives its context
// back at once. A canvas still on the page may be reused for the next
// renderer (React mounts effects twice in development), so it keeps its
// context: losing it there would leave that renderer with a dead one.

import type { Color, WebGLRenderer } from 'three';

/** Preserve the latest clear colour across Three's background-state reset. */
export function preserveViewer3dClearColor(
  renderer: Pick<WebGLRenderer, 'domElement' | 'getClearColor' | 'getClearAlpha' | 'setClearColor'>,
  savedColor: Color,
  requestRender: () => void,
): () => void {
  const canvas = renderer.domElement;
  let savedAlpha = renderer.getClearAlpha();
  // Capture runs before Three's default-phase context restoration rebuilds
  // WebGLBackground. Read here, rather than at loss, to retain later changes.
  const preserve = (): void => {
    renderer.getClearColor(savedColor);
    savedAlpha = renderer.getClearAlpha();
  };
  // Registered after the renderer: Three has restored its internal state
  // before this default-phase listener reapplies the configured background.
  const restore = (): void => {
    renderer.setClearColor(savedColor, savedAlpha);
    requestRender();
  };
  canvas.addEventListener('webglcontextrestored', preserve, true);
  canvas.addEventListener('webglcontextrestored', restore);
  return () => {
    canvas.removeEventListener('webglcontextrestored', preserve, true);
    canvas.removeEventListener('webglcontextrestored', restore);
  };
}

export function disposeViewer3dRenderer(
  renderer: Pick<WebGLRenderer, 'dispose' | 'forceContextLoss' | 'domElement'>,
): void {
  renderer.dispose();
  if (!renderer.domElement.isConnected) renderer.forceContextLoss();
}
