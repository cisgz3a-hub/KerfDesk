import { analyzeBurnBounds, type BurnAnalysis } from '../../helpers/analyzeBurnBounds';
import { parseGcode, type ParsedGcode } from '../../helpers/parseGcode';

export type E2EAssert = (condition: boolean, message: string) => void;

export interface SemanticGcodeExpectations {
  expectedDistanceMode?: 'absolute' | 'relative';
  initialMotionMustBeLaserOff?: boolean;
  maxSpindle?: number;
  minBurnSegments?: number;
  expectedBurnWidth?: number;
  expectedBurnHeight?: number;
  tolerance?: number;
  expectedMidJobLaserOff?: number;
}

export interface SemanticGcodeResult {
  parsed: ParsedGcode;
  analysis: BurnAnalysis;
}

function approxEqual(actual: number, expected: number, tolerance: number): boolean {
  return Math.abs(actual - expected) <= tolerance;
}

function isFiniteBounds(bounds: BurnAnalysis['burnBounds']): boolean {
  return Number.isFinite(bounds.minX)
    && Number.isFinite(bounds.minY)
    && Number.isFinite(bounds.maxX)
    && Number.isFinite(bounds.maxY)
    && bounds.minX <= bounds.maxX
    && bounds.minY <= bounds.maxY;
}

function firstMatchingLineIndex(gcode: string, pattern: RegExp): number {
  const lines = gcode.split(/\r?\n/);
  return lines.findIndex(line => pattern.test(line));
}

function hasLaserOffBeforeLaserOn(gcode: string): boolean {
  const firstOff = firstMatchingLineIndex(gcode, /\bM5\b/i);
  const firstOn = firstMatchingLineIndex(gcode, /\bM[34]\b/i);
  return firstOff >= 0 && (firstOn < 0 || firstOff < firstOn);
}

export function assertSemanticGcode(
  gcode: string,
  assert: E2EAssert,
  expectations: SemanticGcodeExpectations = {},
): SemanticGcodeResult {
  const parsed = parseGcode(gcode);
  const analysis = analyzeBurnBounds(parsed);
  const maxSpindle = expectations.maxSpindle ?? 1000;
  const minBurnSegments = expectations.minBurnSegments ?? 1;
  const tolerance = expectations.tolerance ?? 0.05;

  assert(parsed.asserts.unitsDeclared, 'Semantic: declares units');
  assert(parsed.asserts.distanceModeDeclared, 'Semantic: declares distance mode');
  assert(parsed.finalState.plane === 'G17', 'Semantic: declares XY plane');
  assert(hasLaserOffBeforeLaserOn(gcode), 'Semantic: laser-off command appears before first laser-on mode');
  if (expectations.initialMotionMustBeLaserOff === true) {
    assert(parsed.asserts.startsLaserOff, 'Semantic: first physical motion starts with laser off');
  }
  assert(parsed.asserts.noBurnDuringRapid, 'Semantic: no burn during rapid moves');
  assert(parsed.asserts.spindleNeverExceedsMax(maxSpindle), `Semantic: spindle never exceeds S${maxSpindle}`);
  assert(parsed.asserts.feedAlwaysPositive, 'Semantic: all emitted feed rates are positive');
  assert(parsed.asserts.noNaN && parsed.asserts.noInfinity, 'Semantic: no NaN/Infinity coordinates');
  assert(parsed.asserts.endsLaserOff && parsed.asserts.finalLaserOff, 'Semantic: final modal state is laser off');
  assert(isFiniteBounds(analysis.burnBounds), 'Semantic: burn bounds are finite');
  assert(
    analysis.burnSegments.length >= minBurnSegments,
    `Semantic: at least ${minBurnSegments} burn segment(s) (got ${analysis.burnSegments.length})`,
  );
  assert(analysis.totalDistanceBurn > 0, 'Semantic: burn distance is positive');
  assert(analysis.laserOnTime > 0, 'Semantic: laser-on time estimate is positive');

  if (expectations.expectedDistanceMode) {
    const modal = expectations.expectedDistanceMode === 'relative' ? 'G91' : 'G90';
    assert(
      parsed.moves.some(move => new RegExp(`\\b${modal}\\b`, 'i').test(move.rawLine)),
      `Semantic: emits ${modal} for ${expectations.expectedDistanceMode} mode`,
    );
  }

  if (expectations.expectedBurnWidth != null) {
    const actualWidth = analysis.burnBounds.maxX - analysis.burnBounds.minX;
    assert(
      approxEqual(actualWidth, expectations.expectedBurnWidth, tolerance),
      `Semantic: burn width ~= ${expectations.expectedBurnWidth}mm (got ${actualWidth.toFixed(3)}mm)`,
    );
  }

  if (expectations.expectedBurnHeight != null) {
    const actualHeight = analysis.burnBounds.maxY - analysis.burnBounds.minY;
    assert(
      approxEqual(actualHeight, expectations.expectedBurnHeight, tolerance),
      `Semantic: burn height ~= ${expectations.expectedBurnHeight}mm (got ${actualHeight.toFixed(3)}mm)`,
    );
  }

  if (expectations.expectedMidJobLaserOff != null) {
    assert(
      analysis.midJobLaserOff.length === expectations.expectedMidJobLaserOff,
      `Semantic: mid-job laser-off count ${expectations.expectedMidJobLaserOff} (got ${analysis.midJobLaserOff.length})`,
    );
  }

  return { parsed, analysis };
}
