// Optional device parts a saved project may carry, each normalized or dropped
// on load rather than trusted as written.

import { normalizeCameraProfile, type CameraProfile } from '../../core/camera';
import { normalizeGalvoSetup } from '../../core/devices/galvo-setup';

export function normalizeOptionalDeviceParts(
  dev: Record<string, unknown>,
): Record<string, unknown> {
  return {
    // ADR-704: a malformed galvo setup is dropped; the galvo link then refuses
    // to mark until the machine is set up again, rather than guess its source.
    ...(dev['galvo'] === undefined ? {} : { galvo: normalizeGalvoSetup(dev['galvo']) }),
    ...(dev['cameraProfile'] === undefined
      ? {}
      : { cameraProfile: normalizeCameraProfile(dev['cameraProfile'] as CameraProfile) }),
  };
}
