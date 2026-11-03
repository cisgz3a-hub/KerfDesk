## ADR-637 Amendment 6 - Machine Setup's Save switches the live connection to the saved machine's driver

**Status:** Accepted (new-user experience audit U2 finding U2-P2-1, confirmed by an independent
refuter; the maintainer's standing instruction to fix confirmed audit findings). Amends ADR-375's
"a profile changed while connected keeps the old commands until a reconnect" for Machine Setup's
Save only. It adds no Start guard (rule 7 / ADR-228) and writes no controller setting. |
**Date:** 2026-11-03

### Context

- Connect binds the controller driver and vendor command set from the profile (ADR-322 §4,
  ADR-375). A beginner usually presses Connect first, which binds the starter's stock GRBL driver,
  and then picks their machine in the Machine Setup window that opens.
- After Save the session kept the starter's driver. On a Creality Falcon A1 Pro, Home sent `$H`
  and jogs sent `$J=`, although Essentials had just said "Enable Home ($HX then $HY)" and Review
  said "Software configuration is internally consistent". The toolbar read "Creality Falcon A1 Pro
  (vendor command set) · Connected". The vendor Frame and jog warnings past the homed area were
  lost, and auto-focus asked the operator to choose the profile they had just chosen. The Ortur
  Laser Master 3 heads (grblHAL) kept stock GRBL the same way, and a Marlin board answered nothing.
- The only way out was step 1's "Reconnect using selected profile", which a beginner cannot tell
  from the card's other buttons.

### Decision

1. **Save reconnects with the saved profile when the live driver differs.** After the profile is
   saved and any queued firmware writes are sent on the connection their rows came from, Save
   closes and reopens the port with the profile's driver, command set and baud: the same reconnect
   as step 1's button, which sends no motion. It runs only when nothing is in flight: no job, no
   motion or controller operation of KerfDesk's, and a status of Idle, Alarm or none at all (a
   firmware the old driver cannot parse, such as Marlin on the GRBL driver). A toast says it
   reconnected, or that reopening the port failed.
2. **Otherwise Save says so and offers one button.** A busy machine, a network connection (which
   reopens only from its own Connect) or a host without a platform adapter keeps the connection.
   Save's toast names the commands still in use, why, and points at **Reconnect now**.
3. **The toolbar tells the truth while they differ.** The machine name drops a preset's "(vendor
   command set)" and says which commands are live, for example "Creality Falcon A1 Pro (connected
   with GRBL v1.1 commands)". A notice under it says Home, jog and Frame use the old commands and
   offers **Reconnect now**. It shows whenever a connected session's driver is not the profile's,
   however that happened.
4. **Review does not call the setup consistent with a stale driver.** While the draft needs another
   driver than the live one, Review's status says "Ready to save: Save reconnects", names both
   command sets and says what happens if the machine is busy. Step 1's card says the same in plain
   words.

### Consequences

- The Falcon A1 Pro homes with `$HX` then `$HY` and jogs with its own commands from the first
  Save; the Ortur LM3 heads get the grblHAL driver; a Marlin profile gets the Marlin driver.
  Listed CNC presets keep the current controller (they are geometry only), so a CNC changes driver
  only when its firmware is chosen.
- Job output is unchanged: G-code is prepared from the profile as before (ADR-375).
- Job Review's identity warning (`controller-identity-warnings.ts`) still names any mismatch left
  at Start.
- `live-driver-mismatch.ts` (detection and wording), `save-driver-switch.ts` (the Save-time switch
  and its blocker), `ConnectionBar`'s `driverMismatch` notice.

### Verification

- `e2e/first-connect-machine-setup.e2e.ts` drives toolbar Connect, picks the Falcon A1 Pro, checks
  Review's wording, saves, checks the port reopened and the toolbar name, then presses Home and
  asserts `$HX` and `$HY` are sent and `$H` is not.
- `save-driver-switch.test.ts` reconnects a stock GRBL session for the A1 Pro, an Ortur LM3, Marlin
  and a FluidNC CNC, keeps a jogging machine connected with the deferred wording, and checks the
  blocker's cases. `live-driver-mismatch.test.ts` covers detection and the Review and toolbar
  wording for every preset whose driver differs from the starter's.
- No hardware was operated; all controllers are simulated.
