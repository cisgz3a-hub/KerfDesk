// Pure segment→render-bucket builder (ADR-255 stage 4): splits render-model
// segments into a recessive travel bucket and a solid bucket colored per
// kind, as plain typed arrays — unit-testable without WebGL (the ADR-102 §2
// pure-seam pattern). The scene feeds the solid bucket to fat lines and the
// travel bucket to a thin translucent line object.

import { SEG_KIND } from '../../core/gcode-view';
import type { Viewer3dTheme } from './viewer3d-theme';

export type Viewer3dSegmentsInput = {
  readonly segmentCount: number;
  /** Six floats per segment: x0 y0 z0 x1 y1 z1 (work coordinates, mm). */
  readonly positions: Float32Array;
  readonly segKind: Uint8Array;
};

export type SolidBucket = {
  readonly count: number;
  readonly positions: Float32Array;
  /** Normalized rgb at both segment endpoints (6 floats per segment). */
  readonly colors: Float32Array;
  /** Render-model segment index of each bucket entry, ascending. */
  readonly sourceIndex: Uint32Array;
};

export type TravelBucket = {
  readonly count: number;
  readonly positions: Float32Array;
  /** Render-model segment index of each bucket entry, ascending. */
  readonly sourceIndex: Uint32Array;
};

export type SegmentBuckets = {
  readonly solid: SolidBucket;
  readonly travel: TravelBucket;
};

const FLOATS_PER_SEGMENT = 6;
const FALLBACK_RGB: readonly [number, number, number] = [1, 1, 1];

export function buildSegmentBuckets(
  segments: Viewer3dSegmentsInput,
  theme: Viewer3dTheme,
): SegmentBuckets {
  const travelCount = countTravelSegments(segments);
  const solidCount = segments.segmentCount - travelCount;
  const travelPositions = new Float32Array(travelCount * FLOATS_PER_SEGMENT);
  const solidPositions = new Float32Array(solidCount * FLOATS_PER_SEGMENT);
  const solidColors = new Float32Array(solidCount * FLOATS_PER_SEGMENT);
  const travelSource = new Uint32Array(travelCount);
  const solidSource = new Uint32Array(solidCount);
  const kindRgb = kindColorTable(theme);
  let travelAt = 0;
  let solidAt = 0;
  for (let index = 0; index < segments.segmentCount; index += 1) {
    const kind = segments.segKind[index] ?? SEG_KIND.travel;
    if (kind === SEG_KIND.travel) {
      copySegment(segments.positions, index, travelPositions, travelAt);
      travelSource[travelAt / FLOATS_PER_SEGMENT] = index;
      travelAt += FLOATS_PER_SEGMENT;
      continue;
    }
    copySegment(segments.positions, index, solidPositions, solidAt);
    writeEndpointColors(solidColors, solidAt, kindRgb.get(kind) ?? FALLBACK_RGB);
    solidSource[solidAt / FLOATS_PER_SEGMENT] = index;
    solidAt += FLOATS_PER_SEGMENT;
  }
  return {
    solid: {
      count: solidCount,
      positions: solidPositions,
      colors: solidColors,
      sourceIndex: solidSource,
    },
    travel: { count: travelCount, positions: travelPositions, sourceIndex: travelSource },
  };
}

/**
 * How many entries of a bucket fall at or before `segmentIndex` — the draw
 * count that reveals geometry up to the playhead. `sourceIndex` is ascending,
 * so this is a binary search (called once per bucket per frame).
 */
export function revealCount(sourceIndex: Uint32Array, segmentIndex: number): number {
  if (segmentIndex < 0) return 0;
  let low = 0;
  let high = sourceIndex.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if ((sourceIndex[mid] ?? 0) <= segmentIndex) low = mid + 1;
    else high = mid;
  }
  return low;
}

function countTravelSegments(segments: Viewer3dSegmentsInput): number {
  let count = 0;
  for (let index = 0; index < segments.segmentCount; index += 1) {
    if (segments.segKind[index] === SEG_KIND.travel) count += 1;
  }
  return count;
}

function copySegment(
  source: Float32Array,
  index: number,
  target: Float32Array,
  offset: number,
): void {
  const base = index * FLOATS_PER_SEGMENT;
  for (let component = 0; component < FLOATS_PER_SEGMENT; component += 1) {
    target[offset + component] = source[base + component] ?? 0;
  }
}

function writeEndpointColors(
  colors: Float32Array,
  offset: number,
  rgb: readonly [number, number, number],
): void {
  for (let end = 0; end < 2; end += 1) {
    colors[offset + end * 3] = rgb[0];
    colors[offset + end * 3 + 1] = rgb[1];
    colors[offset + end * 3 + 2] = rgb[2];
  }
}

function kindColorTable(
  theme: Viewer3dTheme,
): ReadonlyMap<number, readonly [number, number, number]> {
  return new Map([
    [SEG_KIND.cut, rgbTriple(theme.cut)],
    [SEG_KIND.plunge, rgbTriple(theme.plunge)],
    [SEG_KIND.retract, rgbTriple(theme.retract)],
  ]);
}

export function rgbTriple(color: number): readonly [number, number, number] {
  return [((color >> 16) & 0xff) / 255, ((color >> 8) & 0xff) / 255, (color & 0xff) / 255];
}

/** Numeric theme color → CSS hex string (legend swatches). */
export function cssHexColor(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

/**
 * The CSS colour a vertex-coloured fat line actually shows on screen.
 *
 * LineMaterial reads vertex colours as linear light and encodes them to sRGB
 * on output, so a triple taken straight from an sRGB hex renders lighter than
 * that hex: cut blue #4fa3ff shows as #97d1ff. The Classic look keeps those
 * lighter lines on purpose (ADR-425), so a legend describing them must apply
 * the same encoding or its swatches never match the toolpath.
 */
export function renderedLineCss(rgb: readonly [number, number, number]): string {
  const channel = (value: number): number =>
    Math.round(linearToSrgb(Math.min(1, Math.max(0, value))) * 255);
  return `rgb(${channel(rgb[0])}, ${channel(rgb[1])}, ${channel(rgb[2])})`;
}

/** Stops for a CSS gradient matching a linearly blended line-colour ramp. */
export function renderedLineRampStops(
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  count = 7,
): ReadonlyArray<string> {
  const stops: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const t = count <= 1 ? 0 : index / (count - 1);
    stops.push(
      renderedLineCss([
        from[0] + (to[0] - from[0]) * t,
        from[1] + (to[1] - from[1]) * t,
        from[2] + (to[2] - from[2]) * t,
      ]),
    );
  }
  return stops;
}

// IEC 61966-2-1 sRGB transfer function, the same one three.js applies.
function linearToSrgb(value: number): number {
  return value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
}
