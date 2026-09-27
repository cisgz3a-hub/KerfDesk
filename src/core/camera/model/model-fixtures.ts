// Test support (ADR-440): known cameras and poses for the model and target
// tests. A realistic wide-angle overhead camera (about 130° across a 16:9
// frame) looking down at a 400 mm bed from behind and above, as enclosed
// diode lasers mount theirs. Not shipped code.

import type { Mat3 } from '../homography';
import { rotationToRvec } from '../rodrigues';
import type { CameraCaptureBinding } from '../camera-capture-binding';
import type { CameraPose, LensModel } from './camera-model';
import type { CameraModelRecord } from './camera-model-record';

type Triple = readonly [number, number, number];

export function wideLens(width = 1280): LensModel {
  const s = width / 1280;
  return {
    intrinsics: { fx: 560 * s, fy: 560 * s, cx: 652 * s, cy: 355 * s },
    distortion: [-0.02, 0.01, -0.004, 0.0005],
    imageWidth: width,
    imageHeight: Math.round((width * 9) / 16),
  };
}

/** Pose of a camera at `centre` looking at `target` (world mm, z down into the bed). */
export function lookAt(centre: Triple, target: Triple): CameraPose {
  const z = normalise([target[0] - centre[0], target[1] - centre[1], target[2] - centre[2]]);
  const y = normalise(cross(z, [1, 0, 0]));
  const x = cross(y, z);
  const r: Mat3 = [x[0], x[1], x[2], y[0], y[1], y[2], z[0], z[1], z[2]];
  return {
    rvec: rotationToRvec(r),
    tvec: [
      -(r[0] * centre[0] + r[1] * centre[1] + r[2] * centre[2]),
      -(r[3] * centre[0] + r[4] * centre[1] + r[5] * centre[2]),
      -(r[6] * centre[0] + r[7] * centre[1] + r[8] * centre[2]),
    ],
  };
}

/** The overhead camera of an enclosed 400 mm machine, 360 mm above the bed. */
export function overheadPose(): CameraPose {
  return lookAt([200, -30, -360], [200, 210, 0]);
}

function normalise(v: Triple): Triple {
  const n = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / n, v[1] / n, v[2] / n];
}

function cross(a: Triple, b: Triple): Triple {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** A saved calibration of the overhead camera, as the machine profile stores it. */
export function savedCameraModel(capture?: CameraCaptureBinding): CameraModelRecord {
  return {
    version: 1,
    lens: wideLens(),
    pose: overheadPose(),
    ...(capture === undefined ? {} : { capture }),
    accuracy: {
      rmsErrorMm: 0.08,
      maxErrorMm: 0.24,
      foundMarks: 96,
      expectedMarks: 100,
      targetHeightMm: 3,
    },
    calibratedAt: '2026-09-26T12:00:00.000Z',
  };
}
