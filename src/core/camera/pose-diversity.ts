// Pose-diversity check (ADR-108, v2.e). A planar calibration cannot separate focal
// length from camera distance unless the board is seen at genuinely different tilts;
// five near-identical shots converge to a low-RMS but WRONG K (the focal/depth
// ambiguity). This pure check measures the angular spread of the solved view
// rotations so the wizard can refuse to trust a clustered capture.
//
// It is intentionally NOT part of calibrate()'s CalibrationFailure union — the solver
// stays a pure minimiser; whether to fold an 'insufficient-pose-diversity' variant
// into calibrate() is the maintainer's call.

import type { ViewExtrinsics } from './calibrate';
import type { Mat3 } from './homography';
import { multiplyMat3 } from './mat3';
import { rodriguesToMatrix, rotationToRvec } from './rodrigues';

// Default minimum largest-pairwise view-rotation angle (radians, ~8.6 deg) for a
// capture to be considered diverse enough to constrain the focal length. PROVISIONAL
// and tunable: this is the inter-view *tilt* spread (independent of the lens FOV), and
// the right floor depends on the board/working distance — pass `minSpreadRad` to
// override. A passing verdict is a placement aid, not proof of good conditioning.
export const DEFAULT_MIN_POSE_SPREAD_RAD = 0.15;

export type PoseDiversityVerdict =
  | { readonly kind: 'ok'; readonly maxSpreadRad: number }
  | { readonly kind: 'insufficient-pose-diversity'; readonly maxSpreadRad: number };

/** Verdict on whether the solved poses span enough orientation to trust the focal. */
export function checkPoseDiversity(
  views: ReadonlyArray<ViewExtrinsics>,
  minSpreadRad: number = DEFAULT_MIN_POSE_SPREAD_RAD,
): PoseDiversityVerdict {
  const maxSpreadRad = maxPairwiseRotationAngle(views);
  return maxSpreadRad >= minSpreadRad
    ? { kind: 'ok', maxSpreadRad }
    : { kind: 'insufficient-pose-diversity', maxSpreadRad };
}

function maxPairwiseRotationAngle(views: ReadonlyArray<ViewExtrinsics>): number {
  let maxAngle = 0;
  for (let i = 0; i < views.length; i += 1) {
    const a = views[i];
    if (a === undefined) continue;
    const rotA = rodriguesToMatrix(a.rvec);
    for (let j = i + 1; j < views.length; j += 1) {
      const b = views[j];
      if (b === undefined) continue;
      maxAngle = Math.max(maxAngle, relativeAngle(rotA, rodriguesToMatrix(b.rvec)));
    }
  }
  return maxAngle;
}

// The geodesic angle between two rotations is the rotation angle of Rᵃᵀ·Rᵇ.
function relativeAngle(rotA: Mat3, rotB: Mat3): number {
  const relative = multiplyMat3(transpose(rotA), rotB);
  const rvec = rotationToRvec(relative);
  return Math.hypot(rvec[0], rvec[1], rvec[2]);
}

function transpose(m: Mat3): Mat3 {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}
