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

  // GRBL reports WCO in the very next status after any offset change, so the
  // first report equal to the assumed zero does not move the origin (ADR-375).
  it('accepts a first reported zero WCO as the zero assumed without a custom origin', () => {
    const assumed: FrameVerification = {
      boundsSignature: '0,0,50,50',
      wco: null,
      workOriginActive: false,
    };
    expect(isVerifiedFrameValid(assumed, { ...assumed, wco: { x: 0, y: 0, z: 0 } })).toBe(true);
    expect(isVerifiedFrameValid(assumed, { ...assumed, wco: { x: 0, y: 0, z: -5 } })).toBe(false);
    expect(isVerifiedFrameValid(assumed, { ...assumed, wco: { x: 150, y: 100, z: 0 } })).toBe(
      false,
    );
    const unresolved = { ...assumed, workOriginActive: true };
    expect(isVerifiedFrameValid(unresolved, { ...unresolved, wco: { x: 0, y: 0, z: 0 } })).toBe(
      false,
    );
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
