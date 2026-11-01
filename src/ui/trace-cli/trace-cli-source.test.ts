// @vitest-environment node
// The headless trace decodes a PNG itself, so it turns it by its eXIf
// Orientation as the app's browser decode does (ADR-404 Amendment 1).

import { describe, expect, it } from 'vitest';
import { exifTiffBlock } from '../../io/raster-decode/exif-orientation.test-support';
import { makePng } from '../import/png-incremental-decoder.test-support';
import { traceCliSource } from './trace-cli-source';

function greyPng(orientation: number | null, exifAfterIdat = false): Uint8Array {
  return makePng({
    width: 3,
    height: 2,
    colorType: 0,
    rows: [
      [10, 20, 30],
      [40, 50, 60],
    ],
    ...(orientation === null ? {} : { exif: exifTiffBlock({ ifd0: [{ value: orientation }] }) }),
    exifAfterIdat,
  });
}

function reds(data: Uint8ClampedArray): number[] {
  return Array.from({ length: data.length / 4 }, (_, index) => data[index * 4] ?? -1);
}

describe('traceCliSource honours a PNG eXIf Orientation', () => {
  it('turns a quarter-turned PNG upright and sizes it portrait', async () => {
    const source = await traceCliSource(greyPng(6), null);

    expect([source.image.width, source.image.height]).toEqual([2, 3]);
    expect(reds(source.image.data)).toEqual([40, 10, 50, 20, 60, 30]);
    // Default 254 DPI: 0.1 mm per pixel.
    expect(source.widthMm).toBeCloseTo(0.2, 9);
    expect(source.heightMm).toBeCloseTo(0.3, 9);
  });

  it('leaves a PNG whose eXIf follows IDAT, or has none, as stored', async () => {
    for (const bytes of [greyPng(6, true), greyPng(null)]) {
      const source = await traceCliSource(bytes, null);
      expect([source.image.width, source.image.height]).toEqual([3, 2]);
      expect(reds(source.image.data)).toEqual([10, 20, 30, 40, 50, 60]);
    }
  });
});
