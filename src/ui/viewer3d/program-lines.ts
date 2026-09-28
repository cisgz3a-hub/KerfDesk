// The solid moves drawn straight from the program (ADR-485). The fat lines read
// the render model's own positions, in program order, so the page keeps one
// copy of every move and the GPU one more, shared by the drawn lines, their
// faint copy during playback and the pick pass. Instance i is move i: the
// reveal is a draw count and the trail two move numbers. Rapids, and moves a
// legend filter leaves out, stay in the buffer with their shown flag off and
// the line shader drops them.
//
// Each move's colour is four 16-bit numbers, red, green, blue and shown, where
// six floats per move used to be. A lens rewrites them in place, so changing
// lens allocates nothing and uploads 8 bytes a move.

import type * as ThreeNamespace from 'three';
import type { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { SEG_KIND } from '../../core/gcode-view';
import { rgbTriple, type Viewer3dSegmentsInput } from './segment-buckets';
import type { Viewer3dTheme } from './viewer3d-theme';

type Rgb = readonly [number, number, number];

/** Red, green, blue and shown for each move. */
export const COLOR_STRIDE = 4;
const SHOWN = 3;
const FULL = 0xffff;
const FLOATS_PER_SEGMENT = 6;

/** The name the line shader reads a move's shown flag from. */
export const SHOWN_ATTRIBUTE = 'instanceShown';

/**
 * Kind colours for the solid moves, and how many there are; rapids and
 * filtered moves are not shown.
 */
export function programColors(
  segments: Viewer3dSegmentsInput,
  theme: Viewer3dTheme,
): { readonly colors: Uint16Array; readonly shown: number } {
  const colors = new Uint16Array(segments.segmentCount * COLOR_STRIDE);
  let shown = 0;
  const kindRgb: ReadonlyMap<number, Rgb> = new Map([
    [SEG_KIND.cut, rgbTriple(theme.cut)],
    [SEG_KIND.plunge, rgbTriple(theme.plunge)],
    [SEG_KIND.retract, rgbTriple(theme.retract)],
  ]);
  for (let index = 0; index < segments.segmentCount; index += 1) {
    const kind = segments.segKind[index] ?? SEG_KIND.travel;
    if (kind === SEG_KIND.travel || segments.visible?.[index] === 0) continue;
    writeRgb(colors, index, kindRgb.get(kind) ?? [1, 1, 1], identity);
    colors[index * COLOR_STRIDE + SHOWN] = FULL;
    shown += 1;
  }
  return { colors, shown };
}

/**
 * Repaints every shown move from a segment → rgb function, in place. `encode`
 * maps each channel on the way in (Studio's sRGB to linear, ADR-426).
 */
export function writeProgramColors(
  colors: Uint16Array,
  colorOf: (segmentIndex: number) => Rgb,
  encode: (channel: number) => number = identity,
): void {
  const count = colors.length / COLOR_STRIDE;
  for (let index = 0; index < count; index += 1) {
    if (colors[index * COLOR_STRIDE + SHOWN] === 0) continue;
    writeRgb(colors, index, colorOf(index), encode);
  }
}

/** Fat-line geometry over the program's positions and the colours above. */
export function createProgramGeometry(
  three: typeof ThreeNamespace,
  Geometry: typeof LineSegmentsGeometry,
  positions: Float32Array,
  colors: Uint16Array,
): { readonly geometry: LineSegmentsGeometry; readonly colorBuffer: { needsUpdate: boolean } } {
  const count = colors.length / COLOR_STRIDE;
  const geometry = new Geometry();
  // setPositions keeps a Float32Array as it is: no copy of the program.
  geometry.setPositions(positions.subarray(0, count * FLOATS_PER_SEGMENT));
  const colorBuffer = new three.InstancedInterleavedBuffer(colors, COLOR_STRIDE, 1);
  const rgb = new three.InterleavedBufferAttribute(colorBuffer, 3, 0, true);
  geometry.setAttribute('instanceColorStart', rgb);
  geometry.setAttribute('instanceColorEnd', rgb);
  geometry.setAttribute(
    SHOWN_ATTRIBUTE,
    new three.InterleavedBufferAttribute(colorBuffer, 1, SHOWN, true),
  );
  return { geometry, colorBuffer };
}

/**
 * A second geometry over the same GPU buffers, drawing every move whatever
 * the first one's reveal: the faint copy and the pick pass use it.
 */
export function shareProgramGeometry(
  Geometry: typeof LineSegmentsGeometry,
  source: LineSegmentsGeometry,
): LineSegmentsGeometry {
  const geometry = new Geometry();
  for (const name of ['instanceStart', 'instanceEnd', SHOWN_ATTRIBUTE]) {
    geometry.setAttribute(name, source.getAttribute(name));
  }
  geometry.instanceCount = source.getAttribute('instanceStart').count;
  geometry.boundingBox = source.boundingBox?.clone() ?? null;
  geometry.boundingSphere = source.boundingSphere?.clone() ?? null;
  return geometry;
}

function writeRgb(
  colors: Uint16Array,
  index: number,
  rgb: Rgb,
  encode: (channel: number) => number,
): void {
  const at = index * COLOR_STRIDE;
  for (let channel = 0; channel < 3; channel += 1) {
    const value = encode(rgb[channel] ?? 0);
    colors[at + channel] = Math.round(Math.min(1, Math.max(0, value)) * FULL);
  }
}

function identity(value: number): number {
  return value;
}
