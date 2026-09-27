// SavedCamerasSection — the calibrations of every camera on this machine
// (ADR-446). Each camera keeps its own lens and pose, and the one running is
// used automatically, so a built-in camera and a USB camera can both stay
// calibrated. Shown once there is a second camera to tell apart: two saved
// calibrations, or a running camera that is not the calibrated one.

import type { CameraCaptureBinding } from '../../../core/camera/camera-capture-binding';
import type { CameraModelRecord } from '../../../core/camera/model/camera-model-record';
import {
  savedCameraModels,
  withoutSavedCameraModel,
} from '../../../core/camera/model/saved-cameras';
import type { CameraDevice } from '../../../platform/types';
import { useStore } from '../../state';
import { useCameraStore } from '../../state/camera-store';
import { useOwnCameraModel } from '../active-camera-model';
import { noteStyle, sectionStyle } from './panel-styles';

export function SavedCamerasSection(): JSX.Element | null {
  const cameraModel = useStore((s) => s.project.device.cameraModel);
  const otherCameraModels = useStore((s) => s.project.device.otherCameraModels);
  const updateDeviceProfile = useStore((s) => s.updateDeviceProfile);
  const cameras = useCameraStore((s) => s.cameras);
  const live = useCameraStore((s) => s.sourceState.kind === 'live');
  const own = useOwnCameraModel();
  const saved = savedCameraModels({ cameraModel, otherCameraModels });
  if (saved.length === 0 || (saved.length === 1 && (!live || own !== undefined))) return null;

  const forget = (model: CameraModelRecord): void =>
    updateDeviceProfile(withoutSavedCameraModel({ cameraModel, otherCameraModels }, model));

  return (
    <section style={sectionStyle} aria-label="Calibrated cameras">
      <strong style={titleStyle}>Calibrated cameras</strong>
      <ul style={listStyle}>
        {saved.map((model, index) => (
          <li key={`${model.calibratedAt}-${index}`} style={itemStyle}>
            <div style={textStyle}>
              <span>
                {savedCameraLabel(model.capture, cameras)}
                {live && model === own ? <span style={inUseStyle}> · in use</span> : null}
              </span>
              <span style={noteStyle}>
                Calibrated {new Date(model.calibratedAt).toLocaleDateString()}, average error{' '}
                {model.accuracy.rmsErrorMm.toFixed(2)} mm
              </span>
            </div>
            <button
              type="button"
              className="lf-btn"
              onClick={() => forget(model)}
              title="Forget this camera's calibration. Undo brings it back."
            >
              Forget
            </button>
          </li>
        ))}
      </ul>
      <p style={noteStyle}>
        {live && own === undefined
          ? 'The running camera has no calibration of its own yet. Calibrate it, and the others stay saved.'
          : 'Start any of these cameras and its own calibration is used.'}
      </p>
    </section>
  );
}

/** A short name for the camera a calibration was fitted on. */
export function savedCameraLabel(
  capture: CameraCaptureBinding | undefined,
  cameras: ReadonlyArray<CameraDevice>,
): string {
  if (capture === undefined) return 'Camera from an older calibration';
  switch (capture.sourceKind) {
    case 'usb': {
      const label = cameras.find((camera) => camera.deviceId === capture.sourceId)?.label;
      return label === undefined || label === '' ? 'USB camera' : label;
    }
    case 'machine-jpeg':
      return `Machine camera at ${hostOf(capture.sourceId)}`;
    case 'machine-rtsp':
      return `RTSP camera at ${hostOf(capture.sourceId)}`;
  }
}

function hostOf(sourceId: string): string {
  try {
    return new URL(sourceId).host || sourceId;
  } catch {
    return sourceId;
  }
}

const titleStyle: React.CSSProperties = { fontSize: 12 };
const listStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  margin: 0,
  padding: 0,
  listStyle: 'none',
};
const itemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
};
const textStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  minWidth: 0,
  fontSize: 12,
};
const inUseStyle: React.CSSProperties = { color: 'var(--lf-accent-fg)' };
