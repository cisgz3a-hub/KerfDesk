// Shared contour representation used by both the CNC emitter and toolpath
// preview. Ordinary coordinates stay at the repository's 3-decimal contract.
// A real contour that would otherwise become stationary uses the narrowest
// representation GRBL's eight-captured-digit float parser can distinguish.
// Four decimals are typical. Wider candidates are rounded first and only then
// shortened to the parser prefix, so a carry from a later decimal can still
// select the nearest representable parser cell. This is textual/parser parity,
// not a claim that a physical machine can resolve the commanded distance.

import type { CncContourPass } from '../job/job';
import type { Vec2 } from '../scene';
import { CNC_COORDINATE_DECIMAL_PLACES } from './cnc-output-precision';

export const CNC_CONTOUR_DETAIL_DECIMAL_PLACES = 4;
// JavaScript's exact toFixed limit. Selection normally stops far earlier, as
// soon as every rounded candidate reaches the exact binary64 parser prefix.
export const CNC_CONTOUR_MAX_DECIMAL_PLACES = 100;
export const CNC_CONTOUR_PARSER_PREFIX = 'parser-prefix';
const GRBL_MAX_PARSED_DIGITS = 8;

export type CncContourEmissionPrecision = number | typeof CNC_CONTOUR_PARSER_PREFIX;

export type CncContourEmissionVertex = {
  readonly point: Vec2;
  readonly xText: string;
  readonly yText: string;
};

type ContourSegmentStats = {
  readonly geometricSegments: number;
  readonly retainedSegments: number;
};

type ContourPrecisionCandidate = {
  readonly precision: CncContourEmissionPrecision;
  readonly retainedSegments: number;
};

/** Select the narrowest parser-representable XY precision that preserves every
 * requested segment. When that is impossible, retain the candidate that
 * preserves the most segments and let Job Review disclose the omitted detail.
 * `null` means no supported representation can express any motion. */
export function cncContourEmissionPrecision(
  pass: CncContourPass,
): CncContourEmissionPrecision | null {
  if (pass.polyline.length < 2) return null;
  const geometricSegments = contourGeometricSegmentCount(pass.polyline);
  if (geometricSegments === 0) return null;
  const ordinaryStats = contourSegmentStatsAtPrecision(
    pass.polyline,
    CNC_COORDINATE_DECIMAL_PLACES,
  );
  if (ordinaryStats.retainedSegments === geometricSegments) {
    return CNC_COORDINATE_DECIMAL_PLACES;
  }
  const exactPrefixes = pass.polyline.map((point) => ({
    x: formatGrblParserPrefix(point.x),
    y: formatGrblParserPrefix(point.y),
  }));
  const rounded = selectRoundedContourPrecision(
    pass.polyline,
    exactPrefixes,
    geometricSegments,
    candidateFromStats(CNC_COORDINATE_DECIMAL_PLACES, ordinaryStats),
  );
  if (rounded.complete !== null) return rounded.complete;
  const exactStats = contourSegmentStatsAtPrecision(pass.polyline, CNC_CONTOUR_PARSER_PREFIX);
  if (exactStats.retainedSegments === geometricSegments) return CNC_CONTOUR_PARSER_PREFIX;
  const best = betterCandidate(
    rounded.best,
    candidateFromStats(CNC_CONTOUR_PARSER_PREFIX, exactStats),
  );
  return best?.precision ?? null;
}

function selectRoundedContourPrecision(
  points: ReadonlyArray<Vec2>,
  exactPrefixes: ReadonlyArray<{ readonly x: string; readonly y: string }>,
  geometricSegments: number,
  initialBest: ContourPrecisionCandidate | undefined,
): { readonly complete: number | null; readonly best: ContourPrecisionCandidate | undefined } {
  let best = initialBest;
  for (
    let decimalPlaces = CNC_CONTOUR_DETAIL_DECIMAL_PLACES;
    decimalPlaces <= CNC_CONTOUR_MAX_DECIMAL_PLACES;
    decimalPlaces += 1
  ) {
    const stats = contourSegmentStatsAtPrecision(points, decimalPlaces);
    if (stats.retainedSegments === geometricSegments) return { complete: decimalPlaces, best };
    best = betterCandidate(best, candidateFromStats(decimalPlaces, stats));
    if (roundedPrefixesHaveStabilized(points, exactPrefixes, decimalPlaces)) break;
  }
  return { complete: null, best };
}

function candidateFromStats(
  precision: CncContourEmissionPrecision,
  stats: ContourSegmentStats,
): ContourPrecisionCandidate | undefined {
  return stats.retainedSegments > 0
    ? { precision, retainedSegments: stats.retainedSegments }
    : undefined;
}

function betterCandidate(
  current: ContourPrecisionCandidate | undefined,
  candidate: ContourPrecisionCandidate | undefined,
): ContourPrecisionCandidate | undefined {
  if (current === undefined) return candidate;
  if (candidate === undefined || current.retainedSegments >= candidate.retainedSegments) {
    return current;
  }
  return candidate;
}

/** Exact XY vertices represented by emitted G-code, with consecutive
 * stationary points removed. Used by Preview to mirror stock-GRBL parsed
 * coordinate targets; planner, firmware, and physical resolution are not
 * qualified here. */
export function cncContourEmissionPoints(pass: CncContourPass): ReadonlyArray<Vec2> {
  return cncContourEmissionVertices(pass).map((vertex) => vertex.point);
}

/** Parser-represented vertices plus their exact emitted word text. */
export function cncContourEmissionVertices(
  pass: CncContourPass,
): ReadonlyArray<CncContourEmissionVertex> {
  const precision = cncContourEmissionPrecision(pass);
  if (precision === null) return [];
  const vertices: CncContourEmissionVertex[] = [];
  for (const point of pass.polyline) {
    const xText = formatCncContourCoordinate(point.x, precision);
    const yText = formatCncContourCoordinate(point.y, precision);
    const parsed = {
      x: parseGrblCncCoordinate(xText),
      y: parseGrblCncCoordinate(yText),
    };
    const previous = vertices.at(-1);
    if (
      previous !== undefined &&
      cncContourCoordinateEquals(previous.xText, xText) &&
      cncContourCoordinateEquals(previous.yText, yText)
    ) {
      continue;
    }
    vertices.push({ point: parsed, xText, yText });
  }
  return vertices;
}

/** Format one selected-precision XY word exactly as the emitter will. Detail
 * coordinates are rounded at the selected width before their text is shortened
 * to the eight digits GRBL captures. That order preserves a later-digit carry
 * without wasting serial line length. Signed zero is canonicalized. */
export function formatCncContourCoordinate(
  coordinate: number,
  precision: CncContourEmissionPrecision,
): string {
  if (precision === CNC_CONTOUR_PARSER_PREFIX) {
    return formatGrblParserPrefix(coordinate);
  }
  // The standard path is a long-standing byte-level output contract. Do not
  // shorten large ordinary coordinates merely because a detail contour needs
  // a parser-aware representation.
  if (precision === CNC_COORDINATE_DECIMAL_PLACES) {
    return coordinate.toFixed(precision);
  }
  if (
    !Number.isInteger(precision) ||
    precision < CNC_CONTOUR_DETAIL_DECIMAL_PLACES ||
    precision > CNC_CONTOUR_MAX_DECIMAL_PLACES
  ) {
    throw new RangeError(`Unsupported CNC contour decimal precision: ${precision}`);
  }
  return formatRoundedGrblParserPrefix(coordinate, precision);
}

/** True when any requested segment is absent from the selected GRBL parser
 * representation. The remainder still emits and Preview mirrors it. */
export function cncContourLosesMotionAtSupportedPrecision(pass: CncContourPass): boolean {
  if (pass.polyline.length < 2) return false;
  const precision = cncContourEmissionPrecision(pass);
  if (precision === null) return contourGeometricSegmentCount(pass.polyline) > 0;
  const stats = contourSegmentStatsAtPrecision(pass.polyline, precision);
  return stats.retainedSegments < stats.geometricSegments;
}

/** Source-faithful model of stock GRBL's `read_float` for the fixed-decimal
 * coordinate words produced above. GRBL captures at most eight digits into an
 * integer, casts that integer to its 32-bit float, then applies the decimal
 * exponent through rounded 0.01/0.1 multiplications. A direct Math.fround of
 * the final JavaScript number is not equivalent near float boundaries. */
export function parseGrblCncCoordinate(formatted: string): number {
  const captured = captureGrblFixedDecimal(formatted);
  if (captured === null) return Number.NaN;
  let value = Math.fround(captured.integerValue);
  let exponent = captured.exponent;
  if (value !== 0) {
    while (exponent <= -2) {
      value = multiplyFloat32(value, 0.01);
      exponent += 2;
    }
    if (exponent < 0) {
      value = multiplyFloat32(value, 0.1);
    } else {
      while (exponent > 0) {
        value = multiplyFloat32(value, 10);
        exponent -= 1;
      }
    }
  }
  return captured.negative ? -value : value;
}

export function cncParsedCoordinateEquals(current: string | null, target: string): boolean {
  return current !== null && parseGrblCncCoordinate(current) === parseGrblCncCoordinate(target);
}

export function cncContourCoordinateEquals(current: string | null, target: string): boolean {
  return cncParsedCoordinateEquals(current, target);
}

function contourSegmentStatsAtPrecision(
  points: ReadonlyArray<Vec2>,
  decimalPlaces: CncContourEmissionPrecision,
): ContourSegmentStats {
  let geometricSegments = 0;
  let retainedSegments = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const point = points[index];
    if (previous === undefined || point === undefined) continue;
    if (previous.x === point.x && previous.y === point.y) continue;
    geometricSegments += 1;
    const previousX = formatCncContourCoordinate(previous.x, decimalPlaces);
    const previousY = formatCncContourCoordinate(previous.y, decimalPlaces);
    const currentX = formatCncContourCoordinate(point.x, decimalPlaces);
    const currentY = formatCncContourCoordinate(point.y, decimalPlaces);
    if (
      !cncParsedCoordinateEquals(previousX, currentX) ||
      !cncParsedCoordinateEquals(previousY, currentY)
    ) {
      retainedSegments += 1;
    }
  }
  return { geometricSegments, retainedSegments };
}

function contourGeometricSegmentCount(points: ReadonlyArray<Vec2>): number {
  let count = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const point = points[index];
    if (
      previous !== undefined &&
      point !== undefined &&
      (previous.x !== point.x || previous.y !== point.y)
    ) {
      count += 1;
    }
  }
  return count;
}

function roundedPrefixesHaveStabilized(
  points: ReadonlyArray<Vec2>,
  exactPrefixes: ReadonlyArray<{ readonly x: string; readonly y: string }>,
  decimalPlaces: number,
): boolean {
  return points.every((point, index) => {
    const exact = exactPrefixes[index];
    return (
      exact !== undefined &&
      formatRoundedGrblParserPrefix(point.x, decimalPlaces) === exact.x &&
      formatRoundedGrblParserPrefix(point.y, decimalPlaces) === exact.y
    );
  });
}

function formatRoundedGrblParserPrefix(coordinate: number, decimalPlaces: number): string {
  let formatted = coordinate.toFixed(decimalPlaces);
  const negative = formatted.startsWith('-');
  formatted = formatted.replace(/^[+-]/, '');
  let [integerDigits = '', fractionalDigits = ''] = formatted.split('.');
  if (integerDigits === '0' && digitCount(formatted) > GRBL_MAX_PARSED_DIGITS) {
    integerDigits = '';
  }
  if (integerDigits.length >= GRBL_MAX_PARSED_DIGITS) {
    return `${negative ? '-' : ''}${integerDigits}`;
  }
  const capturedFractionCount = GRBL_MAX_PARSED_DIGITS - integerDigits.length;
  fractionalDigits = fractionalDigits.slice(0, capturedFractionCount);
  const capturedIsZero = !/[1-9]/.test(integerDigits) && !/[1-9]/.test(fractionalDigits);
  const sign = negative && !capturedIsZero ? '-' : '';
  return integerDigits.length === 0
    ? `${sign}.${fractionalDigits}`
    : fractionalDigits.length === 0
      ? `${sign}${integerDigits}`
      : `${sign}${integerDigits}.${fractionalDigits}`;
}

function formatGrblParserPrefix(coordinate: number): string {
  if (!Number.isFinite(coordinate)) return String(coordinate);
  if (coordinate === 0) return '.00000000';
  const negative = coordinate < 0;
  if (Math.abs(coordinate) < 1e-8) return '.00000000';
  const exact = exactBinary64DecimalParts(Math.abs(coordinate));
  let { integerDigits } = exact;
  const { fractionalDigits } = exact;
  if (integerDigits === '0') integerDigits = '';
  const sign = negative ? '-' : '';
  if (integerDigits.length >= GRBL_MAX_PARSED_DIGITS) return `${sign}${integerDigits}`;
  const capturedFractionCount = GRBL_MAX_PARSED_DIGITS - integerDigits.length;
  const capturedFraction = fractionalDigits
    .padEnd(capturedFractionCount, '0')
    .slice(0, capturedFractionCount);
  return integerDigits.length === 0
    ? `${sign}.${capturedFraction}`
    : `${sign}${integerDigits}.${capturedFraction}`;
}

function exactBinary64DecimalParts(coordinate: number): {
  readonly integerDigits: string;
  readonly fractionalDigits: string;
} {
  const bits = new DataView(new ArrayBuffer(8));
  bits.setFloat64(0, coordinate, false);
  const high = bits.getUint32(0, false);
  const low = bits.getUint32(4, false);
  const exponentBits = (high >>> 20) & 0x7ff;
  const fraction = (BigInt(high & 0x000f_ffff) << 32n) | BigInt(low);
  const significand = exponentBits === 0 ? fraction : (1n << 52n) | fraction;
  const binaryExponent = exponentBits === 0 ? -1074 : exponentBits - 1023 - 52;
  if (binaryExponent >= 0) {
    return {
      integerDigits: (significand << BigInt(binaryExponent)).toString(),
      fractionalDigits: '',
    };
  }
  const decimalPlaces = -binaryExponent;
  const scaled = significand * 5n ** BigInt(decimalPlaces);
  const digits = scaled.toString().padStart(decimalPlaces + 1, '0');
  return {
    integerDigits: digits.slice(0, -decimalPlaces),
    fractionalDigits: digits.slice(-decimalPlaces).replace(/0+$/, ''),
  };
}

function digitCount(formatted: string): number {
  return formatted.replace(/[-.]/g, '').length;
}

function multiplyFloat32(left: number, right: number): number {
  return Math.fround(Math.fround(left) * Math.fround(right));
}

function captureGrblFixedDecimal(formatted: string): {
  readonly integerValue: number;
  readonly exponent: number;
  readonly negative: boolean;
} | null {
  const match = /^([+-]?)(\d*)(?:\.(\d*))?/.exec(formatted);
  if (match === null) return null;
  const integerDigits = match[2] ?? '';
  const fractionalDigits = match[3] ?? '';
  const digits = integerDigits + fractionalDigits;
  if (digits.length === 0) return null;
  const capturedFractionDigits = Math.max(
    0,
    Math.min(fractionalDigits.length, GRBL_MAX_PARSED_DIGITS - integerDigits.length),
  );
  return {
    integerValue: Number(digits.slice(0, GRBL_MAX_PARSED_DIGITS)),
    exponent:
      integerDigits.length > GRBL_MAX_PARSED_DIGITS
        ? integerDigits.length - GRBL_MAX_PARSED_DIGITS
        : -capturedFractionDigits,
    negative: match[1] === '-',
  };
}
