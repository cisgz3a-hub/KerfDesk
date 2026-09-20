// The character-counting window a job actually streams with. The profile asks
// for a window; the controller's own evidence bounds it (ADR-331):
//
//   - a stock `$I` OPT response names the compiled RX ring size;
//   - a status `Bf:` report observed while nothing was in flight names the free
//     ring bytes, which is the ring's capacity at that moment.
//
// Both are current-session evidence only. Without any, the GRBL family falls
// back to the stock 128-byte ring's 120 usable bytes — the safe direction for a
// controller that never proved more — while firmwares whose profile value is
// the only authority (FluidNC, ping-pong controllers) keep the request. The
// window is never raised above the profile request.

import type { GrblBuildInfo } from '../../core/controllers/grbl/build-info';
import {
  DEFAULT_GRBL_RX_BUFFER_BYTES,
  streamingModeForController,
  type ControllerKind,
  type GrblStreamingMode,
} from '../../core/devices';
// Deep import: the devices barrel is at its public-export ratchet.
import { rxWindowFromReportedCapacity } from '../../core/grbl-streaming';
import type { SessionObservationStamp } from './laser-controller-observation';
import { normalizeStartJobOptions, type StartJobOptions } from './laser-job-options';
import { currentRxCapacityEvidence, type RxCapacityEvidence } from './laser-rx-capacity-evidence';

export type StartStreamControllerEvidence = {
  readonly controllerBuildInfo: GrblBuildInfo | null;
  readonly controllerBuildInfoObservation: SessionObservationStamp | null;
  readonly controllerSessionEpoch: number;
  readonly rxCapacityEvidence?: RxCapacityEvidence | null;
};

export type StartStreamWindowSource =
  /** Bounded by a status `Bf:` receive-capacity report from this session. */
  | 'controller-reported'
  /** Bounded by a stock `$I` OPT receive-ring size from this session. */
  | 'build-info'
  /** The profile request, for firmwares that offer no ring evidence. */
  | 'profile'
  /** No evidence this session: the stock GRBL 120-byte window. */
  | 'stock-fallback';

export type StartStreamWindow = {
  readonly streamingMode: GrblStreamingMode;
  /** Bytes the streamer keeps in flight. */
  readonly bytes: number;
  /** The profile's request before any controller bound. */
  readonly requestedBytes: number;
  readonly source: StartStreamWindowSource;
  /** Usable window the controller evidence proved, before the profile cap. */
  readonly provenBytes: number | null;
};

// Firmwares whose receive ring the app can and must prove before streaming
// past the stock window: stock GRBL reports it in `$I` and `Bf:`; grblHAL only
// in `Bf:` (its extended `$I` is not stock proof and is never sent).
const EVIDENCE_BOUNDED_CONTROLLERS: ReadonlySet<ControllerKind> = new Set(['grbl-v1.1', 'grblhal']);

export function resolveStartStreamWindow(
  options: StartJobOptions,
  state: StartStreamControllerEvidence,
  activeControllerKind: ControllerKind,
): StartStreamWindow {
  const normalized = normalizeStartJobOptions(options);
  const streamingMode = streamingModeForController(
    activeControllerKind,
    normalized.streamingMode ?? 'char-counted',
  );
  const requestedBytes = normalized.rxBufferBytes ?? DEFAULT_GRBL_RX_BUFFER_BYTES;
  const buildInfoBytes = buildInfoWindowBytes(state);
  const reportedBytes = reportedWindowBytes(state);
  const provenBytes = smallerOf(buildInfoBytes, reportedBytes);
  if (provenBytes !== null) {
    return {
      streamingMode,
      bytes: Math.min(requestedBytes, provenBytes),
      requestedBytes,
      source: provenBytes === buildInfoBytes ? 'build-info' : 'controller-reported',
      provenBytes,
    };
  }
  if (EVIDENCE_BOUNDED_CONTROLLERS.has(activeControllerKind)) {
    return {
      streamingMode,
      bytes: Math.min(requestedBytes, DEFAULT_GRBL_RX_BUFFER_BYTES),
      requestedBytes,
      source: 'stock-fallback',
      provenBytes: null,
    };
  }
  return {
    streamingMode,
    bytes: requestedBytes,
    requestedBytes,
    source: 'profile',
    provenBytes: null,
  };
}

export function effectiveStartStreamOptions(
  options: StartJobOptions,
  state: StartStreamControllerEvidence,
  activeControllerKind: ControllerKind,
): StartJobOptions {
  const normalized = normalizeStartJobOptions(options);
  const window = resolveStartStreamWindow(options, state, activeControllerKind);
  return {
    ...options,
    ...normalized,
    streamingMode: window.streamingMode,
    rxBufferBytes: window.bytes,
  };
}

function buildInfoWindowBytes(state: StartStreamControllerEvidence): number | null {
  if (state.controllerBuildInfoObservation?.sessionEpoch !== state.controllerSessionEpoch) {
    return null;
  }
  return rxWindowFromReportedCapacity(state.controllerBuildInfo?.rxBufferBytes);
}

function reportedWindowBytes(state: StartStreamControllerEvidence): number | null {
  return rxWindowFromReportedCapacity(currentRxCapacityEvidence(state)?.rxBytesFree);
}

function smallerOf(left: number | null, right: number | null): number | null {
  if (left === null) return right;
  if (right === null) return left;
  return Math.min(left, right);
}
