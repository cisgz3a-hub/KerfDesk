import type { GrblBuildInfo } from '../../core/controllers/grbl/build-info';
import {
  DEFAULT_GRBL_RX_BUFFER_BYTES,
  streamingModeForController,
  type ControllerKind,
} from '../../core/devices';
import type { SessionObservationStamp } from './laser-controller-observation';
import { normalizeStartJobOptions, type StartJobOptions } from './laser-job-options';

export type StartStreamControllerEvidence = {
  readonly controllerBuildInfo: GrblBuildInfo | null;
  readonly controllerBuildInfoObservation: SessionObservationStamp | null;
  readonly controllerSessionEpoch: number;
};

export function effectiveStartStreamOptions(
  options: StartJobOptions,
  state: StartStreamControllerEvidence,
  activeControllerKind: ControllerKind,
): StartJobOptions {
  const normalized = normalizeStartJobOptions(options);
  const requestedStreamingMode = normalized.streamingMode ?? 'char-counted';
  const requestedRxBufferBytes = normalized.rxBufferBytes ?? DEFAULT_GRBL_RX_BUFFER_BYTES;
  const liveRx =
    state.controllerBuildInfoObservation?.sessionEpoch === state.controllerSessionEpoch
      ? state.controllerBuildInfo?.rxBufferBytes
      : undefined;
  const evidenceBoundRxBufferBytes =
    liveRx === undefined
      ? stockGrblFallbackRxBufferBytes(activeControllerKind, requestedRxBufferBytes)
      : liveRx;
  return {
    ...options,
    ...normalized,
    streamingMode: streamingModeForController(activeControllerKind, requestedStreamingMode),
    rxBufferBytes: Math.min(requestedRxBufferBytes, evidenceBoundRxBufferBytes),
  };
}

function stockGrblFallbackRxBufferBytes(
  activeControllerKind: ControllerKind,
  requestedRxBufferBytes: number,
): number {
  return activeControllerKind === 'grbl-v1.1'
    ? DEFAULT_GRBL_RX_BUFFER_BYTES
    : requestedRxBufferBytes;
}
