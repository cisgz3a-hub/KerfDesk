import { describe, expect, it } from 'vitest';
import {
  isScanOffsetTable,
  mergeScanOffsetTableBySpeed,
  normalizeScanOffsetTable,
} from './scan-offset-profile';

describe('scan offset table helpers', () => {
  const duplicateSpeeds = [
    { speedMmPerMin: 3000, offsetMm: 0.12 },
    { speedMmPerMin: 1000, offsetMm: 0.03 },
    { speedMmPerMin: 3000, offsetMm: 0.2 },
  ];

  it('rejects duplicate speeds as an invalid canonical scan-offset table', () => {
    expect(isScanOffsetTable(duplicateSpeeds)).toBe(false);
    expect(normalizeScanOffsetTable(duplicateSpeeds)).toEqual([]);
  });

  it('keeps last-edited duplicate speeds only through the explicit merge helper', () => {
    expect(mergeScanOffsetTableBySpeed(duplicateSpeeds)).toEqual([
      { speedMmPerMin: 1000, offsetMm: 0.03 },
      { speedMmPerMin: 3000, offsetMm: 0.2 },
    ]);
  });

  it('filters malformed points and sorts valid unique points by speed', () => {
    expect(
      normalizeScanOffsetTable([
        { speedMmPerMin: 4000, offsetMm: 0.4 },
        { speedMmPerMin: -1, offsetMm: 0.1 },
        { speedMmPerMin: 2000, offsetMm: 0.2 },
        { speedMmPerMin: 3000, offsetMm: Number.NaN },
      ]),
    ).toEqual([
      { speedMmPerMin: 2000, offsetMm: 0.2 },
      { speedMmPerMin: 4000, offsetMm: 0.4 },
    ]);
  });
});
