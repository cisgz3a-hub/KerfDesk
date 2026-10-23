## ADR-667 - Follow-ups from the audit of PRs #1325 to #1424 (2026-10-23)

**Status:** Accepted. | **Date:** 2026-10-23

The owner asked for every confirmed finding of the audit of PRs #1325 to #1424 to be fixed. Each
item below was reproduced in code on main `3a7104653` before it changed. Code and test evidence
only; no hardware was operated.

### Decisions

1. **The scheduled `$G`-only re-read checks for setting writes (#1338, ADR-648).** It reads only `$G`
   when this session's kept `$$` read still holds: no `$` setting written since it, as snapshot
   retention already required. A Console `$30=` that lands while the qualification waits now
   brings a full `$$` read instead of marking the old settings verified.
2. **Save G-code names the connected firmware (#1349, ADR-567 Amendment 1).** The Save, tile and
   surfacing advisories pass the firmware the banner named (else the driver in use), as Start
   does, so an empty S range is described by that firmware's behaviour.
3. **An opened program's X/Y offset voids the work origin (amends ADR-630 Amendment 6).** A
   `G92 X/Y`, `G10 L2/L20 X/Y` or `G92.1` in a run file drops `workOriginActive`,
   `workOriginSource` and the cached WCO, as the Console's coordinates-xy effect does, and moves
   `workOriginVersion` on. The Console now moves `workOriginVersion` on for its X/Y origin
   effects too, so a Place Board registration bound to the old origin does not outlive a typed
   `G92`, `G10` or homing (ADR-654 binds to that version). Neither is a Start refusal.
4. **Controller passwords stay off the screen and the clipboard (extends ADR-229 Amendment 2 and
   ADR-570 Amendment 1).** The Machine Settings table and the snapshot comparison show a grblHAL
   password setting as `[password hidden]`, and the table search does not match it. **Copy
   visible** in the Super console removes grblHAL and FluidNC password assignments. Only the
   exported backup keeps them, for a restore, as before.
5. **A program that feeds only by arcs is not empty (ADR-392 Amendment 2).** Preflight's
   empty-output rule, the standalone surfacing preflight and the per-bit tile split count a
   `G1`, `G2` or `G3` in any spelling (`G01`, packed words), from one shared test.
6. **A dismissed camera-moved warning covers that episode only (amends ADR-663 Amendment 3).**
   Dismiss keeps the warning quiet while the camera stays where it was: same calibration and
   less than a further 1 mm of shift. A view confirmed steady since (a nudge fix, a kept check)
   ends the dismissal. A nudge fix keeps `calibratedAt`, so keying on the calibration alone
   silenced every later move until a full recalibration.
7. **A recorder that throws re-enables Save video (#1372, ADR-656).** It counts as a failed
   recording: the toast says so and the button is enabled again.
8. **The ADR gate refuses duplicate amendment numbers.** Two branches each landed "ADR-375
   Amendment 3" on 2026-10-22 because amendments were never compared with each other. The gate
   now refuses two `docs/decisions/` files claiming the same decision and amendment number. It
   found two "ADR-378 Amendment 1" files from 2026-09-29: the storage-refusal amendment landed
   first and keeps 1, the dropped-project amendment becomes Amendment 2.

### Not changed

- Design Studio Apply on "Machine bit" already keeps the active bit through a machine refresh:
  ADR-666 F-026 stopped the refresh repinning a starter's cutter for every fresh operation. A
  regression test now covers the Design Studio path.
- Place Board's two-anchor capture cannot tell anchors captured in swapped order from a board
  turned half a turn: both are valid fits. The existing "verify every point" step (ADR-654 item
  7) catches it; a rotation-based notice would also fire for boards really placed turned.
- Cut Settings' whole-number fields (passes, tab count) use `step="1"`, so the browser refuses
  a fraction before Apply; no silent flooring reaches the layer.
