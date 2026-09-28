import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SNAP_SETTINGS,
  MAX_SNAP_DISTANCE_PX,
  MIN_SNAP_GRID_MM,
  normalizeSnapSettings,
  sameSnapSettings,
} from './snap-settings';

describe('snap settings', () => {
  it('defaults every point kind on, with an 8 px reach and a 10 mm grid', () => {
    expect(DEFAULT_SNAP_SETTINGS).toEqual({
      enabled: true,
      snapToGrid: true,
      snapToObjects: true,
      snapToNodes: true,
      snapToMidpoints: true,
      snapToCenters: true,
      snapToIntersections: true,
      distancePx: 8,
      gridMm: 10,
    });
  });

  it('reads damaged or partial values back field by field', () => {
    const normalized = normalizeSnapSettings({
      snapToMidpoints: false,
      snapToNodes: 'yes',
      distancePx: Number.NaN,
      gridMm: 2.5,
    });

    expect(normalized).toEqual({
      ...DEFAULT_SNAP_SETTINGS,
      snapToMidpoints: false,
      gridMm: 2.5,
    });
    expect(normalizeSnapSettings(null)).toEqual(DEFAULT_SNAP_SETTINGS);
    expect(normalizeSnapSettings([1, 2])).toEqual(DEFAULT_SNAP_SETTINGS);
  });

  it('clamps numbers into range instead of refusing them', () => {
    const normalized = normalizeSnapSettings({ distancePx: 500, gridMm: 0 });

    expect(normalized.distancePx).toBe(MAX_SNAP_DISTANCE_PX);
    expect(normalized.gridMm).toBe(MIN_SNAP_GRID_MM);
  });

  it('falls back to the given settings rather than the defaults', () => {
    const current = { ...DEFAULT_SNAP_SETTINGS, distancePx: 20, snapToCenters: false };

    expect(normalizeSnapSettings({ gridMm: 5 }, current)).toEqual({ ...current, gridMm: 5 });
  });

  it('compares every field', () => {
    expect(sameSnapSettings(DEFAULT_SNAP_SETTINGS, { ...DEFAULT_SNAP_SETTINGS })).toBe(true);
    expect(
      sameSnapSettings(DEFAULT_SNAP_SETTINGS, {
        ...DEFAULT_SNAP_SETTINGS,
        snapToIntersections: false,
      }),
    ).toBe(false);
    expect(sameSnapSettings(DEFAULT_SNAP_SETTINGS, { ...DEFAULT_SNAP_SETTINGS, gridMm: 1 })).toBe(
      false,
    );
  });
});
