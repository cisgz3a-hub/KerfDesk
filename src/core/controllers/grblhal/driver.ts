// grblHAL driver — protocol-compatible with GRBL v1.1 (same realtime bytes,
// $-commands, jog protocol, status reports), with extended alarm/error code
// tables handled by the shared describe* lookups. Hardware-verifiable on the
// Falcon A1 Pro (GrblHAL 1.1f), unlike every other non-GRBL family.

import type { ControllerDriver } from '../controller-driver';
import { grblDriver } from '../grbl/driver';

export const grblHalDriver: ControllerDriver = {
  ...grblDriver,
  kind: 'grblhal',
  label: 'grblHAL',
};
