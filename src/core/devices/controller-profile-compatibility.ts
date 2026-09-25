import {
  DEFAULT_GRBL_RX_BUFFER_BYTES,
  GRBLHAL_DEFAULT_RX_BUFFER_BYTES,
  normalizeGrblRxBufferBytes,
  type GrblStreamingMode,
} from '../grbl-streaming';
import type { ControllerKind, DeviceProfile } from './device-profile';
import { isMarlinGcodeDialectId, type GcodeDialectId } from './gcode-dialects';

export type ControllerProfileCorrectionField =
  | 'controllerKind'
  | 'streamingMode'
  | 'rxBufferBytes'
  | 'gcodeDialect';

export type ControllerProfileCorrection = {
  readonly field: ControllerProfileCorrectionField;
  readonly from: string;
  readonly to: string;
  readonly reason: string;
};

export type ControllerProfileCompatibility = {
  readonly profile: DeviceProfile;
  readonly corrections: ReadonlyArray<ControllerProfileCorrection>;
};

export function controllerCompatibleProfile(
  profile: DeviceProfile,
  controllerKind?: ControllerKind,
): ControllerProfileCompatibility {
  const resolvedControllerKind = controllerKind ?? profile.controllerKind ?? 'grbl-v1.1';
  const persistControllerKind =
    controllerKind !== undefined || profile.controllerKind !== undefined;
  const streamingMode = requiredStreamingModeFor(
    resolvedControllerKind,
    profile.controllerKind,
    profile.streamingMode,
  );
  const dialectId = compatibleDialectFor(resolvedControllerKind, profile.gcodeDialect.dialectId);
  const rxBufferBytes = compatibleRxBufferBytesFor(
    resolvedControllerKind,
    normalizeGrblRxBufferBytes(profile.rxBufferBytes),
    profile.controllerKind,
  );
  const corrections = controllerProfileCorrections({
    profile,
    resolvedControllerKind,
    persistControllerKind,
    streamingMode,
    dialectId,
    rxBufferBytes,
  });

  const identityChanged =
    profile.controllerKind !==
      (persistControllerKind ? resolvedControllerKind : profile.controllerKind) ||
    profile.gcodeDialect.dialectId !== dialectId;
  const compatibleProfile: DeviceProfile = {
    ...profile,
    ...(persistControllerKind ? { controllerKind: resolvedControllerKind } : {}),
    streamingMode,
    rxBufferBytes,
    gcodeDialect: { dialectId },
    ...(identityChanged && profile.scanningOffsets.length > 0
      ? { scanningOffsets: [], scanOffsetCalibrationStatus: undefined }
      : {}),
  };
  return {
    profile: compatibleProfile,
    corrections,
  };
}

function controllerProfileCorrections(args: {
  readonly profile: DeviceProfile;
  readonly resolvedControllerKind: ControllerKind;
  readonly persistControllerKind: boolean;
  readonly streamingMode: GrblStreamingMode;
  readonly dialectId: GcodeDialectId;
  readonly rxBufferBytes: number;
}): ReadonlyArray<ControllerProfileCorrection> {
  return [
    ...changedControllerKindCorrection(args),
    ...changedFieldCorrection(
      'streamingMode',
      args.profile.streamingMode,
      args.streamingMode,
      streamingCorrectionReason(args.resolvedControllerKind, args.streamingMode),
    ),
    ...changedFieldCorrection(
      'gcodeDialect',
      args.profile.gcodeDialect.dialectId,
      args.dialectId,
      `The ${args.profile.gcodeDialect.dialectId} output dialect is not compatible with ${args.resolvedControllerKind}.`,
    ),
    ...changedFieldCorrection(
      'rxBufferBytes',
      String(args.profile.rxBufferBytes),
      String(args.rxBufferBytes),
      rxWindowCorrectionReason(args.resolvedControllerKind, args.rxBufferBytes),
    ),
  ];
}

// The stock-GRBL 120-byte window is the catalog default every profile inherits.
// On grblHAL it holds only ~8 raster lines against a >= 1 KiB ring and a planner
// of 100 blocks by default ($398; a Falcon A1 Pro reported 512), so any host or
// USB round trip longer than a few milliseconds of motion can starve the planner
// (stop-and-go, simulator-shown, ADR-331).
// A grblHAL family therefore lifts a window still sitting at the inherited
// stock default; a value the operator typed is theirs and stays, EXCEPT the
// stock default itself, which is indistinguishable from never having chosen.
// Crossing back OFF grblHAL restores the stock default the same way the
// streaming mode is restored, so a FluidNC or stock-GRBL board never inherits
// a window sized for grblHAL's larger ring. The Start boundary bounds the
// streamed window by the capacity the controller reports, so neither direction
// can exceed a proven ring.
function compatibleRxBufferBytesFor(
  controllerKind: ControllerKind,
  current: number,
  configuredControllerKind: ControllerKind | undefined,
): number {
  if (controllerKind === 'grblhal') {
    return current === DEFAULT_GRBL_RX_BUFFER_BYTES ? GRBLHAL_DEFAULT_RX_BUFFER_BYTES : current;
  }
  return configuredControllerKind === 'grblhal' && current === GRBLHAL_DEFAULT_RX_BUFFER_BYTES
    ? DEFAULT_GRBL_RX_BUFFER_BYTES
    : current;
}

function rxWindowCorrectionReason(controllerKind: ControllerKind, rxBufferBytes: number): string {
  if (controllerKind === 'grblhal' && rxBufferBytes === GRBLHAL_DEFAULT_RX_BUFFER_BYTES) {
    return 'grblHAL controllers keep a larger serial receive buffer; the streamed window stays bounded by the capacity the controller reports.';
  }
  if (controllerKind !== 'grblhal' && rxBufferBytes === DEFAULT_GRBL_RX_BUFFER_BYTES) {
    return `A receive window sized for grblHAL does not carry over to ${controllerKind}; the stock receive window applies.`;
  }
  return 'Use a bounded positive receive window.';
}

function changedControllerKindCorrection(args: {
  readonly profile: DeviceProfile;
  readonly resolvedControllerKind: ControllerKind;
  readonly persistControllerKind: boolean;
}): ReadonlyArray<ControllerProfileCorrection> {
  if (!args.persistControllerKind || args.profile.controllerKind === args.resolvedControllerKind) {
    return [];
  }
  return [
    correction(
      'controllerKind',
      args.profile.controllerKind ?? 'grbl-v1.1',
      args.resolvedControllerKind,
      'Use the firmware family reported by the connected controller.',
    ),
  ];
}

function changedFieldCorrection(
  field: ControllerProfileCorrectionField,
  from: string,
  to: string,
  reason: string,
): ReadonlyArray<ControllerProfileCorrection> {
  return from === to ? [] : [correction(field, from, to, reason)];
}

export function controllerSupportsGcodeDialect(
  controllerKind: ControllerKind | undefined,
  dialectId: GcodeDialectId,
): boolean {
  const resolved = controllerKind ?? 'grbl-v1.1';
  if (resolved === 'marlin') return isMarlinGcodeDialectId(dialectId);
  if (isMarlinGcodeDialectId(dialectId)) return false;
  if (dialectId === 'neotronics-4040-safe') return isGrblFamily(resolved);
  return true;
}

export function controllerProfilesAreCompatible(
  configured: ControllerKind | undefined,
  detected: ControllerKind | null,
): boolean {
  if (detected === null) return true;
  return (configured ?? 'grbl-v1.1') === detected;
}

function requiredStreamingModeFor(
  controllerKind: ControllerKind,
  configuredControllerKind: ControllerKind | undefined,
  current: GrblStreamingMode,
): GrblStreamingMode {
  if (controllerKind === 'marlin' || controllerKind === 'smoothieware') return 'ping-pong';
  if (isGrblFamily(controllerKind) && !isGrblFamily(configuredControllerKind ?? 'grbl-v1.1')) {
    return 'char-counted';
  }
  return current;
}

function compatibleDialectFor(
  controllerKind: ControllerKind,
  current: GcodeDialectId,
): GcodeDialectId {
  if (controllerSupportsGcodeDialect(controllerKind, current)) return current;
  return controllerKind === 'marlin' ? 'marlin-inline' : 'grbl-dynamic';
}

function streamingCorrectionReason(
  controllerKind: ControllerKind,
  streamingMode: GrblStreamingMode,
): string {
  return streamingMode === 'ping-pong'
    ? `${controllerKind} requires one acknowledged line at a time.`
    : `${controllerKind} supports buffered character-counted streaming.`;
}

function correction(
  field: ControllerProfileCorrectionField,
  from: string,
  to: string,
  reason: string,
): ControllerProfileCorrection {
  return { field, from, to, reason };
}

function isGrblFamily(controllerKind: ControllerKind): boolean {
  return (
    controllerKind === 'grbl-v1.1' || controllerKind === 'grblhal' || controllerKind === 'fluidnc'
  );
}
