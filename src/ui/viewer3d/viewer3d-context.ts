// Releasing a 3D view's WebGL context (ADR-426). Browsers cap live contexts
// at a handful per page and only reclaim a dropped one when it is garbage
// collected, so opening and closing a view repeatedly could exhaust them and
// blank the next one. A view whose canvas has left the page gives its context
// back at once. A canvas still on the page may be reused for the next
// renderer (React mounts effects twice in development), so it keeps its
// context: losing it there would leave that renderer with a dead one.

import type { WebGLRenderer } from 'three';

export function disposeViewer3dRenderer(
  renderer: Pick<WebGLRenderer, 'dispose' | 'forceContextLoss' | 'domElement'>,
): void {
  renderer.dispose();
  if (!renderer.domElement.isConnected) renderer.forceContextLoss();
}
