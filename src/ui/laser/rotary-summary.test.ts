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
    expect(rotaryAttachmentSummary(ROLLER)).toBe('Roller, Ø60 mm');
    expect(rotaryAttachmentSummary({ ...ROLLER, type: 'chuck', mmPerRotation: 360 })).toBe(
      'Chuck, Ø60 mm',
    );
  });

  it('adds the roller size only when Y is scaled from it', () => {
    const measured = { ...ROLLER, rollerDiameterMm: 25 };
    expect(rotaryAttachmentSummary(measured)).toBe('Roller, Ø60 mm (rollers Ø25 mm)');
    expect(rotaryAttachmentSummary({ ...measured, type: 'chuck' })).toBe('Chuck, Ø60 mm');
  });

  it('shows a diameter derived from a circumference without float noise', () => {
    expect(rotaryAttachmentSummary({ ...ROLLER, objectDiameterMm: 188.5 / Math.PI })).toBe(
      'Roller, Ø60 mm',
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
      'Enabled · Roller, Ø60 mm (rollers Ø25 mm) · Y ×0.51, one revolution = 96 machine mm',
    );
    expect(rotaryReviewSummary({ ...ROLLER, objectDiameterMm: 0 })).toMatch(/not applied/);
  });
});
