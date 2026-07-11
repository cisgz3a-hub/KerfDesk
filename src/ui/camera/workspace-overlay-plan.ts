// What the workspace camera overlay should draw, given the persisted alignment
// and (optionally) the lens calibration. A rectified-basis alignment was solved
// on de-fisheyed pixels, so it MUST be applied to a de-fisheyed frame — the
// still can be rectified in a canvas first, but a live <video> cannot (a CSS
// matrix3d is a linear projective map and cannot represent the nonlinear
// de-fisheye). Rather than warp raw pixels with a rectified homography and show
// a bowed, mis-registered overlay, refuse those cases (Codex re-audit R2).

import {
  rectifyForAlignmentBasis,
  type CameraAlignment,
  type CameraCalibration,
  type RgbaImage,
} from '../../core/camera';

export type WorkspaceOverlayPlan =
  // Draw this (already de-fisheyed when the alignment is rectified) still frame.
  | { readonly kind: 'still'; readonly frame: RgbaImage }
  // Draw the live <video> overlay (raw-basis alignment only).
  | { readonly kind: 'live' }
  // A rectified alignment that cannot be honored for display (no calibration for
  // the still, or a live video that a CSS transform cannot de-fisheye). The
  // operator should capture a still (Update Overlay) to see the aligned overlay.
  | { readonly kind: 'basis-mismatch' }
  | { readonly kind: 'none' };

export function resolveWorkspaceOverlay(args: {
  readonly still: RgbaImage | null;
  readonly hasLiveStream: boolean;
  readonly alignment: CameraAlignment;
  readonly calibration: CameraCalibration | undefined;
}): WorkspaceOverlayPlan {
  const { still, hasLiveStream, alignment, calibration } = args;
  if (still !== null) {
    const rectified = rectifyForAlignmentBasis(still, alignment, calibration);
    return rectified.kind === 'basis-mismatch'
      ? { kind: 'basis-mismatch' }
      : { kind: 'still', frame: rectified.frame };
  }
  if (hasLiveStream) {
    return alignment.basis === 'rectified' ? { kind: 'basis-mismatch' } : { kind: 'live' };
  }
  return { kind: 'none' };
}
