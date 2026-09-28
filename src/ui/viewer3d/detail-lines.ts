// The simplified drawings of a big program on the GPU (ADR-485,
// move-detail.ts). Each level draws one fat line per run of moves, from the
// first move's start to the last one's end, coloured from the first move's
// colour to the last one's, so a depth ramp still shades along it. The
// colours are copied from the program's own colours after every lens change:
// a few bytes a line, as many lines as the level has.

import type * as ThreeNamespace from 'three';
import type { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import type { MoveDetail } from './move-detail';
import { COLOR_STRIDE, SHOWN_ATTRIBUTE, shareProgramGeometry } from './program-lines';

const FLOATS_PER_SEGMENT = 6;
// Start red, green, blue and shown, then end red, green and blue, and a spare.
const DETAIL_STRIDE = 8;
const END_COLOR = 4;
const SHOWN = 3;

export type DetailLines = {
  /** How far any move may be from its line, in mm. */
  readonly toleranceMm: number;
  /** Lines drawn at this level. */
  readonly count: number;
  readonly geometry: LineSegmentsGeometry;
  /** The same GPU buffers, for the faint copy during playback. */
  readonly ghostGeometry: LineSegmentsGeometry;
  readonly starts: Uint32Array;
  readonly ends: Uint32Array;
  readonly colors: Uint16Array;
  readonly colorBuffer: { needsUpdate: boolean };
};

export function createDetailLines(
  three: typeof ThreeNamespace,
  Geometry: typeof LineSegmentsGeometry,
  positions: Float32Array,
  detail: MoveDetail,
): ReadonlyArray<DetailLines> {
  return detail.levels.map((level) => {
    const count = level.starts.length;
    const lines = new Float32Array(count * FLOATS_PER_SEGMENT);
    for (let line = 0; line < count; line += 1) {
      const from = (level.starts[line] ?? 0) * FLOATS_PER_SEGMENT;
      const to = (level.ends[line] ?? 0) * FLOATS_PER_SEGMENT + 3;
      lines.set(positions.subarray(from, from + 3), line * FLOATS_PER_SEGMENT);
      lines.set(positions.subarray(to, to + 3), line * FLOATS_PER_SEGMENT + 3);
    }
    const geometry = new Geometry();
    geometry.setPositions(lines);
    const colors = new Uint16Array(count * DETAIL_STRIDE);
    const colorBuffer = new three.InstancedInterleavedBuffer(colors, DETAIL_STRIDE, 1);
    const attribute = (size: number, offset: number): ThreeNamespace.InterleavedBufferAttribute =>
      new three.InterleavedBufferAttribute(colorBuffer, size, offset, true);
    geometry.setAttribute('instanceColorStart', attribute(3, 0));
    geometry.setAttribute(SHOWN_ATTRIBUTE, attribute(1, SHOWN));
    geometry.setAttribute('instanceColorEnd', attribute(3, END_COLOR));
    return {
      toleranceMm: level.toleranceMm,
      count,
      geometry,
      ghostGeometry: shareProgramGeometry(Geometry, geometry),
      starts: level.starts,
      ends: level.ends,
      colors,
      colorBuffer,
    };
  });
}

/** Copies each line's colours from its first and last moves' colours. */
export function paintDetailLines(
  levels: ReadonlyArray<DetailLines>,
  programColors: Uint16Array,
): void {
  for (const level of levels) {
    for (let line = 0; line < level.count; line += 1) {
      const first = (level.starts[line] ?? 0) * COLOR_STRIDE;
      const last = (level.ends[line] ?? 0) * COLOR_STRIDE;
      const at = line * DETAIL_STRIDE;
      for (let channel = 0; channel < 3; channel += 1) {
        level.colors[at + channel] = programColors[first + channel] ?? 0;
        level.colors[at + END_COLOR + channel] = programColors[last + channel] ?? 0;
      }
      level.colors[at + SHOWN] = programColors[first + SHOWN] ?? 0;
    }
    level.colorBuffer.needsUpdate = true;
  }
}

export function disposeDetailLines(levels: ReadonlyArray<DetailLines>): void {
  for (const level of levels) {
    level.geometry.dispose();
    level.ghostGeometry.dispose();
  }
}
