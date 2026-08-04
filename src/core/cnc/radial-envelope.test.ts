import { describe, expect, it } from 'vitest';
import type { CncTool } from '../scene';
import {
  conicalRadialEnvelope,
  radialEnvelopeDepthMm,
  radialEnvelopeFootprintMm,
  radialEnvelopeHeightMm,
  radialEnvelopeMaxDepthMm,
  radialEnvelopeRemovalRadiusMm,
  radialEnvelopeSweepRadiiMm,
} from './radial-envelope';

function engraver(tipDiameterMm?: number): CncTool {
  return {
    id: 'engraver',
    name: '90 degree engraver',
    kind: 'engraving',
    diameterMm: 2,
    tipAngleDeg: 90,
    ...(tipDiameterMm === undefined ? {} : { tipDiameterMm }),
  };
}

describe('conical radial envelope', () => {
  it('preserves the ideal pointed-cone law', () => {
    const envelope = conicalRadialEnvelope(engraver(), 90);
    expect(envelope).not.toBeNull();
    if (envelope === null) return;

    expect(envelope.tipRadiusMm).toBe(0);
    expect(radialEnvelopeFootprintMm(envelope, 0.6)).toBeCloseTo(0.6, 12);
    expect(radialEnvelopeDepthMm(envelope, 0.6)).toBeCloseTo(0.6, 12);
    expect(radialEnvelopeMaxDepthMm(envelope)).toBeCloseTo(1, 12);
  });

  it('uses a flat tip followed by one monotone conical flank', () => {
    const envelope = conicalRadialEnvelope(engraver(0.4), 90);
    expect(envelope).not.toBeNull();
    if (envelope === null) return;

    expect(envelope.tipRadiusMm).toBeCloseTo(0.2, 12);
    expect(radialEnvelopeFootprintMm(envelope, 0)).toBeCloseTo(0.2, 12);
    expect(radialEnvelopeFootprintMm(envelope, 0.5)).toBeCloseTo(0.7, 12);
    expect(radialEnvelopeHeightMm(envelope, 0.2)).toBe(0);
    expect(radialEnvelopeHeightMm(envelope, 0.7)).toBeCloseTo(0.5, 12);
    expect(radialEnvelopeMaxDepthMm(envelope)).toBeCloseTo(0.8, 12);
  });

  it.each([
    ['below', 0.19, 0],
    ['at', 0.2, 0],
    ['above', 0.21, 0.01],
  ] as const)('maps %s-tip clearance conservatively', (_label, clearanceMm, expectedDepthMm) => {
    const envelope = conicalRadialEnvelope(engraver(0.4), 90);
    expect(envelope).not.toBeNull();
    if (envelope === null) return;
    expect(radialEnvelopeDepthMm(envelope, clearanceMm)).toBeCloseTo(expectedDepthMm, 12);
  });

  it('distinguishes a geometric tip footprint from actual zero-depth removal', () => {
    const envelope = conicalRadialEnvelope(engraver(0.4), 90);
    expect(envelope).not.toBeNull();
    if (envelope === null) return;

    expect(radialEnvelopeRemovalRadiusMm(envelope, 0)).toBe(0);
    expect(radialEnvelopeRemovalRadiusMm(envelope, 0.1)).toBeCloseTo(0.3, 12);
    expect(radialEnvelopeSweepRadiiMm(envelope, 0, 0)).toEqual([0, 0]);
    expect(radialEnvelopeSweepRadiiMm(envelope, 0, 0.1)).toEqual([0.2, 0.3]);
  });

  it.each([-0.1, 2, Number.NaN])(
    'does not silently reinterpret an explicitly invalid flat tip as a point: %s',
    (tipDiameterMm) => {
      expect(conicalRadialEnvelope(engraver(tipDiameterMm), 90)).toBeNull();
    },
  );
});
