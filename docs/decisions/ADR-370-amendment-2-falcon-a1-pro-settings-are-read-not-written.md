## ADR-370 Amendment 2 - The Falcon A1 Pro's settings are read at connect, and still never written (2026-10-28)

**Status:** Accepted on 2026-10-28 |
**Amends:** ADR-370 Amendment 1 item 5, which kept "settings fetch and `$I`" disabled on the Falcon
contract "as Creality's own LightBurn device does (ADR-322)". Items 1 to 4 stand. It adds no Start
guard (rule 7 / ADR-228).

### Context

Rolling audit v6, report K3 (`docs/audits/2026-10-28-rolling-v6/K3-falcon-a1-pro-truth.md`),
finding K3-P3-1, traced the ban to Creality's LightBurn `.lbdev` `AllowSettingsFetch: false` only.
It found no firmware hazard: grblHAL answers `$$`, `$I` and `$ES` with reports, two published
A1 Pro units answered `$$` and `$I` in full, and LaserGRBL, which Creality lists for live control,
reads both at every connect. ADR-322 Amendment 3 records the evidence and lifts the ban.

### Decision

1. **Item 5 now reads:** the Falcon contract reads `$$` at connect, with the read-only
   `grbl-dollar-read` capability (ADR-322 Amendment 3), and offers `$I` as the Super Console's
   firmware report. It still sends no `$N=` write on grblHAL, so the reads add no write surface.
2. **What the read settles for the user's own unit.** Machine Setup's settings table and Job
   Review's controller facts show what that controller reports for `$150`-`$153`, `$22` and `$62`.
   On the published A1 Pro builds `$150`-`$152` read 16, the Trinamic microstep value, which is
   why item 1 of Amendment 1 lists no write there.
3. **Still not done: enumerating settings.** `$ES` is not sent. A write gated on the controller's
   own setting names could be revisited with an A1 Pro build whose enumeration shows an air
   setting; none is known.

### Verification

- The Falcon contract tests pin the `$$` query, the `grbl-dollar-read` capability, the empty write
  list on grblHAL and the refused `$152=100`.
- No machine was operated.
