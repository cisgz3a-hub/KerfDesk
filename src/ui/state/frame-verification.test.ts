import { describe, expect, it } from 'vitest';
import { isVerifiedFrameValid, type FrameVerification } from './frame-verification';

const recorded: FrameVerification = {
  boundsSignature: '0,0,50,50',
  wco: { x: 100, y: 80, z: 0 },
  workOriginActive: true,
};
const matching = {
  boundsSignature: '0,0,50,50',
  wco: { x: 100, y: 80, z: 0 },
  workOriginActive: true,
};

describe('isVerifiedFrameValid', () => {
  it('is invalid with no recorded frame', () => {
    expect(isVerifiedFrameValid(null, matching)).toBe(false);
  });

  it('is valid when bounds, WCO, and active flag all match', () => {
    expect(isVerifiedFrameValid(recorded, matching)).toBe(true);
  });

  it('is invalid when the job moved or resized (bounds signature differs)', () => {
    expect(isVerifiedFrameValid(recorded, { ...matching, boundsSignature: '0,0,60,50' })).toBe(
      false,
    );
  });

  it('is invalid when the origin moved (WCO differs)', () => {
    expect(isVerifiedFrameValid(recorded, { ...matching, wco: { x: 100, y: 79, z: 0 } })).toBe(
      false,
    );
  });

  it('is invalid when the origin was cleared (WCO went null)', () => {
    expect(isVerifiedFrameValid(recorded, { ...matching, wco: null })).toBe(false);
  });

  it('is invalid when the custom-origin flag dropped', () => {
    expect(isVerifiedFrameValid(recorded, { ...matching, workOriginActive: false })).toBe(false);
  });

  it('treats two null WCOs as equal (no-position-feedback machine)', () => {
    const nullWco: FrameVerification = {
      boundsSignature: '0,0,50,50',
      wco: null,
      workOriginActive: true,
    };
    expect(isVerifiedFrameValid(nullWco, { ...nullWco })).toBe(true);
  });
});
