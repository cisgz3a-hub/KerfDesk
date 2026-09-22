import type { DeviceProfile } from '../../core/devices';

/** Explicit observed stock-GRBL contract for tests that use physical bed mapping. */
export function stockNativeEvidence(device: DeviceProfile, forceOrigin = false, direction = 3) {
  return {
    controllerSessionEpoch: 7,
    homingState: 'confirmed' as const,
    activeControllerKind: 'grbl-v1.1' as const,
    detectedControllerKind: 'grbl-v1.1' as const,
    activeControllerCommandSet: null,
    controllerSettings: {
      homingEnabled: true,
      homingDirectionMask: direction,
      bedWidth: device.bedWidth,
      bedHeight: device.bedHeight,
      maxPowerS: 1000,
      minPowerS: 0,
      laserModeEnabled: true,
    },
    controllerSettingsObservation: { sessionEpoch: 7, observedAt: 1 },
    controllerBuildInfo: {
      protocolVersion: '1.1h',
      buildRevision: '20190830',
      userInfo: '',
      optionCodes: forceOrigin ? ['Z' as const] : [],
      plannerBufferBlocks: 15,
      rxBufferBytes: 128,
    },
    controllerBuildInfoObservation: { sessionEpoch: 7, observedAt: 1 },
  };
}
