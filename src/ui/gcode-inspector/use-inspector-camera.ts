import { useEffect, useState, type RefObject } from 'react';
import type { CameraTracking, Viewer3dSceneHandle } from '../viewer3d';
import type { Viewer3dSceneState } from './use-viewer3d-scene';

type CameraMode = CameraTracking['mode'];

export function useInspectorCamera(
  handleRef: RefObject<Viewer3dSceneHandle | null>,
  state: Viewer3dSceneState,
  focus: Omit<CameraTracking, 'mode'>,
  program: unknown,
): { readonly cameraMode: CameraMode; readonly setCameraMode: (mode: CameraMode) => void } {
  const [cameraMode, setCameraMode] = useState<CameraMode>('auto');
  useEffect(() => {
    const handle = handleRef.current;
    handle?.onCameraInteraction(() => setCameraMode('manual'));
    return () => handle?.onCameraInteraction(null);
  }, [handleRef, state]);
  const { point, progress } = focus;
  const missingPoint = point === null;
  useEffect(() => {
    if (state !== 'ready') return;
    handleRef.current?.setCameraTracking({ mode: cameraMode, point, progress });
    // Status snapshots may repeat the same coordinates; avoid restarting the
    // settling animation just because another report object arrived.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleRef, state, cameraMode, point?.x, point?.y, point?.z, missingPoint, progress, program]);
  return { cameraMode, setCameraMode };
}
