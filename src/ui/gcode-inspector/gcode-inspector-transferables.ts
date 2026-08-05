import {
  hasGcodeInspectorAnalysis,
  type GcodeInspectorWorkerResult,
} from './gcode-inspector-worker-protocol';

export function gcodeInspectorTransferables(
  result: GcodeInspectorWorkerResult,
): ReadonlyArray<ArrayBuffer> {
  if (!hasGcodeInspectorAnalysis(result)) return arrayBufferOf(result.sourceIndex.starts.buffer);
  const model = result.parsed.model;
  const time = result.analysis.time;
  return uniqueArrayBuffers([
    result.sourceIndex.starts.buffer,
    model.positions.buffer,
    model.segKind.buffer,
    model.segMotion.buffer,
    model.segLine.buffer,
    model.segFeed.buffer,
    model.segPower.buffer,
    model.segRouteEndMm.buffer,
    model.lineCategories.buffer,
    time.segSeconds.buffer,
    time.segDistanceMm.buffer,
    time.segTargetVelocityMmPerSec.buffer,
    time.segEntryVelocityMmPerSec.buffer,
    time.segExitVelocityMmPerSec.buffer,
    time.segTimeEndSec.buffer,
    time.segFeedLimited.buffer,
  ]);
}

function arrayBufferOf(buffer: ArrayBufferLike): ReadonlyArray<ArrayBuffer> {
  return buffer instanceof ArrayBuffer ? [buffer] : [];
}

function uniqueArrayBuffers(buffers: ReadonlyArray<ArrayBufferLike>): ReadonlyArray<ArrayBuffer> {
  const unique = new Set<ArrayBuffer>();
  for (const buffer of buffers) {
    if (buffer instanceof ArrayBuffer) unique.add(buffer);
  }
  return Array.from(unique);
}
