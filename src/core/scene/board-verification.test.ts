import { describe, expect, it } from 'vitest';
import {
  boardVerificationPoint,
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
});

describe('captured board correction policy', () => {
  it('derives scene shapes and identifies the two origin-changing anchors', () => {
    expect(capturedBoardShape(RECT)).toEqual({ kind: 'rect', widthMm: 100, heightMm: 60 });
    expect(capturedBoardShape(CIRCLE)).toEqual({ kind: 'circle', diameterMm: 80 });
    expect(verificationTargetChangesOrigin({ kind: 'rect', anchor: 'bottom-left' })).toBe(true);
    expect(verificationTargetChangesOrigin({ kind: 'circle', anchor: 'center' })).toBe(true);
    expect(verificationTargetChangesOrigin({ kind: 'circle', anchor: 'rim-top' })).toBe(false);
  });
});

// ADR-636: check points and corrections follow the device origin's axis
// directions, so "top-right" is the board's back-right corner on every
// origin corner (machine +X runs left on right origins, +Y toward the
// operator on rear origins).
describe('board check points on every origin corner', () => {
  const origin = { x: 200, y: 150 };
  it.each([
    ['front-left', { x: 1, y: 1 }, { br: [300, 150], tr: [300, 210], tl: [200, 210] }],
    ['front-right', { x: -1, y: 1 }, { br: [100, 150], tr: [100, 210], tl: [200, 210] }],
    ['rear-left', { x: 1, y: -1 }, { br: [300, 150], tr: [300, 90], tl: [200, 90] }],
    ['rear-right', { x: -1, y: -1 }, { br: [100, 150], tr: [100, 90], tl: [200, 90] }],
  ] as const)('puts rectangle corners on the board for a %s origin', (_, axisSigns, corners) => {
    const rect: CapturedBoardGeometry = {
      kind: 'rect',
      origin,
      widthMm: 100,
      heightMm: 60,
      axisSigns,
    };
    const at = (anchor: 'bottom-left' | 'bottom-right' | 'top-right' | 'top-left') =>
      boardVerificationPoint(rect, { kind: 'rect', anchor });
    expect(at('bottom-left')).toEqual(origin);
    expect(at('bottom-right')).toEqual({ x: corners.br[0], y: corners.br[1] });
    expect(at('top-right')).toEqual({ x: corners.tr[0], y: corners.tr[1] });
    expect(at('top-left')).toEqual({ x: corners.tl[0], y: corners.tl[1] });
  });

  it.each([
    [
      'front-right',
      { x: -1, y: 1 },
      { top: [100, 120], right: [60, 80], bottom: [100, 40], left: [140, 80] },
    ],
    [
      'rear-left',
      { x: 1, y: -1 },
      { top: [100, 40], right: [140, 80], bottom: [100, 120], left: [60, 80] },
    ],
    [
      'rear-right',
      { x: -1, y: -1 },
      { top: [100, 40], right: [60, 80], bottom: [100, 120], left: [140, 80] },
    ],
  ] as const)(
    'puts circle rim points on the physical side for a %s origin',
    (_, axisSigns, rim) => {
      const circle: CapturedBoardGeometry = { ...CIRCLE, axisSigns } as CapturedBoardGeometry;
      const at = (anchor: 'rim-top' | 'rim-right' | 'rim-bottom' | 'rim-left') =>
        boardVerificationPoint(circle, { kind: 'circle', anchor });
      expect(at('rim-top')).toEqual({ x: rim.top[0], y: rim.top[1] });
      expect(at('rim-right')).toEqual({ x: rim.right[0], y: rim.right[1] });
      expect(at('rim-bottom')).toEqual({ x: rim.bottom[0], y: rim.bottom[1] });
      expect(at('rim-left')).toEqual({ x: rim.left[0], y: rim.left[1] });
    },
  );

  it('corrects a rear-right rectangle from its checked corners', () => {
    const rect: CapturedBoardGeometry = {
      kind: 'rect',
      origin,
      widthMm: 100,
      heightMm: 60,
      axisSigns: { x: -1, y: -1 },
    };
    const width = correctCapturedBoardGeometry(
      rect,
      { kind: 'rect', anchor: 'bottom-right' },
      { x: 95, y: 152 },
    );
    expect(width?.geometry).toEqual({ ...rect, widthMm: 105 });
    expect(width?.crossAxisErrorMm).toBe(2);
    const height = correctCapturedBoardGeometry(
      rect,
      { kind: 'rect', anchor: 'top-left' },
      { x: 199, y: 85 },
    );
    expect(height?.geometry).toEqual({ ...rect, heightMm: 65 });
    expect(height?.crossAxisErrorMm).toBe(1);
    const both = correctCapturedBoardGeometry(
      rect,
      { kind: 'rect', anchor: 'top-right' },
      { x: 90, y: 80 },
    );
    expect(both?.geometry).toEqual({ ...rect, widthMm: 110, heightMm: 70 });
    // A "top-right" behind the origin on this machine would invert the board.
    expect(
      correctCapturedBoardGeometry(rect, { kind: 'rect', anchor: 'top-right' }, { x: 210, y: 160 }),
    ).toBeNull();
  });
});
