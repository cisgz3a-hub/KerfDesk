## ADR-375 Amendment 10 - The phone's Z hold aims from the controller's Z after an Unlock without Home (2026-10-27)

**Status:** Accepted; software-verified through tests that drive the real remote hold on a
withheld status report. Not hardware-tested. | **Date:** 2026-10-27

Extends [Amendment 8](ADR-375-amendment-8-phone-hold-aims-like-the-pc-hold.md) item 2, the phone Z
hold's clamp to the firmware Z envelope, to the position the XY hold already aims from when KerfDesk
withholds the reported one. Follows rolling audit v5 finding J3-P3-3 (P3), which the refuter
confirmed in the GRBL simulator. The coordinator re-verified it in code on main `09f7c0087`. No
hardware was available, so none of this is hardware evidence.

### Context

After an Unlock without Home (or Release motors, a failed Home) KerfDesk withholds the reported
position. Stock GRBL with `$20=1` still checks every jog target against its own machine position,
and `$X` leaves that position as it was, so the XY hold aims from the controller MPos KerfDesk
withheld (`firmwareJogCheckPosition`, controller audit 2 M-3). `holdZRoomMm` read only the trusted
position and returned no limit, so the phone Z hold asked for its full 20 mm. With the head 5 mm
below the Z soft limit, GRBL refused the whole line (`error:15`) and Z did not move.

### Decision

The Z hold measures its room from the trusted machine Z, or, when that is withheld, from the
controller Z on the same terms as the XY hold: stock GRBL, soft limits on in this session's `$$`,
and a report that carried MPos in confirmed units. `firmwareJogCheckPosition` returns Z as well, and
the hold clamps are still its only users. grblHAL before this session's Home, and a WPos-only
report, keep the 20 mm request, as before.

### Consequences

Near the Z soft limit the phone's Z hold now runs to the edge instead of failing with `error:15`.
Nothing else reads the withheld position.
