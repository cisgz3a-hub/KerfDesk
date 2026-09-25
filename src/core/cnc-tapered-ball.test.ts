import { describe, expect, it } from 'vitest';
import {
  isValidTaperedBallTipDiameterMm,
  taperedBallCuttingLengthMm,
  taperedBallDiameterAtHeightMm,
  taperedBallEnvelope,
  taperedBallHeightMm,
  type TaperedBallEnvelope,
} from './cnc-tapered-ball';
import type { CncTool } from './scene';

// Amana 46282: a 1/16" ball tip, 5.4 degrees per side, 1" of flutes. The
// stored included angle is twice the listed side angle (ADR-368).
const TBN: CncTool = {
  id: 'tbn',
  name: 'Tapered ball nose',
  kind: 'tapered-ball-nose',
  diameterMm: 6.25,
  tipAngleDeg: 10.8,
  tipDiameterMm: 1.5875,
};

function envelopeOf(tool: CncTool): TaperedBallEnvelope {
  const envelope = taperedBallEnvelope(tool);
  if (envelope === null) throw new Error('expected a modeled envelope');
  return envelope;
}

describe('tapered ball-nose envelope', () => {
  it('places the ball-to-flank tangent point from the tip radius and side angle', () => {
    const envelope = envelopeOf(TBN);
    const side = (5.4 * Math.PI) / 180;

    expect(envelope.ballRadiusMm).toBe(0.79375);
    expect(envelope.tanHalf).toBeCloseTo(Math.tan(side), 12);
    expect(envelope.tangentRadiusMm).toBeCloseTo(0.79375 * Math.cos(side), 12);
    expect(envelope.tangentHeightMm).toBeCloseTo(0.79375 * (1 - Math.sin(side)), 12);
    expect(envelope.outerRadiusMm).toBe(3.125);
  });

  it('is the tip sphere inside the tangent radius and the straight flank beyond it', () => {
    const envelope = envelopeOf(TBN);
    const ball = envelope.ballRadiusMm;

    expect(taperedBallHeightMm(envelope, 0)).toBe(0);
    expect(taperedBallHeightMm(envelope, -1)).toBe(0);
    expect(taperedBallHeightMm(envelope, 0.5)).toBeCloseTo(ball - Math.sqrt(ball ** 2 - 0.25), 12);
    const beyond = envelope.tangentRadiusMm + 1;
    expect(taperedBallHeightMm(envelope, beyond)).toBeCloseTo(
      envelope.tangentHeightMm + 1 / envelope.tanHalf,
      12,
    );
  });

  it('meets the flank with matching height and slope, rising monotonically', () => {
    const envelope = envelopeOf(TBN);
    const tangent = envelope.tangentRadiusMm;
    // Small enough that the ball's curvature at the tangent point (about 1500
    // per mm here) adds under 1e-4 to the one-sided slope.
    const step = 1e-7;
    const below = taperedBallHeightMm(envelope, tangent - step);
    const at = taperedBallHeightMm(envelope, tangent);
    const above = taperedBallHeightMm(envelope, tangent + step);

    expect(at).toBeCloseTo(envelope.tangentHeightMm, 12);
    expect((at - below) / step).toBeCloseTo(1 / envelope.tanHalf, 3);
    expect((above - at) / step).toBeCloseTo(1 / envelope.tanHalf, 3);
    let previous = -1;
    for (let radius = 0; radius <= envelope.outerRadiusMm; radius += 0.01) {
      const height = taperedBallHeightMm(envelope, radius);
      expect(height).toBeGreaterThanOrEqual(previous);
      previous = height;
    }
  });

  it('keeps the flank below the continued tip sphere, so the tip bounds the scallop', () => {
    const envelope = envelopeOf(TBN);
    const ball = envelope.ballRadiusMm;
    for (let radius = envelope.tangentRadiusMm; radius <= ball; radius += 0.001) {
      const sphere = ball - Math.sqrt(Math.max(0, ball ** 2 - radius ** 2));
      expect(taperedBallHeightMm(envelope, radius)).toBeLessThanOrEqual(sphere + 1e-12);
    }
  });

  it('reaches the stored cut diameter at the listed flute length', () => {
    expect(taperedBallCuttingLengthMm(envelopeOf(TBN))).toBeCloseTo(25.4, 1);
    expect(taperedBallDiameterAtHeightMm(1.5875, 10.8, 25.4)).toBeCloseTo(6.25, 2);
  });

  it('inverts the height law, including a height inside the ball', () => {
    const envelope = envelopeOf(TBN);
    for (const radius of [0.3, envelope.tangentRadiusMm, 1.5, 3.125]) {
      const height = taperedBallHeightMm(envelope, radius);
      expect(taperedBallDiameterAtHeightMm(1.5875, 10.8, height)).toBeCloseTo(2 * radius, 9);
    }
    expect(taperedBallDiameterAtHeightMm(1.5875, 10.8, 0)).toBe(0);
  });

  it('models nothing without a ball smaller than the cut diameter and a valid taper', () => {
    const { tipDiameterMm: _tip, ...noTip } = TBN;
    const { tipAngleDeg: _angle, ...noAngle } = TBN;
    expect(taperedBallEnvelope(noTip)).toBeNull();
    expect(taperedBallEnvelope({ ...TBN, tipDiameterMm: 0 })).toBeNull();
    expect(taperedBallEnvelope({ ...TBN, tipDiameterMm: 6.25 })).toBeNull();
    expect(taperedBallEnvelope({ ...TBN, tipDiameterMm: Number.NaN })).toBeNull();
    expect(taperedBallEnvelope(noAngle)).toBeNull();
    expect(taperedBallEnvelope({ ...TBN, tipAngleDeg: 0.5 })).toBeNull();
    expect(taperedBallEnvelope({ ...TBN, tipAngleDeg: 180 })).toBeNull();
    expect(taperedBallEnvelope({ ...TBN, kind: 'ball-nose' })).toBeNull();
    expect(isValidTaperedBallTipDiameterMm(1.5875, 6.25)).toBe(true);
    expect(isValidTaperedBallTipDiameterMm(0, 6.25)).toBe(false);
    expect(isValidTaperedBallTipDiameterMm('1', 6.25)).toBe(false);
  });
});
