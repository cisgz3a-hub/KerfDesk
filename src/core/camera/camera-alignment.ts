// Persisted camera→bed alignment (ADR-105 v1, persistence closing the F-CAM1
// promise). The solved 4-point homography plus the camera-pixel basis it was
// solved in, stored on DeviceProfile so the workspace overlay survives reload.
// `basis` records whether the clicked pixels were raw (distorted) or already
// de-fisheyed frames — composing a rectified still with a raw-basis homography
// (or vice versa) would silently mis-register, so consumers must match it.

import type { Mat3 } from './homography';

export type CameraAlignment = {
  // Camera-pixel → bed-mm homography (row-major 3×3).
  readonly homography: Mat3;
  // The frame size the clicked pixels were expressed in.
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly basis: 'raw' | 'rectified';
  // Epoch milliseconds, supplied by the caller — core reads no clock.
  readonly alignedAt: number;
};

/** Validate persisted JSON into a CameraAlignment, or undefined if malformed. */
export function normalizeCameraAlignment(value: unknown): CameraAlignment | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  // Narrowing an already-checked non-null object to read its fields.
  const raw = value as Record<string, unknown>;
  const homography = normalizeMat3(raw.homography);
  const frameWidth = finitePositive(raw.frameWidth);
  const frameHeight = finitePositive(raw.frameHeight);
  const basis = raw.basis === 'raw' || raw.basis === 'rectified' ? raw.basis : undefined;
  const alignedAt = finiteNonNegative(raw.alignedAt);
  if (
    homography === undefined ||
    frameWidth === undefined ||
    frameHeight === undefined ||
    basis === undefined ||
    alignedAt === undefined
  ) {
    return undefined;
  }
  return { homography, frameWidth, frameHeight, basis, alignedAt };
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
