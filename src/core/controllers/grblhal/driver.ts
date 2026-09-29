// grblHAL driver — protocol-compatible with GRBL v1.1 (same realtime bytes,
// $-commands, jog protocol, status reports). The shared describe* lookups
// cover the alarm table (including grblHAL's 10-13) and errors 1-38; the
// extended error codes (39+) take grblHAL's own wording
// (grbl/grblhal-error-codes.ts). Board and firmware identity need separate
// evidence. Falcon vendor commands are selected by its profile command set,
// not inferred from this family.

import type { ControllerDriver } from '../controller-driver';
import { grblDriver } from '../grbl/driver';
import { GRBLHAL_HOMING_CYCLE } from '../grbl/grbl-homing-duration';

export const grblHalDriver: ControllerDriver = {
  ...grblDriver,
  kind: 'grblhal',
  label: 'grblHAL',
  realtime: {
    ...grblDriver.realtime,
    // grblHAL handles 0x85 in every state: it drops the partial line and
    // flushes the input buffer, so a line not parsed yet is never answered
    // (https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/protocol.c#L896-L899;
    // stream.h#L287-L291). Stock GRBL ignores 0x85 outside Jog and flushes
    // nothing (https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/serial.c#L159-L162).
    jogCancelDropsUnparsedLines: true,
  },
  capabilities: {
    ...grblDriver.capabilities,
    // grblHAL's homing loop serves status requests only with "report when
    // homing" (bit 12 of $10), off by default (machine_limits.c:336-337,
    // config.h:751-753), so Home is timed by its $$ settings (audit ST-4).
    statusWhileHoming: false,
    // COMPATIBILITY_LEVEL 0, the default build, latches a refused line's
    // error (protocol.c:246-286); an empty line clears it.
    stickyLineError: true,
  },
  commands: {
    ...grblDriver.commands,
    // grblHAL extends `$I`; do not treat a variant response as stock proof.
    buildInfoQuery: null,
  },
  homingCycle: GRBLHAL_HOMING_CYCLE,
};
