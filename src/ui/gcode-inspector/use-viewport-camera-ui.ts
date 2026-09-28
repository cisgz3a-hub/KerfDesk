// Camera state the viewport chrome shows (ADR-426): whether the view is
// orthographic, for the Ortho toggle, and whether the operator is dragging,
// so the overlays can fade out of the way; and whether a big program is drawn
// simplified at this zoom, which the view says (ADR-485).

import { useEffect, useState, type RefObject } from 'react';
import type { Viewer3dSceneHandle } from '../viewer3d';
// Deep import: the viewer3d barrel is capped at 20 exports by its index contract.
import type { Viewer3dProjection } from '../viewer3d/camera-presets';
import type { Viewer3dDetail } from '../viewer3d/scene-detail';
import type { Viewer3dSceneState } from './use-viewer3d-scene';

export function useViewportCameraUi(
  handleRef: RefObject<Viewer3dSceneHandle | null>,
  state: Viewer3dSceneState,
): {
  readonly projection: Viewer3dProjection;
  readonly moving: boolean;
  /** How the drawn path is simplified for the zoom; null when every move is drawn. */
  readonly detail: Viewer3dDetail | null;
} {
  const [projection, setProjection] = useState<Viewer3dProjection>('perspective');
  const [moving, setMoving] = useState(false);
  const [detail, setDetail] = useState<Viewer3dDetail | null>(null);
  useEffect(() => {
    const handle = handleRef.current;
    if (handle === null) return;
    handle.onProjectionChange(setProjection);
    handle.onCameraMoving(setMoving);
    handle.onDetailChange(setDetail);
    return () => {
      handle.onProjectionChange(null);
      handle.onCameraMoving(null);
      handle.onDetailChange(null);
    };
  }, [handleRef, state]);
  return { projection, moving, detail };
}
