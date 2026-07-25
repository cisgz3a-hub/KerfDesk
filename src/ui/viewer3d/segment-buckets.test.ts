import { describe, expect, it } from 'vitest';
import { SEG_KIND } from '../../core/gcode-view';
import { buildSegmentBuckets, cssHexColor, rgbTriple } from './segment-buckets';
import type { Viewer3dTheme } from './viewer3d-theme';

const THEME: Viewer3dTheme = {
  background: 0x000000,
  gridMinor: 0x111111,
  gridMajor: 0x222222,
  travel: 0xcc4444,
  cut: 0x0000ff,
  plunge: 0x00ff00,
  retract: 0xff0000,
};

describe('buildSegmentBuckets', () => {
  it('splits travel from solid kinds and colors solids per kind', () => {
    const segments = {
      segmentCount: 3,
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, -1, 1, 0, -1, 2, 0, -1]),
      segKind: new Uint8Array([SEG_KIND.travel, SEG_KIND.plunge, SEG_KIND.cut]),
    };
    const buckets = buildSegmentBuckets(segments, THEME);
    expect(buckets.travel.count).toBe(1);
    expect(buckets.solid.count).toBe(2);
    expect([...buckets.travel.positions]).toEqual([0, 0, 0, 1, 0, 0]);
    // Plunge segment endpoints are pure green; cut endpoints pure blue.
    expect(buckets.solid.colors[1]).toBeCloseTo(1, 6);
    expect(buckets.solid.colors[4]).toBeCloseTo(1, 6);
    expect(buckets.solid.colors[8]).toBeCloseTo(1, 6);
    expect(buckets.solid.colors[11]).toBeCloseTo(1, 6);
    expect(buckets.solid.colors[0]).toBeCloseTo(0, 6);
  });
});

describe('color helpers', () => {
  it('converts numeric colors to normalized triples and css hex', () => {
    expect(rgbTriple(0xff8000)).toEqual([1, 128 / 255, 0]);
    expect(cssHexColor(0x00a1ff)).toBe('#00a1ff');
    expect(cssHexColor(0x000012)).toBe('#000012');
  });
});
