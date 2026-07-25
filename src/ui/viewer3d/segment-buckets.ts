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
};

export type TravelBucket = {
  readonly count: number;
  readonly positions: Float32Array;
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
  const kindRgb = kindColorTable(theme);
  let travelAt = 0;
  let solidAt = 0;
  for (let index = 0; index < segments.segmentCount; index += 1) {
    const kind = segments.segKind[index] ?? SEG_KIND.travel;
    if (kind === SEG_KIND.travel) {
      copySegment(segments.positions, index, travelPositions, travelAt);
      travelAt += FLOATS_PER_SEGMENT;
      continue;
    }
    copySegment(segments.positions, index, solidPositions, solidAt);
    writeEndpointColors(solidColors, solidAt, kindRgb.get(kind) ?? FALLBACK_RGB);
    solidAt += FLOATS_PER_SEGMENT;
  }
  return {
    solid: { count: solidCount, positions: solidPositions, colors: solidColors },
    travel: { count: travelCount, positions: travelPositions },
  };
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
