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

import { parseStlBlob } from '../../io/stl/parse-stl-blob';
import type { ImportWorkerRequest, ImportWorkerResponse } from './import-worker-protocol';
import { packDxfResult } from './packed-dxf-result';
import { packGcodeResult } from './packed-gcode-result';
import { parseDxfBlob } from './parse-dxf-blob';
import { parseGcodeBlob } from './parse-gcode-blob';
import { prepareParsedStlImport } from './stl-import-preparation';
import { importWorkerTransferables } from './import-worker-transferables';

self.onmessage = (e: MessageEvent<ImportWorkerRequest>): void => {
  void handleRequest(e.data);
};

async function handleRequest(request: ImportWorkerRequest): Promise<void> {
  try {
    const response = await parseRequest(request);
    self.postMessage(response, { transfer: [...importWorkerTransferables(response)] });
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
  postProgress(request.id, 'reading');
  if (request.kind === 'dxf') {
    return {
      id: request.id,
      kind: 'dxf',
      result: packDxfResult(
        await parseDxfBlob(
          request.blob,
          { id: request.objectId, source: request.source },
          ({ bytesRead, totalBytes }) => {
            postProgress(request.id, 'parsing', bytesRead, totalBytes);
          },
        ),
      ),
    };
  }
  if (request.kind === 'gcode') {
    return {
      id: request.id,
      kind: 'gcode',
      result: packGcodeResult(
        await parseGcodeBlob(request.blob, ({ bytesRead, totalBytes }) => {
          postProgress(request.id, 'parsing', bytesRead, totalBytes);
        }),
      ),
    };
  }
  const parsed = await parseStlBlob(request.blob, ({ bytesRead, totalBytes }) => {
    postProgress(request.id, 'parsing', bytesRead, totalBytes);
  });
  postProgress(request.id, 'preparing');
  return {
    id: request.id,
    kind: 'stl',
    result: prepareParsedStlImport(parsed, request.options),
  };
}

function postProgress(
  id: number,
  phase: Extract<ImportWorkerResponse, { kind: 'progress' }>['phase'],
  bytesRead?: number,
  totalBytes?: number,
): void {
  const response: ImportWorkerResponse = {
    id,
    kind: 'progress',
    phase,
    ...(bytesRead === undefined ? {} : { bytesRead }),
    ...(totalBytes === undefined ? {} : { totalBytes }),
  };
  self.postMessage(response);
}
