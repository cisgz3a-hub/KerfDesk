// The saved calibration of the camera that is running (ADR-446). Every camera
// consumer reads the model through here, so switching cameras switches the
// lens and pose with it. With no camera running, or a camera that has no
// calibration of its own, it is the newest calibration, which then reports
// that it belongs to another camera. The model is expressed in the bed frame
// the machine is set up with now (rolling audit 12-P2-2): moved when only the
// bed size or the native offset changed, and not usable after an origin
// change. A camera on the laser head (ADR-449) is placed where the head is
// now, and is not usable while that is unknown, or while the head's Z is away
// from the Z it was calibrated at (Amendment 2).

import { useMemo } from 'react';
import {
  cameraBedFrameNote,
  type CameraBedFrame,
  type CameraBedFrameNote,
} from '../../core/camera/model/camera-bed-frame';
import {
  headCameraZChange,
  isHeadCameraModel,
  modelAtHead,
} from '../../core/camera/model/head-camera';
import { cameraModelInUse, ownModelFor } from '../../core/camera/model/saved-cameras';
import type { CameraModelRecord } from '../../core/camera/model/camera-model-record';
import type { DeviceProfile } from '../../core/devices/device-profile';
import { useStore } from '../state';
import { useCameraStore, type CameraSourceState } from '../state/camera-store';
import { cameraBedFrameNow, modelInBedFrame, useCameraBedFrame } from './camera-bed-frame-now';
import { cameraSourceIdentity } from './frame-source';
import { headPositionNow, useHeadPositionOnBed, type HeadPosition } from './head/head-position';

export function activeCameraModel(
  device: Pick<DeviceProfile, 'cameraModel' | 'otherCameraModels'>,
  sourceState: CameraSourceState,
  head: HeadPosition | null = headPositionNow(),
  bedFrame: CameraBedFrame = cameraBedFrameNow(),
): CameraModelRecord | undefined {
  const model = cameraModelInUse(
    device,
    sourceState.kind === 'live' ? cameraSourceIdentity(sourceState.source) : null,
  );
  if (model === undefined) return undefined;
  const framed = modelInBedFrame(model, bedFrame);
  return framed === undefined ? undefined : placedModel(framed, head);
}

// One placed model per saved model and head position, so a head that has not
// moved gives the very same model (consumers compare by identity to notice a
// change under an in-flight trace or scan).
const placedAt = new WeakMap<
  CameraModelRecord,
  { readonly key: string; readonly model: CameraModelRecord }
>();

function placedModel(
  model: CameraModelRecord,
  head: HeadPosition | null,
): CameraModelRecord | undefined {
  if (!isHeadCameraModel(model)) return model;
  if (head === null || headCameraZChange(model, head.z) !== null) return undefined;
  const key = `${head.x},${head.y}`;
  const cached = placedAt.get(model);
  if (cached?.key === key) return cached.model;
  const placed = modelAtHead(model, head);
  placedAt.set(model, { key, model: placed });
  return placed;
}

/**
 * The running camera's own calibration, with no fallback: what the Camera
 * panel reports as calibrated. With no camera running, the newest.
 */
export function ownCameraModel(
  device: Pick<DeviceProfile, 'cameraModel' | 'otherCameraModels'>,
  sourceState: CameraSourceState,
): CameraModelRecord | undefined {
  return sourceState.kind === 'live'
    ? ownModelFor(device, cameraSourceIdentity(sourceState.source))
    : device.cameraModel;
}

/** The model in use right now, outside React. */
export function activeCameraModelNow(): CameraModelRecord | undefined {
  return activeCameraModel(
    useStore.getState().project.device,
    useCameraStore.getState().sourceState,
  );
}

export function useActiveCameraModel(): CameraModelRecord | undefined {
  const head = useHeadPositionOnBed();
  const bedFrame = useCameraBedFrame();
  const cameraModel = useStore((s) => s.project.device.cameraModel);
  const otherCameraModels = useStore((s) => s.project.device.otherCameraModels);
  const sourceState = useCameraStore((s) => s.sourceState);
  return useMemo(
    () => activeCameraModel({ cameraModel, otherCameraModels }, sourceState, head, bedFrame),
    [cameraModel, otherCameraModels, sourceState, head, bedFrame],
  );
}

export function useOwnCameraModel(): CameraModelRecord | undefined {
  const cameraModel = useStore((s) => s.project.device.cameraModel);
  const otherCameraModels = useStore((s) => s.project.device.otherCameraModels);
  const sourceState = useCameraStore((s) => s.sourceState);
  return useMemo(
    () => ownCameraModel({ cameraModel, otherCameraModels }, sourceState),
    [cameraModel, otherCameraModels, sourceState],
  );
}

/** What the Camera panel says about the running camera's own calibration in the frame now. */
export function useOwnCameraFrameNote(): CameraBedFrameNote | null {
  const own = useOwnCameraModel();
  const bedFrame = useCameraBedFrame();
  return useMemo(
    () => (own === undefined ? null : cameraBedFrameNote(own, bedFrame)),
    [own, bedFrame],
  );
}
