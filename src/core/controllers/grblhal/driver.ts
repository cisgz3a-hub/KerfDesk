// grblHAL driver — protocol-compatible with GRBL v1.1 (same realtime bytes,
// $-commands, jog protocol, status reports). The shared describe* lookups
// cover the alarm table (including grblHAL's 10-13), but the ERROR
// descriptions stop at vanilla GRBL 1-38 — grblHAL's extended error codes
// (39+) still parse but have no description, so they surface by raw text.
// Hardware-verifiable on the Falcon A1 Pro (GrblHAL 1.1f), unlike every
// other non-GRBL family.

import type { ControllerDriver } from '../controller-driver';
import { grblDriver } from '../grbl/driver';

export const grblHalDriver: ControllerDriver = {
  ...grblDriver,
  kind: 'grblhal',
  label: 'grblHAL',
  commands: {
    ...grblDriver.commands,
    // grblHAL extends `$I`; do not treat a variant response as stock proof.
    buildInfoQuery: null,
  },
};
