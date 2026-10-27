## ADR-375 Amendment 8 - The phone's hold-to-jog aims inside the same travel limits as the PC's (2026-10-27)

**Status:** Accepted; software-verified through tests that drive the real JogPad hold and the real
remote hold on the same controller state. Not hardware-tested. | **Date:** 2026-10-27

Extends ADR-375 decision 3 and [Amendment 4](ADR-375-amendment-4-grblhal-envelope-and-console-values.md)
item 2 to the phone's hold-to-jog (ADR-585), and narrows ADR-585's "at most 100 mm on X/Y … or
20 mm on Z". Follows rolling audit v4 finding H8-P2-2 (P2), which an independent refuter confirmed.
The coordinator re-verified it in code on main `a59f74ff9`. No hardware was available, so none of
this is hardware evidence.

### Context

Decision 3 clamps press-and-hold jog in machine coordinates to the firmware's envelope, a pull-off
clear of each homing switch, and Amendment 4 applies that after this session's Home with soft limits
off too. The PC's JogPad does this with `continuousJogVector` against `resolveManualMotionLimits`.
The phone's hold (`holdVector`) always asked for 100 mm on X/Y, or 20 mm on Z, and never read the
position or the envelope:

- On a homed stock GRBL with `$20=0` and `$21=1`, 20 mm from the +X switch, the PC's hold asks for
  18 mm and stops clear of the switch. The phone asked for 100 mm. Release travels phone → relay →
  PC, so even a prompt release can trip the switch. GRBL then resets into `ALARM:1`, and the
  position and the job's origin evidence are lost.
- With `$20=1` the whole 100 mm line is refused (`error:15`), so near an edge the phone hold did
  nothing.
- The Z hold's check followed the open project's machine. After ADR-416 Amendment 3 (#1462) the
  phone's Z step follows the running job's.

### Decision

1. **One aim for both holds.** `holdJogAim` (`src/ui/laser/jog-hold-aim.ts`) returns the XY box and
   the machine position the PC's hold measures from. JogPad and the phone hold both call it. The
   phone hold asks for the PC hold's distance to the travel edge, capped at the 100 mm remote bound.
   With no envelope known (no `$$` this session, FluidNC, Marlin, Smoothieware, Ruida, vendor
   command sets), that is the 100 mm bound, as before.
2. **The Z hold stays inside the firmware's Z envelope.** When `resolveFirmwareZLimits` knows the Z
   range (this session's `$$`, with soft limits on or a confirmed Home) and the head's machine Z is
   known, the phone's Z hold stops that range's pull-off clear of the Z switch. That is the same Z
   top a CNC park lift is checked against (ADR-491 Amendment 2). Otherwise it keeps the 20 mm bound.
   The PC has no Z hold, so nothing changes there.
3. **At the edge the phone is told.** Where the PC's hold sends nothing, because the head is already
   at the edge in that direction, the phone hold is refused with "The head is already at the travel
   limit in that direction." No jog is sent.
4. **Z follows the running job's machine.** The Z hold's check uses `motionMachineKind`, as the
   phone's Z step does (ADR-416 Amendment 3).

This only shortens or withholds a move KerfDesk would already send. Step jogs, typed moves and Frame
are unchanged.

### Consequences

- A phone hold toward a homing switch now stops where the PC's does, and with soft limits on it is
  no longer refused whole near an edge.
- The bounds and no-go warnings the store's `jog` raises still reach only the PC (H8-P2-2's
  secondary point). That is left for a later change.
