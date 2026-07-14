import type { ControllerKind } from '../devices/device-profile';
import { selectControllerDriver } from './select-controller-driver';

export function controllerStartProtocolsAreCompatible(
  first: ControllerKind | undefined,
  second: ControllerKind | null | undefined,
): boolean {
  if (second == null) return true;
  return (
    selectControllerDriver(first).capabilities.startProtocol ===
    selectControllerDriver(second).capabilities.startProtocol
  );
}

export function controllerStartSnapshotIsCompatible(
  configured: ControllerKind | undefined,
  active: ControllerKind | undefined,
  detected: ControllerKind | null | undefined,
): boolean {
  return (
    controllerStartProtocolsAreCompatible(configured, active) &&
    controllerStartProtocolsAreCompatible(configured, detected) &&
    controllerStartProtocolsAreCompatible(active, detected)
  );
}
