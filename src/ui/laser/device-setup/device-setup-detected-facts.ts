import type { ControllerKind, DeviceProfile } from '../../../core/devices';

type DetectedSetupFacts = {
  readonly detected: Partial<DeviceProfile>;
  readonly detectedApplied: boolean;
  readonly detectedControllerKind: ControllerKind | null;
  readonly controllerRead: boolean;
};

type DetectedSetupFactsUpdate = {
  readonly detected?: Partial<DeviceProfile>;
  readonly detectedControllerKind?: ControllerKind | null;
  readonly controllerRead?: boolean;
};

export function mergeDetectedSetupFacts(
  current: DetectedSetupFacts,
  update: DetectedSetupFactsUpdate,
): DetectedSetupFacts | null {
  const detected = update.detected ?? current.detected;
  const detectedChanged = !sameDetectedValues(detected, current.detected);
  const detectedControllerKind =
    update.detectedControllerKind === undefined
      ? current.detectedControllerKind
      : update.detectedControllerKind;
  const controllerRead = update.controllerRead ?? true;
  if (
    !detectedChanged &&
    detectedControllerKind === current.detectedControllerKind &&
    controllerRead === current.controllerRead
  ) {
    return null;
  }
  return {
    detected,
    detectedApplied: detectedChanged ? false : current.detectedApplied,
    detectedControllerKind,
    controllerRead,
  };
}

function sameDetectedValues(left: Partial<DeviceProfile>, right: Partial<DeviceProfile>): boolean {
  const leftKeys = Object.keys(left) as Array<keyof DeviceProfile>;
  return (
    leftKeys.length === Object.keys(right).length &&
    leftKeys.every((key) => Object.is(left[key], right[key]))
  );
}
