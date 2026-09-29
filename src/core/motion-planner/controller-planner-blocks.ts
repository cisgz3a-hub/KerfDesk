// Usable planner blocks per controller family: how many motion blocks the
// controller holds at once, counting the one it is executing. Restart uses it
// to step back over moves a stop may have discarded (controller audit OR-3),
// and the time estimate plans only as far ahead as the controller can see
// (ADR-525). `$I` or an idle `Bf` report gives a session's real size; these
// are the defaults:
//  - GRBL 1.1h: BLOCK_BUFFER_SIZE 16, one kept free (planner.h:31, planner.c:500);
//  - grblHAL: `$398` default 100 (config.h:906), all usable (planner.c:697-702);
//  - FluidNC v4.0.3: planner_blocks default 16, one kept free
//    (Machine/MachineConfig.h:98, Planner.cpp:445);
//  - Smoothieware: planner_queue_size default 32 (Conveyor.cpp:77), flushed
//    by the ^X halt Abort sends (Conveyor.cpp:89-96);
//  - Marlin 2.1.2.8: BLOCK_BUFFER_SIZE 16 (Configuration_adv.h:2393-2399), one
//    kept free (planner.h:765), all dropped by the M410 quick stop that Abort
//    sends (planner.cpp:1688-1689; ADR-395).
// Ruida is never streamed: it runs a whole uploaded job, so it has no entry.

import type { ControllerKind } from '../devices';

export const DEFAULT_PLANNER_BLOCKS: Readonly<Partial<Record<ControllerKind, number>>> = {
  'grbl-v1.1': 15,
  grblhal: 100,
  fluidnc: 15,
  smoothieware: 32,
  marlin: 15,
};
