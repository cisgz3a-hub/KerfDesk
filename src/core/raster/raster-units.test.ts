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

  // Regression: the panel used to render the interval through the RECOMMENDED
  // range [MIN_RASTER_LINES_PER_MM, MAX_RASTER_LINES_PER_MM], while the
  // compiler floors density at MIN_COMPILED_LINES_PER_MM and has no upper
  // clamp. A .lbrn import at a 0.5 mm interval stores 2 lines/mm
  // (clb-import.ts: 1 / interval), so the panel displayed 0.2 mm for a layer
  // that actually burned at 0.5 mm -- 2.5x coarser than shown.
  it('reports the interval the compiler will burn below the recommended minimum', () => {
    expect(linesPerMmToLineIntervalMm(2)).toBeCloseTo(0.5);
  });

  it('reports the interval the compiler will burn above the recommended maximum', () => {
    expect(linesPerMmToLineIntervalMm(1000)).toBeCloseTo(0.001);
  });

  it('floors density where the compiler floors it, so the interval never exceeds 1 mm', () => {
    expect(linesPerMmToLineIntervalMm(0.25)).toBeCloseTo(1);
    expect(linesPerMmToLineIntervalMm(0)).toBeCloseTo(1);
    expect(linesPerMmToLineIntervalMm(Number.NaN)).toBeCloseTo(1);
  });
});
