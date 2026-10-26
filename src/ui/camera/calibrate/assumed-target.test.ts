import { describe, expect, it } from 'vitest';
import { assumedTarget } from './assumed-target';
import { DEFAULT_CALIBRATION_SETTINGS } from './camera-calibration-store';
import type { EngravedTarget } from './engraved-target-memory';

const engravedWith20: EngravedTarget = {
  area: { x: 20, y: 20, width: 360, height: 360 },
  bedWidthMm: 400,
  bedHeightMm: 400,
  layoutMm: 20,
  engravedAt: '2026-09-29T08:00:00.000Z',
};

function assume(overrides: Partial<Parameters<typeof assumedTarget>[0]> = {}) {
  return assumedTarget({
    settings: {
      ...DEFAULT_CALIBRATION_SETTINGS,
      marginMm: 20,
      sheetWidthMm: 400,
      sheetHeightMm: 400,
    },
    bedWidthMm: 400,
    bedHeightMm: 400,
    knownArea: null,
    remembered: engravedWith20,
    frameNow: { origin: 'front-left', bedWidthMm: 400, bedHeightMm: 400 },
    ...overrides,
  });
}

describe('assumedTarget', () => {
  it('looks for the target engraved here while the settings still describe it', () => {
    const target = assume();
    expect(target.source).toBe('engraved');
    expect(target.area).toEqual(engravedWith20.area);
    expect(target.description).toContain('the target engraved from this computer on');
    expect(target.description).toContain(
      '360 × 360 mm with a 20 mm margin on a 400 × 400 mm sheet in the middle of a 400 × 400 mm bed',
    );
  });

  it('says a target put on the canvas was added there, not engraved', () => {
    const target = assume({ remembered: { ...engravedWith20, onCanvas: true } });
    expect(target.source).toBe('engraved');
    expect(target.description).toContain('the target added to the canvas from this computer on');
  });

  it('keeps the engraved area when the bed size changed since, and says so', () => {
    const target = assume({ bedWidthMm: 380 });
    expect(target.area).toEqual(engravedWith20.area);
    expect(target.description).toContain('(the bed is now 380 × 400 mm)');
  });

  it('follows the settings once another margin is entered, and says which layout that is', () => {
    const target = assume({ settings: DEFAULT_CALIBRATION_SETTINGS });
    expect(target.source).toBe('settings');
    // The default 300 × 200 mm sheet in the middle of the 400 mm bed.
    expect(target.area).toEqual({ x: 55, y: 105, width: 290, height: 190 });
    expect(target.description).toBe(
      'a target laid out by these settings: 290 × 190 mm with a 5 mm margin on a 300 × 200 mm sheet in the middle of a 400 × 400 mm bed',
    );
    expect(assume({ remembered: null }).source).toBe('settings');
  });

  it('uses the saved calibration’s own target during a check', () => {
    const known = { x: 10, y: 10, width: 380, height: 380 };
    const target = assume({ knownArea: known });
    expect(target).toMatchObject({ source: 'saved-calibration', area: known });
    expect(target.description).toBe('the target of the saved calibration, 380 × 380 mm');
  });

  it('describes a head camera’s square', () => {
    const settings = { ...DEFAULT_CALIBRATION_SETTINGS, headCamera: true };
    const target = assume({ settings, remembered: null, bedHeightMm: 300 });
    expect(target.area).toEqual({ x: 180, y: 130, width: 40, height: 40 });
    expect(target.description).toBe(
      'a target laid out by these settings: a 40 × 40 mm square in the middle of a 400 × 300 mm bed',
    );
  });
});
