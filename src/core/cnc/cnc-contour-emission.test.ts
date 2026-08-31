import { describe, expect, it } from 'vitest';
import type { CncContourPass } from '../job/job';
import {
  cncContourEmissionPoints,
  cncContourEmissionPrecision,
  cncContourLosesMotionAtSupportedPrecision,
  CNC_CONTOUR_PARSER_PREFIX,
  formatCncContourCoordinate,
  parseGrblCncCoordinate,
} from './cnc-contour-emission';

function pass(points: CncContourPass['polyline']): CncContourPass {
  return { kind: 'contour', zMm: -1, polyline: points, closed: false };
}

function parsed(text: string): number {
  return parseGrblCncCoordinate(text);
}

describe('CNC contour emission representation', () => {
  it('keeps ordinary contours on the standard three-decimal representation', () => {
    const contour = pass([
      { x: 10.0004, y: 20.0004 },
      { x: 10.01, y: 20.02 },
    ]);

    expect(cncContourEmissionPrecision(contour)).toBe(3);
    expect(cncContourEmissionPoints(contour)).toEqual([
      { x: parsed('10.000'), y: parsed('20.000') },
      { x: parsed('10.010'), y: parsed('20.020') },
    ]);
  });

  it('uses one bounded fourth decimal when three decimals would erase real motion', () => {
    const contour = pass([
      { x: 10, y: 20 },
      { x: 10.0004, y: 20.0004 },
      { x: 10, y: 20 },
    ]);

    expect(cncContourEmissionPrecision(contour)).toBe(4);
    expect(cncContourEmissionPoints(contour)).toEqual([
      { x: parsed('10.0000'), y: parsed('20.0000') },
      { x: parsed('10.0004'), y: parsed('20.0004') },
      { x: parsed('10.0000'), y: parsed('20.0000') },
    ]);
    expect(cncContourLosesMotionAtSupportedPrecision(contour)).toBe(false);
  });

  it('uses five decimals when the GRBL parser can retain sub-E-4 detail', () => {
    const contour = pass([
      { x: 10, y: 20 },
      { x: 10.00004, y: 20.00004 },
      { x: 10, y: 20 },
    ]);

    expect(cncContourEmissionPrecision(contour)).toBe(5);
    expect(cncContourEmissionPoints(contour)).toHaveLength(3);
    expect(cncContourLosesMotionAtSupportedPrecision(contour)).toBe(false);
  });

  it('uses a finer width when an earlier candidate would erase a later segment', () => {
    const contour = pass([
      { x: 10, y: 20 },
      { x: 10.0004, y: 20 },
      { x: 10.00044, y: 20.00004 },
    ]);

    expect(cncContourEmissionPrecision(contour)).toBe(5);
    expect(cncContourEmissionPoints(contour)).toHaveLength(3);
    expect(cncContourLosesMotionAtSupportedPrecision(contour)).toBe(false);
  });

  it('does not classify an actually stationary pass as lost requested motion', () => {
    const contour = pass([
      { x: 10, y: 20 },
      { x: 10, y: 20 },
    ]);

    expect(cncContourEmissionPrecision(contour)).toBeNull();
    expect(cncContourLosesMotionAtSupportedPrecision(contour)).toBe(false);
  });

  it('does not mistake differently signed zero text for controller motion', () => {
    expect(formatCncContourCoordinate(-0.00001, 4)).toBe('0.0000');
    expect(formatCncContourCoordinate(0.00001, 4)).toBe('0.0000');
    expect(formatCncContourCoordinate(-1e-9, 9)).toBe('.00000000');
    expect(formatCncContourCoordinate(-0.00001, 3)).toBe('-0.000');
  });

  it('raises precision when signed p3 words still parse to one controller position', () => {
    const contour = pass([
      { x: -0.00001, y: 0 },
      { x: 0.00001, y: 0 },
    ]);

    expect(cncContourEmissionPrecision(contour)).toBe(5);
    expect(cncContourEmissionPoints(contour)).toHaveLength(2);
    expect(cncContourLosesMotionAtSupportedPrecision(contour)).toBe(false);
  });

  it('raises precision when distinct p3 text parses to one float32 coordinate', () => {
    const contour = pass([
      { x: 9999.01, y: 0 },
      { x: 9999.011, y: 0 },
    ]);

    expect(parseGrblCncCoordinate('9999.010')).toBe(parseGrblCncCoordinate('9999.011'));
    expect(cncContourEmissionPrecision(contour)).not.toBe(3);
    expect(cncContourEmissionPoints(contour)).toHaveLength(2);
    expect(cncContourLosesMotionAtSupportedPrecision(contour)).toBe(false);
  });

  it('preserves surviving-axis detail when another axis exhausts the digit budget', () => {
    const contour = pass([
      { x: 10_000, y: 20 },
      { x: 10_000, y: 20.00004 },
      { x: 10_000, y: 20 },
    ]);

    expect(cncContourEmissionPrecision(contour)).toBe(5);
    expect(cncContourLosesMotionAtSupportedPrecision(contour)).toBe(false);
  });

  it('warns only when no axis survives the parser digit and float representation', () => {
    const contour = pass([
      { x: 10_000, y: 20_000 },
      { x: 10_000.0004, y: 20_000.0004 },
      { x: 10_000, y: 20_000 },
    ]);

    expect(cncContourEmissionPrecision(contour)).toBeNull();
    expect(cncContourLosesMotionAtSupportedPrecision(contour)).toBe(true);
  });

  it('retains representable motion and warns when only a later segment is unrepresentable', () => {
    const contour = pass([
      { x: 10_000, y: 20_000 },
      { x: 10_001, y: 20_000 },
      { x: 10_001.0004, y: 20_000.0004 },
    ]);

    expect(cncContourEmissionPrecision(contour)).toBe(3);
    expect(cncContourEmissionPoints(contour)).toHaveLength(2);
    expect(cncContourLosesMotionAtSupportedPrecision(contour)).toBe(true);
  });

  it('removes parser-stationary p3 text from a best-partial fallback', () => {
    const contour = pass([
      { x: 9998.0102, y: 0 },
      { x: 9999.0102, y: 0 },
      { x: 9999.01071, y: 0 },
    ]);

    expect(cncContourEmissionPrecision(contour)).toBe(3);
    expect(parseGrblCncCoordinate('9999.010')).toBe(parseGrblCncCoordinate('9999.011'));
    expect(cncContourEmissionPoints(contour)).toHaveLength(2);
    expect(cncContourLosesMotionAtSupportedPrecision(contour)).toBe(true);
  });

  it('does not preserve text that stock GRBL parses to one stationary float', () => {
    expect(parseGrblCncCoordinate('247.01767')).toBe(parseGrblCncCoordinate('247.01768'));
    const contour = pass([
      { x: 247.01767, y: 20 },
      { x: 247.01768, y: 20 },
    ]);

    expect(cncContourEmissionPrecision(contour)).toBeNull();
    expect(cncContourEmissionPoints(contour)).toEqual([]);
  });

  it('preserves adjacent text that GRBL integer scaling parses distinctly', () => {
    expect(parseGrblCncCoordinate('178.71462')).not.toBe(parseGrblCncCoordinate('178.71461'));
    const contour = pass([
      { x: 178.71462, y: 20 },
      { x: 178.71461, y: 20 },
    ]);

    expect(cncContourEmissionPrecision(contour)).toBe(5);
    expect(cncContourEmissionPoints(contour)).toEqual([
      { x: parsed('178.71462'), y: parsed('20.00000') },
      { x: parsed('178.71461'), y: parsed('20.00000') },
    ]);
  });

  it('uses a leading-dot eighth decimal when all eight captured digits are fractional', () => {
    const contour = pass([
      { x: 0, y: 0 },
      { x: 0.00000004, y: 0 },
    ]);

    expect(cncContourEmissionPrecision(contour)).toBe(8);
    expect(formatCncContourCoordinate(0, 8)).toBe('.00000000');
    expect(formatCncContourCoordinate(0.00000004, 8)).toBe('.00000004');
    expect(cncContourEmissionPoints(contour)).toEqual([
      { x: parsed('.00000000'), y: parsed('.00000000') },
      { x: parsed('.00000004'), y: parsed('.00000000') },
    ]);
  });

  it('rounds before shortening when a seventh-decimal carry selects the parser cell', () => {
    const contour = pass([
      { x: 10.1234556, y: 20 },
      { x: 10.1234564, y: 20 },
    ]);

    expect(cncContourEmissionPrecision(contour)).toBe(7);
    expect(formatCncContourCoordinate(10.1234556, 7)).toBe('10.123455');
    expect(formatCncContourCoordinate(10.1234564, 7)).toBe('10.123456');
    expect(formatCncContourCoordinate(10.1234556, CNC_CONTOUR_PARSER_PREFIX)).toBe('10.123455');
    expect(formatCncContourCoordinate(10.1234564, CNC_CONTOUR_PARSER_PREFIX)).toBe('10.123456');
    expect(cncContourEmissionPoints(contour)).toHaveLength(2);
  });

  it('stabilizes the rounded parser prefix across the binary64 1e-8 boundary', () => {
    const below = 9.99999999999999855e-9;
    const above = 1.00000000000000019e-8;
    const contour = pass([
      { x: below, y: 0 },
      { x: above, y: 0 },
    ]);

    expect(cncContourEmissionPrecision(contour)).toBe(24);
    expect(formatCncContourCoordinate(below, 24)).toBe('.00000000');
    expect(formatCncContourCoordinate(above, 24)).toBe('.00000001');
    expect(formatCncContourCoordinate(below, CNC_CONTOUR_PARSER_PREFIX)).toBe('.00000000');
    expect(formatCncContourCoordinate(above, CNC_CONTOUR_PARSER_PREFIX)).toBe('.00000001');
    expect(cncContourEmissionPoints(contour)).toHaveLength(2);
  });

  it('retains sub-unit prefixes that rounded eighth decimals merge at nine', () => {
    const contour = pass([
      { x: 0.123456776, y: 0 },
      { x: 0.123456784, y: 0 },
    ]);

    expect(cncContourEmissionPrecision(contour)).toBe(9);
    expect(formatCncContourCoordinate(0.123456776, 9)).toBe('.12345677');
    expect(formatCncContourCoordinate(0.123456784, 9)).toBe('.12345678');
    expect(formatCncContourCoordinate(0.123456776, CNC_CONTOUR_PARSER_PREFIX)).toBe('.12345677');
    expect(formatCncContourCoordinate(0.123456784, CNC_CONTOUR_PARSER_PREFIX)).toBe('.12345678');
  });

  it('uses a ninth-decimal rounding boundary even when exact prefixes match', () => {
    const contour = pass([
      { x: 0.1234567994, y: 0 },
      { x: 0.1234567996, y: 0 },
    ]);

    expect(formatCncContourCoordinate(0.1234567994, CNC_CONTOUR_PARSER_PREFIX)).toBe('.12345679');
    expect(formatCncContourCoordinate(0.1234567996, CNC_CONTOUR_PARSER_PREFIX)).toBe('.12345679');
    expect(cncContourEmissionPrecision(contour)).toBe(9);
    expect(formatCncContourCoordinate(0.1234567994, 9)).toBe('.12345679');
    expect(formatCncContourCoordinate(0.1234567996, 9)).toBe('.12345680');
    expect(cncContourEmissionPoints(contour)).toHaveLength(2);
    expect(cncContourLosesMotionAtSupportedPrecision(contour)).toBe(false);
  });

  it('continues beyond the shortest round-trip width until the exact prefix stabilizes', () => {
    const lower = Number('.12345679');
    const upper = 0.12345679000000001;
    const contour = pass([
      { x: lower, y: 0 },
      { x: upper, y: 0 },
    ]);

    expect(formatCncContourCoordinate(lower, 17)).toBe(formatCncContourCoordinate(upper, 17));
    expect(cncContourEmissionPrecision(contour)).toBe(18);
    expect(formatCncContourCoordinate(lower, 18)).toBe('.12345678');
    expect(formatCncContourCoordinate(upper, 18)).toBe('.12345679');
    expect(cncContourEmissionPoints(contour)).toHaveLength(2);
  });
});
