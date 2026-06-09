import { describe, expect, it } from 'vitest';
import {
  dpiToLinesPerMm,
  lineIntervalMmToLinesPerMm,
  linesPerMmToDpi,
  linesPerMmToLineIntervalMm,
} from './raster-units';

describe('raster unit conversions', () => {
  it('maps line interval to lines/mm and DPI', () => {
    expect(lineIntervalMmToLinesPerMm(0.1)).toBeCloseTo(10);
    expect(linesPerMmToDpi(10)).toBeCloseTo(254);
  });

  it('maps DPI to lines/mm and line interval', () => {
    expect(dpiToLinesPerMm(254)).toBeCloseTo(10);
    expect(linesPerMmToLineIntervalMm(10)).toBeCloseTo(0.1);
  });
});
