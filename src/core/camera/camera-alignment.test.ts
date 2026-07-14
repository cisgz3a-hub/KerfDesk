import { describe, expect, it } from 'vitest';
import { normalizeCameraAlignment } from './camera-alignment';

const VALID = {
  homography: [1, 0, 5, 0, 1, 7, 0, 0, 1],
  frameWidth: 1920,
  frameHeight: 1080,
  basis: 'raw',
  alignedAt: 1_700_000_000_000,
};

const CAPTURE = {
  version: 1,
  sourceKind: 'machine-jpeg',
  sourceId: 'http://192.168.10.1/frame.jpg',
  width: 1920,
  height: 1080,
  resizeMode: 'unknown',
} as const;

describe('normalizeCameraAlignment', () => {
  it('accepts a well-formed persisted value', () => {
    expect(normalizeCameraAlignment(VALID)).toEqual(VALID);
  });

  it('round-trips a source/capture binding and rejects malformed binding data', () => {
    expect(normalizeCameraAlignment({ ...VALID, capture: CAPTURE })?.capture).toEqual(CAPTURE);
    expect(
      normalizeCameraAlignment({ ...VALID, capture: { ...CAPTURE, height: 0 } }),
    ).toBeUndefined();
  });

  it('round-trips a valid alignment-plane height and rejects malformed heights', () => {
    expect(normalizeCameraAlignment({ ...VALID, planeHeightMm: 6.35 })?.planeHeightMm).toBe(6.35);
    expect(normalizeCameraAlignment({ ...VALID, planeHeightMm: -1 })).toBeUndefined();
    expect(normalizeCameraAlignment({ ...VALID, planeHeightMm: '3' })).toBeUndefined();
  });

  it('round-trips the independent marker verification error', () => {
    expect(
      normalizeCameraAlignment({ ...VALID, verificationErrorMm: 0.42 })?.verificationErrorMm,
    ).toBe(0.42);
    expect(normalizeCameraAlignment({ ...VALID, verificationErrorMm: -0.1 })).toBeUndefined();
  });

  it.each([
    ['non-object', 42],
    ['missing homography', { ...VALID, homography: undefined }],
    ['short homography', { ...VALID, homography: [1, 0, 0] }],
    ['non-finite entry', { ...VALID, homography: [1, 0, 0, 0, 1, 0, 0, 0, Number.NaN] }],
    ['zero h22', { ...VALID, homography: [1, 0, 0, 0, 1, 0, 0, 0, 0] }],
    ['bad width', { ...VALID, frameWidth: 0 }],
    ['bad basis', { ...VALID, basis: 'other' }],
    ['negative timestamp', { ...VALID, alignedAt: -1 }],
  ])('rejects %s', (_label, value) => {
    expect(normalizeCameraAlignment(value)).toBeUndefined();
  });
});
