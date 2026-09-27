// A live picture of a program while the worker reads it (ADR-485). A big
// file takes the worker tens of seconds to read and time; rather than a
// sentence, the Inspector shows the moves read so far, growing, with how far
// through the file the worker is. Every quarter second or so the worker sends
// the moves read since its last message, split into solid moves and rapids,
// in transferred buffers. The page keeps them only until the finished program
// replaces the picture.

import { SEG_KIND } from '../../core/gcode-view';
import type { SegmentRange } from '../../core/gcode-view/segment-builder';

const FLOATS_PER_SEGMENT = 6;
/** How often the worker sends what it has read. */
export const PREVIEW_INTERVAL_MS = 250;
// The clock is read once per this many lines, not per line.
const LINES_PER_CHECK = 1024;

export type PreviewChunk = {
  /** Solid moves read since the last chunk: x0 y0 z0 x1 y1 z1 each. */
  readonly solid: Float32Array;
  /** Rapids read since the last chunk. */
  readonly travel: Float32Array;
  /** Moves read so far, this chunk's included. */
  readonly moves: number;
  /** How far through the source the worker is, 0 to 1. */
  readonly fraction: number;
};

type Segments = {
  readonly count: () => number;
  readonly copyRange: (from: number) => SegmentRange;
};

export type PreviewEmitter = {
  /** Called once per line read; sends a chunk when one is due. */
  readonly line: (fraction: () => number) => void;
  /** Sends whatever is left, at the end of the source. */
  readonly flush: () => void;
};

export function createPreviewEmitter(
  segments: Segments,
  emit: (chunk: PreviewChunk) => void,
  now: () => number = () => performance.now(),
): PreviewEmitter {
  let sent = 0;
  let lines = 0;
  let last = now();
  const send = (fraction: number): void => {
    const count = segments.count();
    if (count === sent) return;
    emit({ ...splitPreview(segments.copyRange(sent)), moves: count, fraction });
    sent = count;
  };
  return {
    line: (fraction) => {
      lines += 1;
      if (lines % LINES_PER_CHECK !== 0) return;
      const time = now();
      if (time - last < PREVIEW_INTERVAL_MS) return;
      last = time;
      send(Math.min(1, Math.max(0, fraction())));
    },
    flush: () => send(1),
  };
}

/** Solid moves and rapids of a run, each packed into its own array. */
export function splitPreview(range: SegmentRange): Pick<PreviewChunk, 'solid' | 'travel'> {
  let travelCount = 0;
  for (const kind of range.segKind) if (kind === SEG_KIND.travel) travelCount += 1;
  const solid = new Float32Array((range.segKind.length - travelCount) * FLOATS_PER_SEGMENT);
  const travel = new Float32Array(travelCount * FLOATS_PER_SEGMENT);
  let solidAt = 0;
  let travelAt = 0;
  for (let index = 0; index < range.segKind.length; index += 1) {
    const isTravel = range.segKind[index] === SEG_KIND.travel;
    const target = isTravel ? travel : solid;
    const at = isTravel ? travelAt : solidAt;
    for (let component = 0; component < FLOATS_PER_SEGMENT; component += 1) {
      target[at + component] = range.positions[index * FLOATS_PER_SEGMENT + component] ?? 0;
    }
    if (isTravel) travelAt += FLOATS_PER_SEGMENT;
    else solidAt += FLOATS_PER_SEGMENT;
  }
  return { solid, travel };
}

/** What the page shows while the worker reads: every chunk so far. */
export type InspectionPreview = {
  readonly chunks: ReadonlyArray<PreviewChunk>;
  readonly moves: number;
  readonly fraction: number;
};

export function addPreviewChunk(
  preview: InspectionPreview | null,
  chunk: PreviewChunk,
): InspectionPreview {
  return {
    chunks: [...(preview?.chunks ?? []), chunk],
    moves: chunk.moves,
    fraction: chunk.fraction,
  };
}
