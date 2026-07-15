import {
  createLayer,
  IDENTITY_TRANSFORM,
  type Bounds,
  type ImportedSvg,
  type Layer,
  type Polyline,
} from '../scene';

export const CALIBRATION_LABEL_COLOR = '#000000';
const SOURCE_PREFIX = 'calibration-label:';
const LABEL_POWER = 20;
const LABEL_SPEED = 1500;
const ADVANCE = 4;

type Segment = readonly [number, number, number, number];
type SegmentName = 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g';

const SEGMENTS: Record<SegmentName, Segment> = {
  a: [0, 0, 3, 0],
  b: [3, 0, 3, 2.4],
  c: [3, 2.6, 3, 5],
  d: [0, 5, 3, 5],
  e: [0, 2.6, 0, 5],
  f: [0, 0, 0, 2.4],
  g: [0, 2.5, 3, 2.5],
};

const DIGITS: Record<string, ReadonlyArray<SegmentName>> = {
  '0': ['a', 'b', 'c', 'd', 'e', 'f'],
  '1': ['b', 'c'],
  '2': ['a', 'b', 'g', 'e', 'd'],
  '3': ['a', 'b', 'g', 'c', 'd'],
  '4': ['f', 'g', 'b', 'c'],
  '5': ['a', 'f', 'g', 'c', 'd'],
  '6': ['a', 'f', 'g', 'e', 'c', 'd'],
  '7': ['a', 'b', 'c'],
  '8': ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
  '9': ['a', 'b', 'c', 'd', 'f', 'g'],
};

export function createCalibrationLabelLayer(id: string): Layer {
  return {
    ...createLayer({
      id,
      name: 'Calibration labels',
      color: CALIBRATION_LABEL_COLOR,
      mode: 'line',
    }),
    power: LABEL_POWER,
    speed: LABEL_SPEED,
  };
}

export function createCalibrationLabelObject(args: {
  readonly id: string;
  readonly operationId: string;
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly sizeMm: number;
}): ImportedSvg {
  const rendered = renderCalibrationLabel(args.text, args.sizeMm);
  return {
    kind: 'imported-svg',
    id: args.id,
    source: `${SOURCE_PREFIX}${args.text}`,
    operationIds: [args.operationId],
    bounds: rendered.bounds,
    transform: { ...IDENTITY_TRANSFORM, x: args.x, y: args.y },
    paths: [{ color: CALIBRATION_LABEL_COLOR, polylines: rendered.polylines }],
  };
}

export function calibrationLabelWidthMm(text: string, sizeMm: number): number {
  return renderCalibrationLabel(text, sizeMm).bounds.maxX;
}

export function formatCalibrationNumber(value: number): string {
  if (Number.isInteger(value)) return value.toFixed(0);
  return value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

export function formatCalibrationInterval(value: number): string {
  return value.toFixed(2);
}

function renderCalibrationLabel(
  text: string,
  sizeMm: number,
): {
  readonly bounds: Bounds;
  readonly polylines: ReadonlyArray<Polyline>;
} {
  const scale = sizeMm / 5;
  const polylines: Polyline[] = [];
  let cursor = 0;
  for (const char of text) {
    for (const segment of segmentsForChar(char)) {
      polylines.push({
        closed: false,
        points: [
          { x: (segment[0] + cursor) * scale, y: segment[1] * scale },
          { x: (segment[2] + cursor) * scale, y: segment[3] * scale },
        ],
      });
    }
    cursor += char === '.' ? 2 : char === ' ' ? 2 : ADVANCE;
  }
  return normalizePolylines(polylines);
}

function segmentsForChar(char: string): ReadonlyArray<Segment> {
  const digit = DIGITS[char];
  if (digit !== undefined) return digit.map((name) => SEGMENTS[name]);
  if (char === '.') return [[1.5, 5.2, 1.5, 5.45]];
  if (char === '-') return [SEGMENTS.g];
  return [];
}

function normalizePolylines(polylines: ReadonlyArray<Polyline>): {
  readonly bounds: Bounds;
  readonly polylines: ReadonlyArray<Polyline>;
} {
  if (polylines.length === 0) return { bounds: zeroBounds(), polylines: [] };
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const polyline of polylines) {
    for (const point of polyline.points) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
  }
  if (!Number.isFinite(minX)) return { bounds: zeroBounds(), polylines: [] };
  return {
    bounds: { minX: 0, minY: 0, maxX: maxX - minX, maxY: maxY - minY },
    polylines: polylines.map((polyline) => ({
      closed: false,
      points: polyline.points.map((point) => ({ x: point.x - minX, y: point.y - minY })),
    })),
  };
}

function zeroBounds(): Bounds {
  return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
}
