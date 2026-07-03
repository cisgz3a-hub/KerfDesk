// Flat LM parameter-vector layout for fisheye calibration (ADR-107, v2.c).
// The minimiser optimises one number[]; this module is the single source of truth
// for its layout: [fx, fy, cx, cy, k1, k2, k3, k4] then six numbers per view
// (rvec x3, tvec x3). Pack/unpack are exact inverses. Pure core. Reads are guarded
// with explicit undefined checks that fail the unpack — never `?? 0`, which would
// silently turn a layout bug into a zero parameter.

import type { CameraIntrinsics, FisheyeDistortion } from './fisheye';
import type { Rvec } from './rodrigues';

/** Camera-frame translation of a board pose (mm). */
export type Tvec = readonly [number, number, number];

/** One view's pose: axis-angle rotation plus translation. */
export type ViewExtrinsic = { readonly rvec: Rvec; readonly tvec: Tvec };

/** fx, fy, cx, cy, k1, k2, k3, k4 — the shared intrinsics block. */
export const GLOBAL_PARAM_COUNT = 8;
/** rvec (3) + tvec (3) per view. */
export const PER_VIEW_PARAM_COUNT = 6;

export type UnpackResult =
  | {
      readonly kind: 'ok';
      readonly intrinsics: CameraIntrinsics;
      readonly distortion: FisheyeDistortion;
      readonly views: ReadonlyArray<ViewExtrinsic>;
    }
  | { readonly kind: 'failed'; readonly reason: 'bad-length' };

/** Index of view `viewIndex`'s rvec within the flat parameter vector. */
export function rvecOffset(viewIndex: number): number {
  return GLOBAL_PARAM_COUNT + PER_VIEW_PARAM_COUNT * viewIndex;
}

/** Index of view `viewIndex`'s tvec within the flat parameter vector. */
export function tvecOffset(viewIndex: number): number {
  return rvecOffset(viewIndex) + 3;
}

/** Flatten intrinsics, distortion, and per-view extrinsics into one parameter vector. */
export function packParams(
  intrinsics: CameraIntrinsics,
  distortion: FisheyeDistortion,
  views: ReadonlyArray<ViewExtrinsic>,
): number[] {
  const params = [
    intrinsics.fx,
    intrinsics.fy,
    intrinsics.cx,
    intrinsics.cy,
    distortion[0],
    distortion[1],
    distortion[2],
    distortion[3],
  ];
  for (const view of views) {
    params.push(view.rvec[0], view.rvec[1], view.rvec[2], view.tvec[0], view.tvec[1], view.tvec[2]);
  }
  return params;
}

/** Recover intrinsics, distortion, and `numViews` extrinsics from a parameter vector. */
export function unpackParams(params: ReadonlyArray<number>, numViews: number): UnpackResult {
  const expectedLength = GLOBAL_PARAM_COUNT + PER_VIEW_PARAM_COUNT * numViews;
  if (numViews < 0 || params.length !== expectedLength)
    return { kind: 'failed', reason: 'bad-length' };
  const focal = readQuad(params, 0);
  const distortion = readQuad(params, 4);
  if (focal === null || distortion === null) return { kind: 'failed', reason: 'bad-length' };
  const views: ViewExtrinsic[] = [];
  for (let i = 0; i < numViews; i += 1) {
    const rvec = readTriple(params, rvecOffset(i));
    const tvec = readTriple(params, tvecOffset(i));
    if (rvec === null || tvec === null) return { kind: 'failed', reason: 'bad-length' };
    views.push({ rvec, tvec });
  }
  return {
    kind: 'ok',
    intrinsics: { fx: focal[0], fy: focal[1], cx: focal[2], cy: focal[3] },
    distortion,
    views,
  };
}

function readQuad(
  params: ReadonlyArray<number>,
  offset: number,
): readonly [number, number, number, number] | null {
  const a = params[offset];
  const b = params[offset + 1];
  const c = params[offset + 2];
  const d = params[offset + 3];
  if (a === undefined || b === undefined || c === undefined || d === undefined) return null;
  return [a, b, c, d];
}

function readTriple(
  params: ReadonlyArray<number>,
  offset: number,
): readonly [number, number, number] | null {
  const a = params[offset];
  const b = params[offset + 1];
  const c = params[offset + 2];
  if (a === undefined || b === undefined || c === undefined) return null;
  return [a, b, c];
}
