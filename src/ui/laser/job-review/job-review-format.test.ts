import { describe, expect, it } from 'vitest';
import {
  describeJobOrigin,
  describeOverrides,
  formatBoundsRange,
  formatBoundsSize,
  formatGcodeSize,
  formatLayerMode,
  formatMm,
  overridesAreBaseline,
} from './job-review-format';

describe('formatMm', () => {
  it('trims to one decimal and drops trailing zeros', () => {
    expect(formatMm(8)).toBe('8');
    expect(formatMm(8.25)).toBe('8.3');
    expect(formatMm(8.04)).toBe('8');
  });
});

describe('bounds formatting', () => {
  const bounds = { minX: 1, minY: 2, maxX: 9, maxY: 10 };
  it('formats width × height', () => {
    expect(formatBoundsSize(bounds)).toBe('8 × 8 mm');
  });
  it('formats the coordinate range', () => {
    expect(formatBoundsRange(bounds)).toBe('X 1 to 9 · Y 2 to 10 mm');
  });
});

describe('formatGcodeSize', () => {
  it('scales through B, KB, and MB', () => {
    expect(formatGcodeSize(500)).toBe('500 B');
    expect(formatGcodeSize(2048)).toBe('2 KB');
    expect(formatGcodeSize(150 * 1024)).toBe('150 KB');
    expect(formatGcodeSize(2 * 1024 * 1024)).toBe('2 MB');
  });
});

describe('describeJobOrigin', () => {
  it('reads undefined as absolute machine space', () => {
    expect(describeJobOrigin(undefined)).toBe('Absolute coordinates (machine space)');
  });
  it('labels a user-origin placement with its anchor', () => {
    expect(describeJobOrigin({ startFrom: 'user-origin', anchor: 'front-left' })).toBe(
      'User origin — anchor front left',
    );
  });
  it('includes the frozen head position for current-position placements', () => {
    expect(
      describeJobOrigin({
        startFrom: 'current-position',
        anchor: 'front-left',
        currentPosition: { x: 120, y: 80 },
      }),
    ).toBe('Current position — anchor front left, head at X 120 Y 80');
  });
});

describe('overrides', () => {
  it('treats null and 100/100/100 as baseline', () => {
    expect(overridesAreBaseline(null)).toBe(true);
    expect(overridesAreBaseline({ feed: 100, rapid: 100, spindle: 100 })).toBe(true);
    expect(overridesAreBaseline({ feed: 80, rapid: 50, spindle: 60 })).toBe(false);
  });
  it('describes values and the not-reported case', () => {
    expect(describeOverrides(null)).toBe('Not reported yet');
    expect(describeOverrides({ feed: 80, rapid: 50, spindle: 60 })).toBe(
      'Feed 80% · Rapid 50% · Spindle 60%',
    );
  });
});

describe('formatLayerMode', () => {
  it('maps modes to their LightBurn-style labels', () => {
    expect(formatLayerMode('line')).toBe('Line');
    expect(formatLayerMode('fill')).toBe('Fill');
    expect(formatLayerMode('image')).toBe('Image');
  });
});
