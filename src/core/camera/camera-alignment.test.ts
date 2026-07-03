import { describe, expect, it } from 'vitest';
import { normalizeCameraAlignment } from './camera-alignment';

const VALID = {
  homography: [1, 0, 5, 0, 1, 7, 0, 0, 1],
  frameWidth: 1920,
  frameHeight: 1080,
  basis: 'raw',
  alignedAt: 1_700_000_000_000,
};

describe('normalizeCameraAlignment', () => {
  it('accepts a well-formed persisted value', () => {
    expect(normalizeCameraAlignment(VALID)).toEqual(VALID);
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
