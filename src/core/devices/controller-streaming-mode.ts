import type { GrblStreamingMode } from '../grbl-streaming';
import type { ControllerKind } from './device-profile';

// These firmwares do not expose a GRBL-compatible RX-byte window, so each
// queued line must wait for its acknowledgement before the next is sent.
const PING_PONG_ONLY_CONTROLLERS: ReadonlySet<ControllerKind> = new Set(['marlin', 'smoothieware']);

export function streamingModeForController(
  controllerKind: ControllerKind | undefined,
  requested: GrblStreamingMode,
): GrblStreamingMode {
  return controllerKind !== undefined && PING_PONG_ONLY_CONTROLLERS.has(controllerKind)
    ? 'ping-pong'
    : requested;
}

export function isStreamingModeCompatible(
  controllerKind: ControllerKind | undefined,
  streamingMode: GrblStreamingMode,
): boolean {
  return streamingModeForController(controllerKind, streamingMode) === streamingMode;
}
