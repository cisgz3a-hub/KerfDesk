## ADR-192 Amendment 1 - A safe-Z retract only raises the bit (2026-09-24)

**Status:** Accepted. | **Date:** 2026-09-24

### Context

ADR-192's CNC Frame retract is an absolute work-frame jog to the configured safe Z
(`$J=G90 G21 Z<safeZ>`), and click and command point moves use the same prefix. From a bit
already above safe Z, that jog moves it down. After a Z probe the bit parks 5 mm above the
plate (`buildZProbeLines`): work Z 20 on the default 15 mm plate, and the plate is often still
under the bit. A Frame or Go to work zero pressed at that point drove the bit down to safe Z
(3.81 mm by default), about 11 mm into the plate. "Confirm plate removed" gates only Start and
tool-change Continue, not Frame or point moves. A settings audit found this.

Universal Gcode Sender's return-to-home raises Z to its safety height only when the current
work Z is below it (`if (currentZPosition < safetyHeight)` in
[`AbstractController.returnToHome`](https://github.com/winder/Universal-G-Code-Sender/blob/master/ugs-core/src/com/willwinder/universalgcodesender/AbstractController.java)).

### Decision

1. CNC Frame retracts and restores only when the pre-Frame work Z is below safe Z. At or
   above safe Z it traces, and returns in XY, at the bit's own height, with no Z move.
2. A CNC point move skips its safe-Z retract when the live work Z is at or above safe Z. When
   the work Z is unknown it retracts as before.
3. The evidence gates are unchanged. A CNC Frame or point move without current Work-Z evidence,
   or a Frame without a known pre-Frame Z, is still refused before any write.

### Consequences

- A Frame or point move right after a probe no longer lowers the bit into the plate.
- A Frame started high traces high. Frame proves the XY envelope, so the height does not change
  what it verifies.
- Not hardware-verified. Unit tests cover the assembled Frame line list and the point-move
  writes.
