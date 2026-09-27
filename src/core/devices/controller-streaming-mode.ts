import type { GrblStreamingMode } from '../grbl-streaming';
import type { ControllerKind } from './device-profile';

// These firmwares do not expose a qualified GRBL RX-byte window. FluidNC's
// channel contract explicitly requires an acknowledgement before another line
// (v4.0.3 Serial.cpp, lines 23-25; ADR-445). GRBL-compatible commands alone do
// not establish character-counting support.
const PING_PONG_ONLY_CONTROLLERS: ReadonlySet<ControllerKind> = new Set([
  'fluidnc',
  'marlin',
  'smoothieware',
]);

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
