import { describe, expect, it } from 'vitest';
import type { RotarySetup } from '../../core/devices';
import {
  formatRotaryMm,
  rotaryAttachmentSummary,
  rotaryMappingSummary,
  rotaryReviewSummary,
  rotaryTypeLabel,
} from './rotary-summary';

const ROLLER: RotarySetup = {
  enabled: true,
  type: 'roller',
  mmPerRotation: 40,
  objectDiameterMm: 60,
};

describe('rotary summary', () => {
  it('names the attachment and the object diameter', () => {
    expect(rotaryTypeLabel(ROLLER)).toBe('Roller');
    expect(rotaryAttachmentSummary({ ...ROLLER, type: 'chuck', mmPerRotation: 360 })).toBe(
      'Chuck, Ø60 mm',
    );
  });

  it("names what a roller's Y follows: its roller size, or no scale (ADR-373 Amd 1)", () => {
    const measured = { ...ROLLER, rollerDiameterMm: 25 };
    expect(rotaryAttachmentSummary(measured)).toBe('Roller, Ø60 mm (rollers Ø25 mm)');
    expect(rotaryAttachmentSummary(ROLLER)).toBe('Roller, Ø60 mm (Y not scaled)');
    expect(rotaryAttachmentSummary({ ...measured, type: 'chuck' })).toBe('Chuck, Ø60 mm');
    expect(rotaryReviewSummary(ROLLER)).toBe(
      'Enabled · Roller, Ø60 mm (Y not scaled) · Y ×1.00, one revolution = 188.5 machine mm',
    );
  });

  it('shows a diameter derived from a circumference without float noise', () => {
    expect(rotaryAttachmentSummary({ ...ROLLER, objectDiameterMm: 188.5 / Math.PI })).toBe(
      'Roller, Ø60 mm (Y not scaled)',
    );
    expect(formatRotaryMm(12.345)).toBe('12.35');
    expect(formatRotaryMm(188.4956)).toBe('188.5');
  });

  it('states the Y scale and the one-revolution limit', () => {
    expect(rotaryMappingSummary(ROLLER)).toBe('Y ×1.00, one revolution = 188.5 machine mm');
    expect(rotaryMappingSummary({ ...ROLLER, rollerDiameterMm: 25 })).toBe(
      'Y ×0.51, one revolution = 96 machine mm',
    );
    expect(rotaryMappingSummary({ ...ROLLER, type: 'chuck', mmPerRotation: 360 })).toBe(
      'Y ×1.91, one revolution = 360 machine mm',
    );
  });

  it('tells Job Review whether and how the next job maps Y', () => {
    expect(rotaryReviewSummary({ ...ROLLER, enabled: false })).toBe('Configured, disabled');
    expect(rotaryReviewSummary({ ...ROLLER, rollerDiameterMm: 25 })).toBe(
      'Enabled · Roller, Ø60 mm (rollers Ø25 mm) · Y ×0.51, one revolution = 96 machine mm' +
        " · each move's feed holds the layer speed on the part",
    );
    expect(rotaryReviewSummary({ ...ROLLER, objectDiameterMm: 0 })).toMatch(/not applied/);
  });
});

describe('rotary summary with a taper (ADR-694)', () => {
  const taper = {
    enabled: true,
    topDiameterMm: 80,
    bottomDiameterMm: 70,
    lengthMm: 100,
    topSide: 'left' as const,
    artworkFromTopMm: 0,
  };

  it('names both ends in Job Review, and only while the taper is on', () => {
    const chuck: RotarySetup = { ...ROLLER, type: 'chuck', objectDiameterMm: 80, taper };
    expect(rotaryReviewSummary(chuck)).toBe(
      'Enabled · Chuck, taper Ø80 → Ø70 mm over 100 mm · Y ×0.16, one revolution = 40 machine mm' +
        " · each move's feed holds the layer speed on the part",
    );
    expect(rotaryAttachmentSummary({ ...chuck, taper: { ...taper, enabled: false } })).toBe(
      'Chuck, Ø80 mm',
    );
    expect(rotaryReviewSummary({ ...chuck, taper: { ...taper, lengthMm: 1 } })).toMatch(
      /not applied/,
    );
  });
});
