import { normalizeGrblRxBufferBytes, type GrblStreamingMode } from '../grbl-streaming';
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
  const corrections: ControllerProfileCorrection[] = [];
  let streamingMode = profile.streamingMode;
  let dialectId = profile.gcodeDialect.dialectId;
  const rxBufferBytes = normalizeGrblRxBufferBytes(profile.rxBufferBytes);

  if (persistControllerKind && profile.controllerKind !== resolvedControllerKind) {
    corrections.push(
      correction(
        'controllerKind',
        profile.controllerKind ?? 'grbl-v1.1',
        resolvedControllerKind,
        'Use the firmware family reported by the connected controller.',
      ),
    );
  }

  const requiredStreamingMode = requiredStreamingModeFor(
    resolvedControllerKind,
    profile.controllerKind,
    streamingMode,
  );
  if (requiredStreamingMode !== streamingMode) {
    corrections.push(
      correction(
        'streamingMode',
        streamingMode,
        requiredStreamingMode,
        streamingCorrectionReason(resolvedControllerKind, requiredStreamingMode),
      ),
    );
    streamingMode = requiredStreamingMode;
  }

  const compatibleDialectId = compatibleDialectFor(resolvedControllerKind, dialectId);
  if (compatibleDialectId !== dialectId) {
    corrections.push(
      correction(
        'gcodeDialect',
        dialectId,
        compatibleDialectId,
        `The ${dialectId} output dialect is not compatible with ${resolvedControllerKind}.`,
      ),
    );
    dialectId = compatibleDialectId;
  }

  if (rxBufferBytes !== profile.rxBufferBytes) {
    corrections.push(
      correction(
        'rxBufferBytes',
        String(profile.rxBufferBytes),
        String(rxBufferBytes),
        'Use a bounded positive receive window.',
      ),
    );
  }

  return {
    profile: {
      ...profile,
      ...(persistControllerKind ? { controllerKind: resolvedControllerKind } : {}),
      streamingMode,
      rxBufferBytes,
      gcodeDialect: { dialectId },
    },
    corrections,
  };
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
  if (controllerKind === 'marlin') {
    return isMarlinGcodeDialectId(current) ? current : 'marlin-inline';
  }
  return isMarlinGcodeDialectId(current) ? 'grbl-dynamic' : current;
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
