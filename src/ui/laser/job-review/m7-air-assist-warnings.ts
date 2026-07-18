// Informational Job Review warning (ADR-224/ADR-228): stock GRBL 1.1 is
// commonly compiled without ENABLE_M7 and rejects M7 with error:20, which can
// fault a streamed job mid-program (observed on a Neotronics 4040, 2026-07-18;
// a grblHAL Falcon accepted the same program). This informs and never refuses —
// the M7 is emitted unchanged.

import type { DeviceProfile } from '../../../core/devices';

// Coolant M-codes are emitted on their own line; \b keeps M70 etc. from
// matching while still tolerating trailing words on a shared line.
const M7_COMMAND_PATTERN = /^\s*M7\b/m;

const M7_GRBL_V11_WARNING =
  'This job turns air assist on with M7, but stock GRBL 1.1 firmware is often compiled ' +
  'without M7 support and rejects it with error:20, which can fault the job partway through. ' +
  "If your controller rejects M7, change the device's Air assist command to M8 or None in " +
  'Device Settings.';

export function detectM7AirAssistWarnings(
  gcode: string,
  device: DeviceProfile,
): ReadonlyArray<string> {
  // Absent controllerKind resolves to 'grbl-v1.1' everywhere else in the tree
  // (controller-profile-compatibility.ts); the default generic-grbl-400x400
  // profile relies on that, so it must warn too.
  const controllerKind = device.controllerKind ?? 'grbl-v1.1';
  if (controllerKind !== 'grbl-v1.1') return [];
  return M7_COMMAND_PATTERN.test(gcode) ? [M7_GRBL_V11_WARNING] : [];
}
