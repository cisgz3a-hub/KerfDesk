// Rolling audit v3 G4-P1-2. Smoothieware prints MPos/WPos through
// from_millimeters (Kernel.cpp L262-L287 @ 91fe4286), G20/G21 set inch mode
// (Robot.cpp L601-L602) and M121 restores the mode M120 saved (L344-L365).
// `$G` prints G20 or G21 from that mode (SimpleShell.cpp L879-L892).
import { describe, expect, it } from 'vitest';
import { parseModalUnitsFromModalResponses } from '../grbl/work-offset-readback';
import { smoothiewareDriver } from './driver';
import { smoothieReportUnitsSelectedBy } from './report-units';

describe('Smoothieware report units', () => {
  it.each([
    ['G20', 'inches'],
    ['G21', 'millimetres'],
    ['G020', 'inches'],
    ['G 21', 'millimetres'],
    ['g20', 'inches'],
    ['G0 X1 G20', 'inches'],
    ['G20 (inches)', 'inches'],
    ['G20.0', 'inches'],
    ['M121', 'unknown'],
    ['M120 G20 M121', 'unknown'],
    ['G21 G20', 'unknown'],
  ])('reads %s as %s', (line, units) => {
    expect(smoothieReportUnitsSelectedBy(line)).toBe(units);
  });

  it.each(['G0 X20', 'G1 X21 Y20', 'G2 0', 'G120', 'G200', 'M120', 'M1210', 'M114', '$G'])(
    'reads %s as selecting no units',
    (line) => {
      expect(smoothieReportUnitsSelectedBy(line)).toBeNull();
    },
  );

  it('is the driver hook', () => {
    expect(smoothiewareDriver.reportUnitsSelectedBy).toBe(smoothieReportUnitsSelectedBy);
  });

  it('reads the units from a $G modal report', () => {
    const report = (units: string) =>
      `[GC:G0 G54 G17 ${units} G90 G94 M0 M5 M9 T0 F4000.0000 S0.8000]`;
    expect(parseModalUnitsFromModalResponses([report('G20')])).toBe('inches');
    expect(parseModalUnitsFromModalResponses([report('G21')])).toBe('millimetres');
    expect(parseModalUnitsFromModalResponses(['[GC:G0 G54 G17 G90]'])).toBeNull();
    expect(parseModalUnitsFromModalResponses(['ok'])).toBeNull();
  });
});
