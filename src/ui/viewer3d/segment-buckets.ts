// The rapids' render bucket (ADR-255 stage 4; ADR-485): the travel moves
// copied out as plain typed arrays, unit-testable without WebGL (the ADR-102
// §2 pure-seam pattern), for the thin translucent line the looks restyle. The
// solid moves draw straight from the program instead (program-lines.ts).

import { SEG_KIND } from '../../core/gcode-view';

export type Viewer3dSegmentsInput = {
  readonly segmentCount: number;
  /** Six floats per segment: x0 y0 z0 x1 y1 z1 (work coordinates, mm). */
  readonly positions: Float32Array;
  readonly segKind: Uint8Array;
  /** Per segment, 0 leaves the move out of the drawing (ADR-470 filters). */
  readonly visible?: Uint8Array | null;
};

export type TravelBucket = {
  readonly count: number;
  readonly positions: Float32Array;
  /** Render-model segment index of each bucket entry, ascending. */
  readonly sourceIndex: Uint32Array;
};

const FLOATS_PER_SEGMENT = 6;

export function buildTravelBucket(segments: Viewer3dSegmentsInput): TravelBucket {
  const count = countTravel(segments);
  const positions = new Float32Array(count * FLOATS_PER_SEGMENT);
  const sourceIndex = new Uint32Array(count);
  let at = 0;
  for (let index = 0; index < segments.segmentCount; index += 1) {
    if (!isDrawnTravel(segments, index)) continue;
    positions.set(
      segments.positions.subarray(index * FLOATS_PER_SEGMENT, (index + 1) * FLOATS_PER_SEGMENT),
      at * FLOATS_PER_SEGMENT,
    );
    sourceIndex[at] = index;
    at += 1;
  }
  return { count, positions, sourceIndex };
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

function countTravel(segments: Viewer3dSegmentsInput): number {
  let count = 0;
  for (let index = 0; index < segments.segmentCount; index += 1) {
    if (isDrawnTravel(segments, index)) count += 1;
  }
  return count;
}

function isDrawnTravel(segments: Viewer3dSegmentsInput, index: number): boolean {
  return segments.segKind[index] === SEG_KIND.travel && segments.visible?.[index] !== 0;
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
