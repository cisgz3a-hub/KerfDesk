import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  CORNER_PROBE_EXTERNAL_MARGIN_MM,
  DEFAULT_FINAL_PARK_MM,
  FLOAT_TOLERANCE_MM,
  MIN_FLANK_HEIGHT_MM,
  validateCornerProbeGeometry,
} from './corner-probe-geometry';

const VALID_GEOMETRY = {
  plateThicknessMm: 15,
  bitDiameterMm: 6.35,
  toolKind: 'end-mill' as const,
  plateCenterOffsetXmm: 15,
  plateCenterOffsetYmm: 15,
  sideDropMm: 6,
  sideClearanceMm: 35,
};

describe('validateCornerProbeGeometry', () => {
  it('derives a flank contact below the plate top and a cutter-clear final park', () => {
    expect(validateCornerProbeGeometry(VALID_GEOMETRY)).toEqual({
      kind: 'valid',
      flankHeightMm: 9,
      finalParkMm: DEFAULT_FINAL_PARK_MM,
    });
  });

  it.each([0.1, 1, 6.999])(
    'rejects plate thickness %s because the side drop leaves no safe flank',
    (plateThicknessMm) => {
      expect(validateCornerProbeGeometry({ ...VALID_GEOMETRY, plateThicknessMm })).toMatchObject({
        kind: 'invalid',
      });
    },
  );

  it('accepts the exact minimum flank-height boundary', () => {
    expect(
      validateCornerProbeGeometry({
        ...VALID_GEOMETRY,
        plateThicknessMm: VALID_GEOMETRY.sideDropMm + MIN_FLANK_HEIGHT_MM,
      }),
    ).toMatchObject({ kind: 'valid', flankHeightMm: MIN_FLANK_HEIGHT_MM });
  });

  it('requires both starting offsets to keep the cutter fully over the plate top', () => {
    const radius = VALID_GEOMETRY.bitDiameterMm / 2;
    const threshold = radius + CORNER_PROBE_EXTERNAL_MARGIN_MM;
    expect(
      validateCornerProbeGeometry({
        ...VALID_GEOMETRY,
        plateCenterOffsetXmm: threshold,
        plateCenterOffsetYmm: threshold,
      }),
    ).toMatchObject({ kind: 'valid' });
    expect(
      validateCornerProbeGeometry({
        ...VALID_GEOMETRY,
        plateCenterOffsetYmm: threshold - 0.001,
      }),
    ).toMatchObject({ kind: 'invalid' });
  });

  it('uses the larger plate offset when proving outward side clearance', () => {
    const radius = VALID_GEOMETRY.bitDiameterMm / 2;
    const plateCenterOffsetYmm = 20;
    const threshold = plateCenterOffsetYmm + radius + CORNER_PROBE_EXTERNAL_MARGIN_MM;
    const rectangularPlate = { ...VALID_GEOMETRY, plateCenterOffsetYmm };
    expect(
      validateCornerProbeGeometry({ ...rectangularPlate, sideClearanceMm: threshold }),
    ).toMatchObject({ kind: 'valid' });
    expect(
      validateCornerProbeGeometry({ ...rectangularPlate, sideClearanceMm: threshold - 0.001 }),
    ).toMatchObject({ kind: 'invalid' });
  });

  it('rejects a 100 mm cutter with the default plate placement and clearance', () => {
    expect(validateCornerProbeGeometry({ ...VALID_GEOMETRY, bitDiameterMm: 100 })).toMatchObject({
      kind: 'invalid',
    });
  });

  it.each(['ball-nose', 'v-bit', 'engraving'] as const)(
    'rejects %s tools because the side-contact radius is height-dependent',
    (toolKind) => {
      expect(validateCornerProbeGeometry({ ...VALID_GEOMETRY, toolKind })).toMatchObject({
        kind: 'invalid',
        reason: expect.stringContaining('cylindrical end mill'),
      });
    },
  );

  it('rejects values below emitted G-code precision', () => {
    expect(validateCornerProbeGeometry({ ...VALID_GEOMETRY, sideDropMm: 0.0001 })).toMatchObject({
      kind: 'invalid',
      reason: expect.stringContaining('0.001 mm precision'),
    });
  });

  it('rejects an odd-micron diameter whose radius needs half-micron output', () => {
    expect(validateCornerProbeGeometry({ ...VALID_GEOMETRY, bitDiameterMm: 6.351 })).toMatchObject({
      kind: 'invalid',
      reason: expect.stringContaining('0.002 mm increments'),
    });
  });

  it('rejects finite but unsupported geometry magnitudes', () => {
    expect(validateCornerProbeGeometry({ ...VALID_GEOMETRY, sideClearanceMm: 1e20 })).toMatchObject(
      { kind: 'invalid', reason: expect.stringContaining('cannot exceed') },
    );
  });

  it('preserves every collision inequality for generated valid geometry', () => {
    fc.assert(
      fc.property(
        fc.record({
          diameterMicrons: fc.integer({ min: 50, max: 20_000 }).map((value) => value * 2),
          sideDropMicrons: fc.integer({ min: 100, max: 20_000 }),
          extraFlankMicrons: fc.integer({ min: 0, max: 20_000 }),
          extraInsetXMicrons: fc.integer({ min: 0, max: 20_000 }),
          extraInsetYMicrons: fc.integer({ min: 0, max: 20_000 }),
          extraClearanceMicrons: fc.integer({ min: 0, max: 20_000 }),
        }),
        (generated) => {
          const params = generatedValidGeometry(generated);
          const radiusMm = params.bitDiameterMm / 2;
          const result = validateCornerProbeGeometry(params);
          expect(result.kind).toBe('valid');
          if (result.kind !== 'valid') return;
          expect(result.flankHeightMm).toBeLessThan(params.plateThicknessMm);
          expect(result.flankHeightMm).toBeGreaterThanOrEqual(MIN_FLANK_HEIGHT_MM);
          expect(params.plateCenterOffsetXmm).toBeGreaterThanOrEqual(
            radiusMm + CORNER_PROBE_EXTERNAL_MARGIN_MM,
          );
          expect(params.plateCenterOffsetYmm).toBeGreaterThanOrEqual(
            radiusMm + CORNER_PROBE_EXTERNAL_MARGIN_MM,
          );
          expect(params.sideClearanceMm).toBeGreaterThanOrEqual(
            Math.max(params.plateCenterOffsetXmm, params.plateCenterOffsetYmm) +
              radiusMm +
              CORNER_PROBE_EXTERNAL_MARGIN_MM,
          );
          // `finalParkMm` is snapped onto the 0.001 mm G-code grid by the
          // validator, so it can land one ULP below the raw (non-grid) minimum
          // when that minimum is a floating-point representation of an on-grid
          // value (e.g. a true 8.591 held as 8.591000000000001). Allow the
          // validator's own float tolerance, which is far below the 0.001 mm
          // emitted resolution so a real sub-cutter shortfall still fails.
          expect(result.finalParkMm).toBeGreaterThanOrEqual(
            radiusMm + CORNER_PROBE_EXTERNAL_MARGIN_MM - FLOAT_TOLERANCE_MM,
          );
        },
      ),
    );
  });
});

type GeneratedGeometry = {
  readonly diameterMicrons: number;
  readonly sideDropMicrons: number;
  readonly extraFlankMicrons: number;
  readonly extraInsetXMicrons: number;
  readonly extraInsetYMicrons: number;
  readonly extraClearanceMicrons: number;
};

function generatedValidGeometry(generated: GeneratedGeometry) {
  const bitDiameterMm = generated.diameterMicrons / 1000;
  const radiusMm = bitDiameterMm / 2;
  const sideDropMm = generated.sideDropMicrons / 1000;
  const minimumInsetMm = ceilMicron(radiusMm + CORNER_PROBE_EXTERNAL_MARGIN_MM);
  const plateCenterOffsetXmm = minimumInsetMm + generated.extraInsetXMicrons / 1000;
  const plateCenterOffsetYmm = minimumInsetMm + generated.extraInsetYMicrons / 1000;
  const minimumClearanceMm = ceilMicron(
    Math.max(plateCenterOffsetXmm, plateCenterOffsetYmm) +
      radiusMm +
      CORNER_PROBE_EXTERNAL_MARGIN_MM,
  );
  return {
    plateThicknessMm: sideDropMm + MIN_FLANK_HEIGHT_MM + generated.extraFlankMicrons / 1000,
    bitDiameterMm,
    toolKind: 'end-mill' as const,
    plateCenterOffsetXmm,
    plateCenterOffsetYmm,
    sideDropMm,
    sideClearanceMm: minimumClearanceMm + generated.extraClearanceMicrons / 1000,
  };
}

// Snaps up onto the 0.001 mm (one micron) grid the validator's thresholds sit
// on. `Math.ceil(value * 1000) / 1000` can land one ULP *below* `value` — a
// true 1.128 held as 1.1280000000000001 scales to 1128.0, ceils to 1128, and
// divides back to 1.128 — which would push generated geometry a hair under a
// threshold and get it rejected. Bump to the next micron whenever the naive
// grid value is not >= value so the construction is always at or above target.
function ceilMicron(value: number): number {
  const microns = Math.ceil(value * 1000);
  const snapped = microns / 1000;
  return snapped >= value ? snapped : (microns + 1) / 1000;
}
