/// <reference lib="webworker" />

// Runs Offset Shapes, Combine Shapes and Weld previews off the UI thread
// (ADR-606). The worker keeps the last source objects it was sent, so a dialog
// posts its selection once and each later edit posts only the new options.

import type { VectorSceneObject } from '../../core/geometry';
import { unpackSceneObjectsMessage } from '../packed-scene-objects-transfer';
import type { VectorOpRequest, VectorOpResponse } from './vector-op-worker-protocol';
import { vectorOpResponse } from './vector-op-worker-runtime';

let sources: ReadonlyArray<VectorSceneObject> = [];

self.onmessage = (event: MessageEvent<VectorOpRequest>): void => {
  const request = event.data;
  try {
    if (request.sources !== undefined) sources = unpackSceneObjectsMessage(request.sources);
    const { response, transfer } = vectorOpResponse(request.id, sources, request.task);
    self.postMessage(response, transfer);
  } catch (error) {
    const response: VectorOpResponse = {
      id: request.id,
      kind: 'fatal',
      message: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(response);
  }
};
