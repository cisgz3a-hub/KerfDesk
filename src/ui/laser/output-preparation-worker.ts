/// <reference lib="webworker" />

import { prepareOutputRequest } from './output-preparation';
import type {
  OutputPreparationWireEnvelope,
  OutputPreparationResponse,
  OutputPreparationResult,
} from './output-preparation-protocol';
import { acceptCanvasCompilationBridgeConnection } from '../workspace/canvas-compilation-worker-pool';
import { unpackProjectMessage } from '../packed-project-transfer';
import type { Project } from '../../core/scene';
import { packStartPreparationForWire } from './start-preparation-wire';
import {
  hasColumnPackedEncoding,
  packedManifestTransferables,
} from '../state/recovery/packed-motion-manifest';

self.onmessage = (event: MessageEvent<OutputPreparationWireEnvelope>): void => {
  if (acceptCanvasCompilationBridgeConnection(event.data)) return;
  void prepare(event.data);
};

async function prepare(envelope: OutputPreparationWireEnvelope): Promise<void> {
  const { requestId, request } = envelope;
  let response: OutputPreparationResponse;
  let transfer: Transferable[] = [];
  try {
    const project = unpackProjectMessage(request.project);
    const prepared = await prepareOutputRequest(
      { ...request, project },
      {
        jobId: `output:${requestId}`,
        onProgress: (progress) => {
          const update: OutputPreparationResult = { requestId, progress };
          self.postMessage(update);
        },
        onFrameBounds: (frameBounds) => {
          const update: OutputPreparationResult = { requestId, frameBounds };
          self.postMessage(update);
        },
      },
    );
    ({ response, transfer } = wireResponse(prepared, project));
  } catch (error) {
    response = {
      kind: 'error',
      message: error instanceof Error ? error.message : String(error),
    };
  }
  const result: OutputPreparationResult = { requestId, response };
  self.postMessage(result, { transfer });
}

// A Start's motion columns move to the window instead of being copied: one
// bed-sized photo's are hundreds of megabytes (ADR-244 Amendment 3). Its scene
// and fill segments cross as indices and columns (start-preparation-wire.ts,
// ADR-598 Amendment 4). This worker never reads a finished preparation again.
function wireResponse(
  response: OutputPreparationResponse,
  requestProject: Project,
): { readonly response: OutputPreparationResponse; readonly transfer: Transferable[] } {
  if (response.kind !== 'start' || 'wire' in response.result) return { response, transfer: [] };
  const manifest = response.result.ok ? response.result.canvasPlan.manifest : null;
  const manifestTransfer =
    manifest !== null && hasColumnPackedEncoding(manifest)
      ? packedManifestTransferables(manifest)
      : [];
  const wire = packStartPreparationForWire(response.result, requestProject);
  return {
    response: { kind: 'start', result: wire.message },
    transfer: [...manifestTransfer, ...wire.transfer],
  };
}
