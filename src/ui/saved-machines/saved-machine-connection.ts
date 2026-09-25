import {
  controllerFingerprintFromEvidence,
  type ControllerFingerprint,
} from '../../core/saved-machines/controller-fingerprint';
import type { DeviceProfile } from '../../core/devices';
import { useLaserStore } from '../state/laser-store';

type LaserSnapshot = ReturnType<typeof useLaserStore.getState>;

/** What the connected controller has reported about itself, once the
 * connection is qualified (settings read, or not needed by its driver). */
export function connectedControllerFingerprint(
  laser: LaserSnapshot = useLaserStore.getState(),
): ControllerFingerprint | null {
  if (laser.connection.kind !== 'connected') return null;
  if (laser.controllerQualification.kind !== 'qualified') return null;
  return controllerFingerprintFromEvidence({
    firmware: laser.detectedControllerKind,
    buildInfo: laser.controllerBuildInfo,
    usb: laser.serialPortInfo ?? null,
    settings: laser.grblSettingsRows,
  });
}

/** The live connection was opened for another controller contract, so it must
 * be reopened before the switched profile's driver and baud take effect. */
export function reconnectNeededFor(
  profile: DeviceProfile,
  laser: LaserSnapshot = useLaserStore.getState(),
): boolean {
  if (laser.connection.kind !== 'connected') return false;
  return (
    laser.activeControllerKind !== (profile.controllerKind ?? 'grbl-v1.1') ||
    (laser.activeControllerCommandSet ?? null) !== (profile.controllerCommandSet ?? null)
  );
}
