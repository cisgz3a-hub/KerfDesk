import type { FixtureCameraContext } from '../../../core/camera/fixtures/fixture-template';
import { useStore } from '../../state';
import { useCameraStore } from '../../state/camera-store';
import { activeCameraModel, ownCameraModel } from '../active-camera-model';

/** Snapshot only. No calibration, focus, source or controller settings are written. */
export function fixtureCameraContextNow(): FixtureCameraContext | undefined {
  const { device } = useStore.getState().project;
  const camera = useCameraStore.getState();
  if (
    camera.sourceState.kind !== 'live' ||
    ownCameraModel(device, camera.sourceState) === undefined
  )
    return undefined;
  const model = activeCameraModel(device, camera.sourceState);
  return model === undefined
    ? undefined
    : { model, surfaceHeightMm: camera.surfaceHeightMm, heightAreas: camera.heightAreas };
}
