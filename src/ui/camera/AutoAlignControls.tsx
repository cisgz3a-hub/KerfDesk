// AutoAlignControls — one-click camera→bed alignment from engraved markers
// (ADR-107, camera v3). "Add markers" generates the engraveable pattern into
// the project (replacing the scene, like the other calibration generators);
// after burning it, "Auto-align" captures a frame, de-fisheyes it when a lens
// calibration exists, detects the five marker corners, solves the homography,
// and persists the alignment — no manual corner clicks.

import {
  alignMarkerLayout,
  detectAlignMarkers,
  frameMatchesCalibration,
  rectifyImage,
  scaleIntrinsicsToFrame,
  solveMarkerAlignment,
  toGrayImage,
  type CameraAlignment,
  type CameraCalibration,
  type RgbaImage,
} from '../../core/camera';
import { generateCameraAlignPattern } from '../../core/job';
import { useStore } from '../state';
import { useCameraStore } from '../state/camera-store';
import { useToastStore } from '../state/toast-store';
import { captureStreamFrame } from './frame-capture';

export function AutoAlignControls(): JSX.Element {
  const bedWidth = useStore((s) => s.project.device.bedWidth);
  const bedHeight = useStore((s) => s.project.device.bedHeight);
  const calibration = useStore((s) => s.project.device.cameraCalibration);
  const replaceSceneWithGeneratedScene = useStore((s) => s.replaceSceneWithGeneratedScene);
  const updateDeviceProfile = useStore((s) => s.updateDeviceProfile);
  const pushToast = useToastStore((s) => s.pushToast);
  const stream = useCameraStore((s) => s.stream);

  const addMarkers = (): void => {
    const pattern = generateCameraAlignPattern({ bedWidthMm: bedWidth, bedHeightMm: bedHeight });
    replaceSceneWithGeneratedScene(pattern.scene);
    pushToast('Camera alignment markers added — burn them, then press Auto-align.', 'success');
  };

  const autoAlign = async (): Promise<void> => {
    if (stream.kind !== 'live') return;
    const raw = await captureStreamFrame(stream.stream.stream);
    if (raw === null) {
      pushToast('Could not capture a camera frame.', 'error');
      return;
    }
    const { frame, basis } = rectifyIfCalibrated(raw, calibration);
    const detection = detectAlignMarkers(toGrayImage(frame));
    if (detection.kind !== 'ok') {
      pushToast(alignFailureCopy(detection.reason), 'error');
      return;
    }
    const solved = solveMarkerAlignment(detection, alignMarkerLayout(bedWidth, bedHeight));
    if (solved.kind !== 'ok') {
      pushToast('The detected markers were degenerate — re-burn and retry.', 'error');
      return;
    }
    const alignment: CameraAlignment = {
      homography: solved.homography,
      frameWidth: frame.width,
      frameHeight: frame.height,
      basis,
      alignedAt: Date.now(),
    };
    updateDeviceProfile({ cameraAlignment: alignment });
    pushToast(
      basis === 'rectified'
        ? 'Camera aligned from markers (lens-corrected).'
        : 'Camera aligned from markers. Calibrate the lens for best accuracy.',
      'success',
    );
  };

  return (
    <div style={rowStyle}>
      <button
        type="button"
        className="lf-btn"
        onClick={addMarkers}
        title="Replace the scene with the engraveable alignment marker pattern."
      >
        Add markers to project
      </button>
      <button
        type="button"
        className="lf-btn"
        disabled={stream.kind !== 'live'}
        onClick={() => void autoAlign()}
        title="Detect the burned markers in the camera view and align automatically."
      >
        Auto-align
      </button>
    </div>
  );
}

// De-fisheye the capture when a lens calibration exists — the alignment then
// lives in the rectified pixel basis and stays distortion-free bed-wide.
function rectifyIfCalibrated(
  raw: RgbaImage,
  calibration: CameraCalibration | undefined,
): { readonly frame: RgbaImage; readonly basis: 'raw' | 'rectified' } {
  if (calibration === undefined) return { frame: raw, basis: 'raw' };
  const sourceK = frameMatchesCalibration(calibration, raw.width, raw.height)
    ? calibration.intrinsics
    : scaleIntrinsicsToFrame(calibration, raw.width, raw.height);
  const frame = rectifyImage(raw, {
    width: raw.width,
    height: raw.height,
    outputK: sourceK,
    sourceK,
    distortion: calibration.distortion,
  });
  return { frame, basis: 'rectified' };
}

function alignFailureCopy(reason: 'too-few-markers' | 'ambiguous-origin' | 'degenerate'): string {
  switch (reason) {
    case 'too-few-markers':
      return 'Markers not found — clear the bed, check lighting, and make sure all five patches are in view.';
    case 'ambiguous-origin':
      return 'The origin marker pair was not distinct — re-burn the markers and clear other objects.';
    case 'degenerate':
      return 'The detected markers were degenerate — re-burn and retry.';
  }
}

const rowStyle: React.CSSProperties = { display: 'flex', gap: 8, flexWrap: 'wrap' };
