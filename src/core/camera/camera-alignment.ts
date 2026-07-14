// Persisted camera→bed alignment (ADR-107 v1, persistence closing the F-CAM1
// promise). The solved 4-point homography plus the camera-pixel basis it was
// solved in, stored on DeviceProfile so the workspace overlay survives reload.
// `basis` records whether the clicked pixels were raw (distorted) or already
// de-fisheyed frames — composing a rectified still with a raw-basis homography
// (or vice versa) would silently mis-register, so consumers must match it.

import type { Mat3 } from './homography';
import { normalizeCameraCaptureBinding, type CameraCaptureBinding } from './camera-capture-binding';

export type CameraAlignment = {
  // Camera-pixel → bed-mm homography (row-major 3×3).
  readonly homography: Mat3;
  // The frame size the clicked pixels were expressed in.
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly basis: 'raw' | 'rectified';
  // Epoch milliseconds, supplied by the caller — core reads no clock.
  readonly alignedAt: number;
  // Physical height of the marker/alignment plane above the machine bed.
  // Required for perspective-correct material-height compensation.
  readonly planeHeightMm?: number;
  // Independent error from the known spacing of the two origin patches. The
  // pair midpoint participates in the solve; the endpoints do not.
  readonly verificationErrorMm?: number;
  readonly capture?: CameraCaptureBinding;
};

/** Validate persisted JSON into a CameraAlignment, or undefined if malformed. */
export function normalizeCameraAlignment(value: unknown): CameraAlignment | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  // Narrowing an already-checked non-null object to read its fields.
  const raw = value as Record<string, unknown>;
  const homography = normalizeMat3(raw.homography);
  const frameWidth = finitePositive(raw.frameWidth);
  const frameHeight = finitePositive(raw.frameHeight);
  const basis = normalizeBasis(raw.basis);
  const alignedAt = finiteNonNegative(raw.alignedAt);
  const planeHeightMm = optionalFiniteNonNegative(raw.planeHeightMm);
  const verificationErrorMm = optionalFiniteNonNegative(raw.verificationErrorMm);
  const capture = normalizeOptionalCapture(raw.capture);
  const requiredInvalid = [homography, frameWidth, frameHeight, basis, alignedAt].some(
    (field) => field === undefined,
  );
  const optionalInvalid = [planeHeightMm, verificationErrorMm, capture].some(
    (field) => field === null,
  );
  if (requiredInvalid || optionalInvalid) {
    return undefined;
  }
  return {
    homography: homography as Mat3,
    frameWidth: frameWidth as number,
    frameHeight: frameHeight as number,
    basis: basis as CameraAlignment['basis'],
    alignedAt: alignedAt as number,
    ...(planeHeightMm === undefined || planeHeightMm === null ? {} : { planeHeightMm }),
    ...(verificationErrorMm === undefined || verificationErrorMm === null
      ? {}
      : { verificationErrorMm }),
    ...(capture === undefined || capture === null ? {} : { capture }),
  };
}

function normalizeOptionalCapture(value: unknown): CameraCaptureBinding | null | undefined {
  if (value === undefined) return undefined;
  return normalizeCameraCaptureBinding(value) ?? null;
}

function normalizeBasis(value: unknown): CameraAlignment['basis'] | undefined {
  return value === 'raw' || value === 'rectified' ? value : undefined;
}

function normalizeMat3(value: unknown): Mat3 | undefined {
  if (!Array.isArray(value) || value.length !== 9) return undefined;
  const entries: number[] = [];
  for (const entry of value) {
    if (typeof entry !== 'number' || !Number.isFinite(entry)) return undefined;
    entries.push(entry);
  }
  // A homography with a zero bottom-right cannot map any finite point.
  if (entries[8] === 0) return undefined;
  // Length and finiteness were just checked; the tuple shape is now safe.
  return entries as unknown as Mat3;
}

function finitePositive(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function finiteNonNegative(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function optionalFiniteNonNegative(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  return finiteNonNegative(value) ?? null;
}
