import { describe, expect, it } from 'vitest';
import { CNC_MACHINE_CATALOG } from './cnc-machine-catalog';

describe('CNC_MACHINE_CATALOG', () => {
  it('ships a non-empty catalog of machines with unique ids', () => {
    expect(CNC_MACHINE_CATALOG.length).toBeGreaterThan(0);
    const ids = CNC_MACHINE_CATALOG.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every preset has a sane bed, spindle max, name, and confirm note', () => {
    for (const preset of CNC_MACHINE_CATALOG) {
      expect(preset.name.length).toBeGreaterThan(0);
      expect(preset.bedWidthMm).toBeGreaterThan(0);
      expect(preset.bedHeightMm).toBeGreaterThan(0);
      expect(preset.spindleMaxRpm).toBeGreaterThan(0);
      // Clean-room specs must tell the operator to confirm before cutting.
      expect(preset.note.toLowerCase()).toContain('confirm');
    }
  });

  // Regression: these two rows once shipped a different model tier's work
  // area (435×435 / 840×435 — Machinist-class numbers). These values are
  // conservative, rounded-down Elite max-travel figures for the Woodworker
  // 32″-class and Journeyman 48″×32″-class machines; exact travel varies.
  it('ships conservative Onefinity class envelopes, not the smaller-tier values', () => {
    const woodworker = CNC_MACHINE_CATALOG.find((preset) => preset.id === 'onefinity-woodworker');
    const journeyman = CNC_MACHINE_CATALOG.find((preset) => preset.id === 'onefinity-journeyman');
    expect(woodworker?.bedWidthMm).toBe(807);
    expect(woodworker?.bedHeightMm).toBe(765);
    expect(journeyman?.bedWidthMm).toBe(1214);
    expect(journeyman?.bedHeightMm).toBe(765);
  });
});
