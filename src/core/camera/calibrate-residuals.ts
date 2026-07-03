// Reprojection residuals for fisheye calibration (ADR-106, v2.c). Given a flat LM
// parameter vector and a fixed set of board observations, build the constant-length
// residual vector the minimiser drives to zero: for each view and corner, apply the
// pose to the planar board point and project through the existing KB fisheye model.
// Pure core. The residual length is INVARIANT (2·N·V) — null detections and
// behind-camera corners contribute a zero pair, never a variable-length skip, so the
// finite-difference Jacobian columns always line up.

import type { Vec2 } from '../scene';
import { type CameraIntrinsics, type FisheyeDistortion, projectFisheye } from './fisheye';
import type { Mat3 } from './homography';
import { type Tvec, unpackParams, type ViewExtrinsic } from './lm-params';
import { rodriguesToMatrix } from './rodrigues';

/** A board point expressed in a view's camera frame. */
export type CamPoint = { readonly x: number; readonly y: number; readonly z: number };

/** Fixed inputs shared across every residual evaluation of one calibration. */
export type ResidualContext = {
  readonly boardPoints: ReadonlyArray<Vec2>;
  readonly imagePointsPerView: ReadonlyArray<ReadonlyArray<Vec2 | null>>;
  readonly numViews: number;
};

// A point at or behind this depth projects degenerately; it is treated as an
// inactive (zero) residual for this evaluation rather than a divergent penalty.
const Z_MIN = 1e-6;

type Projector = {
  readonly r: Mat3;
  readonly tvec: Tvec;
  readonly intrinsics: CameraIntrinsics;
  readonly distortion: FisheyeDistortion;
};

/**
 * Transform a planar board point (Z=0) into a view's camera frame via P = R·[X,Y,0]+t.
 * The board's zero Z drops column 2 of R, so only its first two columns are read.
 */
export function boardPointToCam(r: Mat3, t: Tvec, board: Vec2): CamPoint {
  return {
    x: r[0] * board.x + r[1] * board.y + t[0],
    y: r[3] * board.x + r[4] * board.y + t[1],
    z: r[6] * board.x + r[7] * board.y + t[2],
  };
}

/**
 * The per-residual-scalar active mask (length 2·N·V), computed once: a corner pair
 * is inactive when its detection is missing. Behind-camera masking is decided per
 * evaluation, not here, because it depends on the current pose parameters.
 */
export function buildActiveMask(ctx: ResidualContext): boolean[] {
  const mask: boolean[] = [];
  const cornerCount = ctx.boardPoints.length;
  for (let view = 0; view < ctx.numViews; view += 1) {
    const detections = ctx.imagePointsPerView[view];
    for (let corner = 0; corner < cornerCount; corner += 1) {
      const active = detections?.[corner] != null;
      mask.push(active, active);
    }
  }
  return mask;
}

/** Build the reprojection residual vector (detected − projected) for `params`. */
export function computeResiduals(
  params: ReadonlyArray<number>,
  ctx: ResidualContext,
  mask: ReadonlyArray<boolean>,
): number[] {
  const cornerCount = ctx.boardPoints.length;
  const out: number[] = [];
  const unpacked = unpackParams(params, ctx.numViews);
  if (unpacked.kind !== 'ok') {
    for (let view = 0; view < ctx.numViews; view += 1) pushZeros(out, cornerCount);
    return out;
  }
  for (let view = 0; view < ctx.numViews; view += 1) {
    appendViewResiduals(
      out,
      ctx,
      mask,
      view,
      unpacked.views[view],
      unpacked.intrinsics,
      unpacked.distortion,
    );
  }
  return out;
}

function appendViewResiduals(
  out: number[],
  ctx: ResidualContext,
  mask: ReadonlyArray<boolean>,
  view: number,
  extrinsic: ViewExtrinsic | undefined,
  intrinsics: CameraIntrinsics,
  distortion: FisheyeDistortion,
): void {
  const cornerCount = ctx.boardPoints.length;
  if (extrinsic === undefined) {
    pushZeros(out, cornerCount);
    return;
  }
  const projector: Projector = {
    r: rodriguesToMatrix(extrinsic.rvec),
    tvec: extrinsic.tvec,
    intrinsics,
    distortion,
  };
  const detections = ctx.imagePointsPerView[view];
  for (let corner = 0; corner < cornerCount; corner += 1) {
    const base = 2 * (view * cornerCount + corner);
    const board = ctx.boardPoints[corner];
    const detection = detections?.[corner];
    if (board === undefined || detection == null || mask[base] === false) {
      out.push(0, 0);
      continue;
    }
    const projected = projectCorner(projector, board);
    if (projected === null) out.push(0, 0);
    else out.push(detection.x - projected.x, detection.y - projected.y);
  }
}

function projectCorner(projector: Projector, board: Vec2): Vec2 | null {
  const cam = boardPointToCam(projector.r, projector.tvec, board);
  if (cam.z <= Z_MIN) return null;
  return projectFisheye(cam.x / cam.z, cam.y / cam.z, projector.intrinsics, projector.distortion);
}

function pushZeros(out: number[], cornerCount: number): void {
  for (let corner = 0; corner < cornerCount; corner += 1) out.push(0, 0);
}
