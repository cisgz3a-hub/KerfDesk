import { describe, expect, it } from 'vitest';
import { SEG_KIND } from '../../core/gcode-view';
import {
  buildTravelBucket,
  cssHexColor,
  renderedLineCss,
  renderedLineRampStops,
  revealCount,
  rgbTriple,
} from './segment-buckets';

describe('buildTravelBucket', () => {
  it('copies out the rapids only, mapped to their segments', () => {
    const segments = {
      segmentCount: 3,
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, -1, 1, 0, -1, 2, 0, -1]),
      segKind: new Uint8Array([SEG_KIND.travel, SEG_KIND.plunge, SEG_KIND.cut]),
    };
    const bucket = buildTravelBucket(segments);
    expect(bucket.count).toBe(1);
    expect([...bucket.positions]).toEqual([0, 0, 0, 1, 0, 0]);
    expect([...bucket.sourceIndex]).toEqual([0]);
  });

  it('leaves filtered rapids out (ADR-470)', () => {
    const segments = {
      segmentCount: 4,
      positions: new Float32Array(24).map((_, index) => index),
      segKind: new Uint8Array([SEG_KIND.travel, SEG_KIND.cut, SEG_KIND.travel, SEG_KIND.travel]),
      visible: new Uint8Array([1, 1, 0, 1]),
    };
    const bucket = buildTravelBucket(segments);
    expect([...bucket.sourceIndex]).toEqual([0, 3]);
    expect([...bucket.positions]).toEqual([0, 1, 2, 3, 4, 5, 18, 19, 20, 21, 22, 23]);
  });
});

describe('revealCount', () => {
  it('counts bucket entries at or before the playhead segment', () => {
    // Bucket holds render-model segments 0, 2, 5.
    const source = new Uint32Array([0, 2, 5]);
    expect(revealCount(source, -1)).toBe(0);
    expect(revealCount(source, 0)).toBe(1);
    expect(revealCount(source, 1)).toBe(1);
    expect(revealCount(source, 2)).toBe(2);
    expect(revealCount(source, 4)).toBe(2);
    expect(revealCount(source, 5)).toBe(3);
    expect(revealCount(source, 99)).toBe(3);
  });
});

describe('color helpers', () => {
  it('converts numeric colors to normalized triples and css hex', () => {
    expect(rgbTriple(0xff8000)).toEqual([1, 128 / 255, 0]);
    expect(cssHexColor(0x00a1ff)).toBe('#00a1ff');
    expect(cssHexColor(0x000012)).toBe('#000012');
  });

  it('reports the colour a vertex-coloured line renders, not its theme hex (ADR-425)', () => {
    // Raw triples are read as linear and encoded to sRGB on output.
    expect(renderedLineCss(rgbTriple(0x4fa3ff))).toBe('rgb(151, 209, 255)');
    expect(renderedLineCss([0, 0, 0])).toBe('rgb(0, 0, 0)');
    expect(renderedLineCss([1, 1, 1])).toBe('rgb(255, 255, 255)');
  });

  it('samples a ramp as the lines blend it, endpoints included', () => {
    const stops = renderedLineRampStops([0, 0, 0], [1, 1, 1], 3);
    expect(stops).toEqual(['rgb(0, 0, 0)', 'rgb(188, 188, 188)', 'rgb(255, 255, 255)']);
  });
});
