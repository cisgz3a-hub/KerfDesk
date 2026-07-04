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
});
