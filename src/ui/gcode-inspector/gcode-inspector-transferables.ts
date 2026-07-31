import type { GcodeInspectorWorkerResult } from './gcode-inspector-worker-protocol';

export function gcodeInspectorTransferables(
  result: GcodeInspectorWorkerResult,
): ReadonlyArray<ArrayBuffer> {
  if (result.parsed.kind !== 'ok') return [];
  const model = result.parsed.model;
  return uniqueArrayBuffers([
    model.positions.buffer,
    model.segKind.buffer,
    model.segMotion.buffer,
    model.segLine.buffer,
    model.segFeed.buffer,
    model.segPower.buffer,
    model.segRouteEndMm.buffer,
    model.lineCategories.buffer,
  ]);
}

function uniqueArrayBuffers(buffers: ReadonlyArray<ArrayBufferLike>): ReadonlyArray<ArrayBuffer> {
  const unique = new Set<ArrayBuffer>();
  for (const buffer of buffers) {
    if (buffer instanceof ArrayBuffer) unique.add(buffer);
  }
  return Array.from(unique);
}
