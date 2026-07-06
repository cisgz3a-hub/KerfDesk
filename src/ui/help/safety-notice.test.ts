import { describe, expect, it } from 'vitest';
import { SAFETY_NOTICE_TEXT } from './safety-notice';

describe('SAFETY_NOTICE_TEXT', () => {
  // This is the in-app safety warning for a program that drives lasers and
  // routers. Each check pins a hazard a well-meaning trim must not drop —
  // grounded in laser/CNC safety guidance and the app's own "software cannot
  // guarantee stopping the machine" reality (see the laser safety notices).
  it('states use-at-own-risk with no warranty', () => {
    expect(SAFETY_NOTICE_TEXT).toMatch(/OWN RISK/i);
    expect(SAFETY_NOTICE_TEXT).toMatch(/no warranty/i);
  });

  it('tells the operator to verify output and know the physical E-stop', () => {
    expect(SAFETY_NOTICE_TEXT).toMatch(/verify/i);
    expect(SAFETY_NOTICE_TEXT).toMatch(/emergency stop|E-stop/i);
    expect(SAFETY_NOTICE_TEXT).toMatch(/unattended/i);
  });

  it('covers the core laser hazards (eyes, fumes, PVC)', () => {
    expect(SAFETY_NOTICE_TEXT).toMatch(/eye protection|wavelength/i);
    expect(SAFETY_NOTICE_TEXT).toMatch(/fume|ventilat/i);
    expect(SAFETY_NOTICE_TEXT).toMatch(/PVC/);
  });

  it('covers the core CNC hazards (PPE, loose clothing, workholding, dust)', () => {
    expect(SAFETY_NOTICE_TEXT).toMatch(/loose clothing/i);
    expect(SAFETY_NOTICE_TEXT).toMatch(/clamp/i);
    expect(SAFETY_NOTICE_TEXT).toMatch(/dust/i);
  });

  it('points to the full guide', () => {
    expect(SAFETY_NOTICE_TEXT).toContain('docs/safety.md');
  });
});
