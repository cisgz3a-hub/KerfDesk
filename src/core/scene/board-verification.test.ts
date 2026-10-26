import { describe, expect, it } from 'vitest';
import {
  boardVerificationPoint,
  boardVerificationTargets,
  boardVerificationTargetsEqual,
  capturedBoardShape,
  correctCapturedBoardGeometry,
  verificationTargetChangesOrigin,
  type CapturedBoardGeometry,
} from './board-verification';

const RECT: CapturedBoardGeometry = {
  kind: 'rect',
  origin: { x: 10, y: 20 },
  widthMm: 100,
  heightMm: 60,
};
const CIRCLE: CapturedBoardGeometry = {
  kind: 'circle',
  center: { x: 100, y: 80 },
  radiusMm: 40,
};
const OUTLINE: CapturedBoardGeometry = {
  kind: 'outline',
  localPointsMm: [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 70, y: 60 },
    { x: 0, y: 60 },
  ],
  anchorIndices: [0, 1, 2, 3],
  viewSigns: { x: 1, y: 1 },
  measured: [
    { index: 0, machine: { x: 10, y: 20 } },
    { index: 1, machine: { x: 110, y: 20 } },
  ],
};

describe('boardVerificationPoint', () => {
  it('maps rectangle corners and circle center/rim points to machine coordinates', () => {
    expect(boardVerificationPoint(RECT, { kind: 'rect', anchor: 'top-right' })).toEqual({
      x: 110,
      y: 80,
    });
    expect(boardVerificationPoint(CIRCLE, { kind: 'circle', anchor: 'rim-left' })).toEqual({
      x: 60,
      y: 80,
    });
    expect(boardVerificationPoint(CIRCLE, { kind: 'circle', anchor: 'center' })).toEqual({
      x: 100,
      y: 80,
    });
    expect(boardVerificationPoint(RECT, { kind: 'circle', anchor: 'center' })).toBeNull();
    expect(boardVerificationPoint(OUTLINE, { kind: 'outline', index: 2, ordinal: 3 })).toEqual({
      x: 80,
      y: 80,
    });
    expect(boardVerificationPoint(OUTLINE, { kind: 'outline', index: 99, ordinal: 5 })).toBeNull();
  });
});

describe('correctCapturedBoardGeometry', () => {
  it('moves rectangle bottom-left without changing its measured size', () => {
    const result = correctCapturedBoardGeometry(
      RECT,
      { kind: 'rect', anchor: 'bottom-left' },
      { x: 12, y: 18 },
    );
    expect(result?.geometry).toEqual({ ...RECT, origin: { x: 12, y: 18 } });
  });

  it('uses bottom-right for width and top-left for height', () => {
    const width = correctCapturedBoardGeometry(
      RECT,
      { kind: 'rect', anchor: 'bottom-right' },
      { x: 125, y: 22 },
    );
    expect(width?.geometry).toEqual({ ...RECT, widthMm: 115 });
    expect(width?.crossAxisErrorMm).toBe(2);

    const height = correctCapturedBoardGeometry(
      RECT,
      { kind: 'rect', anchor: 'top-left' },
      { x: 9, y: 88 },
    );
    expect(height?.geometry).toEqual({ ...RECT, heightMm: 68 });
    expect(height?.crossAxisErrorMm).toBe(1);
  });

  it('uses top-right for both rectangle dimensions and rejects inverted geometry', () => {
    const result = correctCapturedBoardGeometry(
      RECT,
      { kind: 'rect', anchor: 'top-right' },
      { x: 120, y: 90 },
    );
    expect(result?.geometry).toEqual({ ...RECT, widthMm: 110, heightMm: 70 });
    expect(
      correctCapturedBoardGeometry(RECT, { kind: 'rect', anchor: 'top-right' }, { x: 5, y: 10 }),
    ).toBeNull();
  });

  it('moves a circle center or changes its radius from a confirmed rim point', () => {
    const center = correctCapturedBoardGeometry(
      CIRCLE,
      { kind: 'circle', anchor: 'center' },
      { x: 105, y: 82 },
    );
    expect(center?.geometry).toEqual({ ...CIRCLE, center: { x: 105, y: 82 } });

    const rim = correctCapturedBoardGeometry(
      CIRCLE,
      { kind: 'circle', anchor: 'rim-right' },
      { x: 150, y: 80 },
    );
    expect(rim?.geometry).toEqual({ ...CIRCLE, radiusMm: 50 });
    expect(rim?.crossAxisErrorMm).toBe(0);
  });

  it('reports circle rim confirmation cross-axis error', () => {
    const top = correctCapturedBoardGeometry(
      CIRCLE,
      { kind: 'circle', anchor: 'rim-top' },
      { x: 106, y: 125 },
    );
    expect(top?.geometry).toEqual({ ...CIRCLE, radiusMm: Math.hypot(6, 45) });
    expect(top?.crossAxisErrorMm).toBe(6);

    const left = correctCapturedBoardGeometry(
      CIRCLE,
      { kind: 'circle', anchor: 'rim-left' },
      { x: 60, y: 87 },
    );
    expect(left?.geometry).toEqual({ ...CIRCLE, radiusMm: Math.hypot(-40, 7) });
    expect(left?.crossAxisErrorMm).toBe(7);
  });

  it('refits outline anchors and reports prediction and fit residuals', () => {
    const result = correctCapturedBoardGeometry(
      OUTLINE,
      { kind: 'outline', index: 2, ordinal: 3 },
      { x: 82, y: 79 },
    );
    expect(result?.geometry.kind).toBe('outline');
    expect(result?.crossAxisErrorMm).toBeCloseTo(Math.hypot(2, -1));
    expect(result?.residualMm).toBeGreaterThan(0);
  });
});

describe('captured board correction policy', () => {
  it('derives scene shapes and identifies the two origin-changing anchors', () => {
    expect(capturedBoardShape(RECT)).toEqual({ kind: 'rect', widthMm: 100, heightMm: 60 });
    expect(capturedBoardShape(CIRCLE)).toEqual({ kind: 'circle', diameterMm: 80 });
    expect(verificationTargetChangesOrigin({ kind: 'rect', anchor: 'bottom-left' })).toBe(true);
    expect(verificationTargetChangesOrigin({ kind: 'circle', anchor: 'center' })).toBe(true);
    expect(verificationTargetChangesOrigin({ kind: 'circle', anchor: 'rim-top' })).toBe(false);
    expect(verificationTargetChangesOrigin({ kind: 'outline', index: 2, ordinal: 3 })).toBe(true);
  });

  it('enumerates targets and compares outline indices rather than labels', () => {
    expect(boardVerificationTargets(OUTLINE)).toEqual([
      { kind: 'outline', index: 0, ordinal: 1 },
      { kind: 'outline', index: 1, ordinal: 2 },
      { kind: 'outline', index: 2, ordinal: 3 },
      { kind: 'outline', index: 3, ordinal: 4 },
    ]);
    expect(
      boardVerificationTargetsEqual(
        { kind: 'outline', index: 2, ordinal: 3 },
        { kind: 'outline', index: 2, ordinal: 9 },
      ),
    ).toBe(true);
  });
});
