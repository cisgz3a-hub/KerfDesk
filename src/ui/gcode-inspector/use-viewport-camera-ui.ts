// Camera state the viewport chrome shows (ADR-426): whether the view is
// orthographic, for the Ortho toggle, and whether the operator is dragging,
// so the overlays can fade out of the way.

import { useEffect, useState, type RefObject } from 'react';
import type { Viewer3dSceneHandle } from '../viewer3d';
// Deep import: the viewer3d barrel is capped at 20 exports by its index contract.
import type { Viewer3dProjection } from '../viewer3d/camera-presets';
import type { Viewer3dSceneState } from './use-viewer3d-scene';

export function useViewportCameraUi(
  handleRef: RefObject<Viewer3dSceneHandle | null>,
  state: Viewer3dSceneState,
): { readonly projection: Viewer3dProjection; readonly moving: boolean } {
  const [projection, setProjection] = useState<Viewer3dProjection>('perspective');
  const [moving, setMoving] = useState(false);
  useEffect(() => {
    const handle = handleRef.current;
    if (handle === null) return;
    handle.onProjectionChange(setProjection);
    handle.onCameraMoving(setMoving);
    return () => {
      handle.onProjectionChange(null);
      handle.onCameraMoving(null);
    };
  }, [handleRef, state]);
  return { projection, moving };
}
