// Where the controller's planner drains: a program is planned in spans that
// end at each dwell, pause, program end or other synchronization (moved from
// program-time.ts so a streamed parse can split spans the same way, ADR-244
// Amendment 2).

import type { GcodeRenderModel, ProgramEvent } from '../gcode-view';

export type MotionSpan = { readonly startIndex: number; readonly endIndex: number };

export type SynchronizationBoundary = { readonly line: number; readonly isBeforeMotion: boolean };

export function motionSpans(
  model: GcodeRenderModel,
  segmentCount: number,
): ReadonlyArray<MotionSpan> {
  const spans: MotionSpan[] = [];
  let startIndex = 0;
  for (const boundary of synchronizationBoundaries(model.events)) {
    let endIndex = startIndex;
    while (
      endIndex < segmentCount &&
      segmentPrecedesBoundary(model.segLine[endIndex] ?? 0, boundary)
    ) {
      endIndex += 1;
    }
    if (endIndex > startIndex) spans.push({ startIndex, endIndex });
    startIndex = endIndex;
  }
  if (startIndex < segmentCount) spans.push({ startIndex, endIndex: segmentCount });
  return spans;
}

/** The planner drains, in program order, from these events. */
export function synchronizationBoundaries(
  events: Iterable<ProgramEvent>,
): ReadonlyArray<SynchronizationBoundary> {
  const boundaries = new Map<number, number>();
  for (const event of events) {
    let isBeforeMotion: boolean;
    if (event.kind === 'dwell') isBeforeMotion = event.isBeforeMotion === true;
    // GRBL drains the planner at M2/M30 after the block's motion (gcode.c,
    // protocol_buffer_synchronize) and then runs any lines that follow.
    else if (event.kind === 'pause' || event.kind === 'program-end') isBeforeMotion = false;
    else if (event.kind === 'synchronization') isBeforeMotion = event.isBeforeMotion;
    else continue;
    // One block can have both G4 before motion and M0 after it. Keep both
    // boundaries instead of allowing one event to hide the other.
    boundaries.set(event.line, (boundaries.get(event.line) ?? 0) | (isBeforeMotion ? 1 : 2));
  }
  return [...boundaries]
    .flatMap(([line, sides]) => [
      ...((sides & 1) === 0 ? [] : [{ line, isBeforeMotion: true }]),
      ...((sides & 2) === 0 ? [] : [{ line, isBeforeMotion: false }]),
    ])
    .sort(
      (left, right) =>
        left.line - right.line || Number(right.isBeforeMotion) - Number(left.isBeforeMotion),
    );
}

export function segmentPrecedesBoundary(
  segmentLine: number,
  boundary: SynchronizationBoundary,
): boolean {
  return boundary.isBeforeMotion ? segmentLine < boundary.line : segmentLine <= boundary.line;
}
