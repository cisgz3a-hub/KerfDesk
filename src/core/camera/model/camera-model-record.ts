// The camera model as the machine profile saves it (ADR-440): one lens and one
// camera pose, fitted together from the engraved bed target, plus the frame
// it was fitted on and how accurate the fit measured on the bed. It replaces
// the separate lens calibration, 4-point alignment and height compensation of
// the old camera stack, which never agreed with each other. Pure core.

import {
  normalizeCameraCaptureBinding,
  type CameraCaptureBinding,
} from '../camera-capture-binding';
import type { FisheyeDistortion } from '../fisheye';
import { cameraCentre, scaleLens, type CameraPose, type LensModel } from './camera-model';

export type CameraModelAccuracy = {
  /** Root-mean-square distance between each engraved ring and where the model puts it, mm. */
  readonly rmsErrorMm: number;
  readonly maxErrorMm: number;
  readonly foundMarks: number;
  readonly expectedMarks: number;
  /** Surface height of the engraved target the fit was measured at, mm. */
  readonly targetHeightMm: number;
};

export type CameraModelRecord = {
  readonly version: 1;
  readonly lens: LensModel;
  readonly pose: CameraPose;
  /** The camera and frame size the model was fitted on; absent when unknown. */
  readonly capture?: CameraCaptureBinding;
  readonly accuracy: CameraModelAccuracy;
  /** ISO-8601 time of the calibration. */
  readonly calibratedAt: string;
};

// A frame whose aspect ratio differs from the calibrated one by more than this
// was cropped, not just scaled, so the lens no longer describes it.
const ASPECT_TOLERANCE = 0.01;

/**
 * The lens expressed in the pixels of a `width` × `height` frame, or null when
 * that frame is not a plain rescale of the calibrated one.
 */
export function lensForFrame(
  record: CameraModelRecord,
  width: number,
  height: number,
): LensModel | null {
  const { imageWidth, imageHeight } = record.lens;
  if (!(width > 0 && height > 0)) return null;
  const aspect = width / height / (imageWidth / imageHeight);
  if (Math.abs(aspect - 1) > ASPECT_TOLERANCE) return null;
  return width === imageWidth && height === imageHeight
    ? record.lens
    : scaleLens(record.lens, width, height);
}

/** Camera height above the bed surface, mm (world z points into the bed). */
export function cameraModelHeightMm(record: CameraModelRecord): number {
  return -cameraCentre(record.pose).z;
}

export function normalizeCameraModelRecord(value: unknown): CameraModelRecord | undefined {
  if (!isRecord(value) || value['version'] !== 1) return undefined;
  const lens = normalizeLens(value['lens']);
  const pose = normalizePose(value['pose']);
  const accuracy = normalizeAccuracy(value['accuracy']);
  const calibratedAt = value['calibratedAt'];
  if (lens === undefined || pose === undefined || accuracy === undefined) return undefined;
  if (typeof calibratedAt !== 'string' || calibratedAt.length === 0) return undefined;
  const capture =
    value['capture'] === undefined ? undefined : normalizeCameraCaptureBinding(value['capture']);
  if (value['capture'] !== undefined && capture === undefined) return undefined;
  return {
    version: 1,
    lens,
    pose,
    ...(capture === undefined ? {} : { capture }),
    accuracy,
    calibratedAt,
  };
}

function normalizeLens(value: unknown): LensModel | undefined {
  if (!isRecord(value) || !isRecord(value['intrinsics'])) return undefined;
  const k = value['intrinsics'];
  const fx = positive(k['fx']);
  const fy = positive(k['fy']);
  const cx = finite(k['cx']);
  const cy = finite(k['cy']);
  const imageWidth = positive(value['imageWidth']);
  const imageHeight = positive(value['imageHeight']);
  const distortion = finiteTuple(value['distortion'], 4);
  if (
    fx === undefined ||
    fy === undefined ||
    cx === undefined ||
    cy === undefined ||
    imageWidth === undefined ||
    imageHeight === undefined ||
    distortion === undefined
  ) {
    return undefined;
  }
  return {
    intrinsics: { fx, fy, cx, cy },
    distortion: distortion as unknown as FisheyeDistortion,
    imageWidth,
    imageHeight,
  };
}

function normalizePose(value: unknown): CameraPose | undefined {
  if (!isRecord(value)) return undefined;
  const rvec = finiteTuple(value['rvec'], 3);
  const tvec = finiteTuple(value['tvec'], 3);
  if (rvec === undefined || tvec === undefined) return undefined;
  return {
    rvec: [rvec[0] ?? 0, rvec[1] ?? 0, rvec[2] ?? 0],
    tvec: [tvec[0] ?? 0, tvec[1] ?? 0, tvec[2] ?? 0],
  };
}

function normalizeAccuracy(value: unknown): CameraModelAccuracy | undefined {
  if (!isRecord(value)) return undefined;
  const rmsErrorMm = nonNegative(value['rmsErrorMm']);
  const maxErrorMm = nonNegative(value['maxErrorMm']);
  const foundMarks = nonNegative(value['foundMarks']);
  const expectedMarks = nonNegative(value['expectedMarks']);
  const targetHeightMm = nonNegative(value['targetHeightMm']);
  if (
    rmsErrorMm === undefined ||
    maxErrorMm === undefined ||
    foundMarks === undefined ||
    expectedMarks === undefined ||
    targetHeightMm === undefined
  ) {
    return undefined;
  }
  return { rmsErrorMm, maxErrorMm, foundMarks, expectedMarks, targetHeightMm };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function positive(value: unknown): number | undefined {
  const n = finite(value);
  return n !== undefined && n > 0 ? n : undefined;
}

function nonNegative(value: unknown): number | undefined {
  const n = finite(value);
  return n !== undefined && n >= 0 ? n : undefined;
}

function finiteTuple(value: unknown, length: number): number[] | undefined {
  if (!Array.isArray(value) || value.length !== length) return undefined;
  const out: number[] = [];
  for (const item of value) {
    const n = finite(item);
    if (n === undefined) return undefined;
    out.push(n);
  }
  return out;
}
