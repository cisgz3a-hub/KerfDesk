// Import parsing worker (Phase 3 of the large-file import plan).
//
// Reads the Blob and runs the parse away from the React/UI thread, so a large
// DXF / G-code / STL import no longer freezes the canvas for the seconds the
// parse takes (measured: ~11.4 s for a 100 MB DXF, ~7.6 s for 100 MB of G-code).
//
// Vite bundles this via the direct
// `new Worker(new URL('./import-worker.ts', import.meta.url), { type: 'module' })`
// call in import-worker-client.ts — the same wiring as the ADR-244 preparation
// worker and the Convert-to-Bitmap worker.

/// <reference lib="webworker" />

import { parseDxf } from '../../io/dxf';
import { parseGcodeProgram } from '../../io/gcode';
import { parseStl } from '../../io/stl';
import type { ImportWorkerRequest, ImportWorkerResponse } from './import-worker-protocol';

self.onmessage = (e: MessageEvent<ImportWorkerRequest>): void => {
  void handleRequest(e.data);
};

async function handleRequest(request: ImportWorkerRequest): Promise<void> {
  try {
    self.postMessage(await parseRequest(request));
  } catch (err) {
    const response: ImportWorkerResponse = {
      id: request.id,
      kind: 'error',
      message: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(response);
  }
}

async function parseRequest(request: ImportWorkerRequest): Promise<ImportWorkerResponse> {
  if (request.kind === 'dxf') {
    const dxfText = await request.blob.text();
    return {
      id: request.id,
      kind: 'dxf',
      result: parseDxf({ dxfText, id: request.objectId, source: request.source }),
    };
  }
  if (request.kind === 'gcode') {
    return {
      id: request.id,
      kind: 'gcode',
      result: parseGcodeProgram(await request.blob.text()),
    };
  }
  return { id: request.id, kind: 'stl', result: parseStl(await request.blob.arrayBuffer()) };
}
