import { describe, expect, it } from 'vitest';
import {
  deriveMachineEnvelope,
  normalizeReportedMPosToMm,
  validateEnvelopeSettings,
  type EnvelopeSettings,
} from './machine-envelope';

const TRAVEL = { x: 300, y: 200, z: 80 };
const NEGATIVE = {
  x: { minMm: -300, maxMm: 0 },
  y: { minMm: -200, maxMm: 0 },
  z: { minMm: -80, maxMm: 0 },
};

describe('deriveMachineEnvelope', () => {
  it.each([0, 1, 5, 7])('keeps stock GRBL negative space without OPT:Z (mask %s)', (mask) => {
    expect(deriveMachineEnvelope(TRAVEL, mask, false)).toEqual(NEGATIVE);
  });

  it.each([
    [0, NEGATIVE],
    [1, { ...NEGATIVE, x: { minMm: 0, maxMm: 300 } }],
    [2, { ...NEGATIVE, y: { minMm: 0, maxMm: 200 } }],
    [4, { ...NEGATIVE, z: { minMm: 0, maxMm: 80 } }],
    [
      7,
      {
        x: { minMm: 0, maxMm: 300 },
        y: { minMm: 0, maxMm: 200 },
        z: { minMm: 0, maxMm: 80 },
      },
    ],
  ])('uses OPT:Z and $23 per-axis for mask %s', (mask, expected) => {
    expect(deriveMachineEnvelope(TRAVEL, mask as number, true)).toEqual(expected);
  });

  it.each([
    [{ ...TRAVEL, x: 0 }, 0],
    [TRAVEL, -1],
    [TRAVEL, 8],
  ])('rejects invalid travel or mask', (travel, mask) => {
    expect(() => deriveMachineEnvelope(travel, mask, false)).toThrow();
  });
});

describe('normalizeReportedMPosToMm', () => {
  it('leaves millimetre reports unchanged', () => {
    expect(normalizeReportedMPosToMm([-25.4, -12.7, -50.8], false)).toEqual([-25.4, -12.7, -50.8]);
  });

  it('converts only reported coordinates when $13 enables inches', () => {
    expect(normalizeReportedMPosToMm([-1, -0.5, -2], true)).toEqual([-25.4, -12.7, -50.8]);
    expect(deriveMachineEnvelope(TRAVEL, 0, false)).toEqual(NEGATIVE);
  });

  it('rejects non-finite coordinates', () => {
    expect(() => normalizeReportedMPosToMm([0, Number.NaN, 0], false)).toThrow();
  });
});

describe('validateEnvelopeSettings', () => {
  const VALID: EnvelopeSettings = {
    statusReportMask: 1,
    reportInches: false,
    softLimitsEnabled: true,
    homingEnabled: true,
    homingDirectionMask: 0,
    homingPullOffMm: 1,
    maxTravelMm: TRAVEL,
  };

  it('accepts complete direct-MPos, homing, and soft-limit settings', () => {
    expect(validateEnvelopeSettings(VALID)).toEqual({ ok: true });
    expect(validateEnvelopeSettings({ ...VALID, statusReportMask: 3 })).toEqual({ ok: true });
  });

  it.each([
    ['WPos-only status', { statusReportMask: 0 }],
    ['unknown status bit', { statusReportMask: 5 }],
    ['soft limits disabled', { softLimitsEnabled: false }],
    ['homing disabled', { homingEnabled: false }],
    ['invalid direction mask', { homingDirectionMask: 8 }],
    ['invalid pull-off', { homingPullOffMm: 0 }],
  ])('rejects %s', (_label, patch) => {
    expect(validateEnvelopeSettings({ ...VALID, ...patch })).toMatchObject({ ok: false });
  });
});
