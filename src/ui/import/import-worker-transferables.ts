import type { ImportWorkerResponse } from './import-worker-protocol';
import { packedDxfTransferables } from './packed-dxf-result';
import { packedGcodeTransferables } from './packed-gcode-result';

export function importWorkerTransferables(
  response: ImportWorkerResponse,
): ReadonlyArray<ArrayBuffer> {
  if (response.kind === 'dxf') return packedDxfTransferables(response.result);
  if (response.kind === 'gcode') return packedGcodeTransferables(response.result);
  if (response.kind === 'stl' && response.result.kind === 'ok') {
    const buffer = response.result.positions.buffer;
    return buffer instanceof ArrayBuffer ? [buffer] : [];
  }
  return [];
}
